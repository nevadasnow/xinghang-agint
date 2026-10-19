import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { listMemory } from './memory'

/**
 * 轻量 RAG（本地检索增强，纯本地、无外部依赖）
 *
 * 职责：把「记忆库条目 + 上传文件内容」做成一个可检索的资料库，
 * 每次对话按当前用户问题做 BM25 相关性检索，只把命中的片段注入
 * system prompt（见 renderRagBlock / index.ts 的 runChatStream），
 * 而不是像以前那样把全部记忆和全部文件全量塞进上下文。
 *
 * 人设提示词（prompts/* 的 soul/harness/identity/system/styles/worldbook）
 * 不经过检索，始终全量注入——角色扮演的根基不受任何影响。
 *
 * 数据仅保存在本地 userData/rag-docs.json（文件内容库），不经过网络。
 */

export interface RagDocBlock {
  src: 'memory' | 'file'
  name: string
  text: string
}

/** 每个来源的 topK：记忆 5 条 + 文件 5 块，宁可少而准 */
const MEM_K = 5
const FILE_K = 5
/** 检索命中后单块注入上限（字符） */
const BLOCK_INJECT_MAX = 240
/** 文件切块目标长度（字符） */
const CHUNK_TARGET = 200
const CHUNK_OVERLAP = 40

interface StoredDoc {
  name: string
  content: string
  addedAt: number
}

interface RagStore {
  docs: StoredDoc[]
}

function storePath(): string {
  return join(app.getPath('userData'), 'rag-docs.json')
}

function loadDocs(): RagStore {
  const p = storePath()
  try {
    if (!existsSync(p)) return { docs: [] }
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<RagStore>
    if (!Array.isArray(raw.docs)) return { docs: [] }
    return { docs: raw.docs.filter((d) => d && typeof d.name === 'string' && typeof d.content === 'string') }
  } catch {
    return { docs: [] }
  }
}

function saveDocs(store: RagStore): void {
  const p = storePath()
  try {
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify(store), 'utf-8')
  } catch (e) {
    console.error('[rag] 文档库写入失败:', (e as Error)?.message)
  }
}

/** 上传文件入库（同名覆盖，保留一份最新内容） */
export function saveDocument(name: string, content: string): { ok: boolean; error?: string } {
  const cleanName = (name ?? '').trim()
  const clean = (content ?? '').trim()
  if (!cleanName) return { ok: false, error: '文件名为空。' }
  if (!clean) return { ok: false, error: '文件内容为空。' }
  const st = loadDocs()
  const idx = st.docs.findIndex((d) => d.name === cleanName)
  if (idx >= 0) st.docs[idx] = { name: cleanName, content: clean, addedAt: Date.now() }
  else st.docs.push({ name: cleanName, content: clean, addedAt: Date.now() })
  saveDocs(st)
  return { ok: true }
}

/** 删除文件（用户移除附件后不再参与检索） */
export function removeDocument(name: string): { ok: boolean } {
  const clean = (name ?? '').trim()
  if (!clean) return { ok: true }
  const st = loadDocs()
  st.docs = st.docs.filter((d) => d.name !== clean)
  saveDocs(st)
  return { ok: true }
}

/** 当前资料库中的文件名列表（供 UI/排查看） */
export function listDocuments(): string[] {
  return loadDocs().docs.map((d) => d.name)
}

/** 文件内容长度（供展示） */
export function documentSize(name: string): number {
  return loadDocs().docs.find((d) => d.name === name)?.content.length ?? 0
}

// ---------- 切块 ----------

/** 把长文本切成 ~200 字的重叠块（段落优先，避免把一句话劈开） */
function chunkText(text: string, target = CHUNK_TARGET, overlap = CHUNK_OVERLAP): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim()
  if (!clean) return []
  if (clean.length <= target * 1.5) return [clean]

  // 先按段落拆，再把超长段落按句子/长度聚合
  const paras = clean.split(/\n{1,}/).map((p) => p.trim()).filter(Boolean)
  const blocks: string[] = []
  let cur = ''
  for (const p of paras) {
    if (p.length > target * 1.5) {
      if (cur) {
        blocks.push(cur)
        cur = ''
      }
      // 超长段落内部按标点/固定长度切
      const sentences = p.split(/(?<=[。！？；\n])/).filter(Boolean)
      let acc = ''
      for (const s of sentences) {
        if ((acc + s).length > target && acc) {
          blocks.push(acc)
          acc = s
        } else {
          acc += s
        }
        if (acc.length > target * 1.5) {
          blocks.push(acc)
          acc = ''
        }
      }
      if (acc) blocks.push(acc)
      continue
    }
    if ((cur + '\n' + p).length > target && cur) {
      blocks.push(cur)
      cur = p
    } else {
      cur = cur ? cur + '\n' + p : p
    }
  }
  if (cur) blocks.push(cur)
  // 去重（重叠切可能出现重复块）
  const seen = new Set<string>()
  return blocks.filter((b) => {
    const k = b.slice(0, 60)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

// ---------- 分词（中文 2-gram + ASCII 词） ----------

function tokenize(text: string): string[] {
  const tokens: string[] = []
  const ascii = text.match(/[A-Za-z0-9_]+/g) ?? []
  for (const w of ascii) tokens.push(w.toLowerCase())
  // 中文字符序列按 2-gram 切
  const cjk = text.replace(/[A-Za-z0-9_\s]/g, '')
  for (let i = 0; i < cjk.length - 1; i++) {
    tokens.push(cjk.slice(i, i + 2))
  }
  // 单字补充（短查询如「歌单」「记忆」2-gram 已覆盖，无需全部单字）
  return tokens.filter(Boolean)
}

// ---------- BM25 ----------

interface BlockIndex {
  src: 'memory' | 'file'
  name: string
  text: string
  terms: string[]
  len: number
}

interface RerankIndex {
  docs: BlockIndex[]
  avgdl: number
  df: Map<string, number>
  n: number
}

const K1 = 1.2
const B = 0.75

function buildIndex(blocks: BlockIndex[]): RerankIndex {
  const df = new Map<string, number>()
  for (const b of blocks) {
    const seen = new Set<string>()
    for (const t of b.terms) {
      if (!seen.has(t)) {
        seen.add(t)
        df.set(t, (df.get(t) ?? 0) + 1)
      }
    }
  }
  const avgdl = blocks.length > 0 ? blocks.reduce((s, b) => s + b.len, 0) / blocks.length : 1
  return { docs: blocks, avgdl, df, n: blocks.length }
}

function idf(index: RerankIndex, term: string): number {
  const df = index.df.get(term) ?? 0
  return Math.log(1 + (index.n - df + 0.5) / (df + 0.5))
}

function scoreBlock(index: RerankIndex, block: BlockIndex, queryTerms: string[]): number {
  let score = 0
  const tfMap = new Map<string, number>()
  for (const t of block.terms) tfMap.set(t, (tfMap.get(t) ?? 0) + 1)
  for (const t of queryTerms) {
    const tf = tfMap.get(t) ?? 0
    if (tf === 0) continue
    const denom = tf + K1 * (1 - B + B * (block.len / Math.max(1, index.avgdl)))
    score += idf(index, t) * ((tf * (K1 + 1)) / denom)
  }
  return score
}

/** 取一个来源的 topK（记忆按条目、文件按块），过滤零分 */
function topFor(blocks: BlockIndex[], queryTerms: string[], k: number, index: RerankIndex): BlockIndex[] {
  const scored = blocks
    .map((b) => ({ b, s: scoreBlock(index, b, queryTerms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
  return scored.map((x) => x.b)
}

/**
 * 检索：以用户最近一条消息为 query，分别对记忆条目和文件块做 BM25 打分，
 * 各自取 topK，合并返回（附来源标签）。
 */
export function retrieveRelevant(query: string, memK = MEM_K, fileK = FILE_K): RagDocBlock[] {
  const q = (query ?? '').trim()
  if (!q) return []
  const qTerms = tokenize(q)
  if (qTerms.length === 0) return []

  // 记忆条目：每条一块
  const memBlocks: BlockIndex[] = listMemory()
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .map((m) => {
      const text = m.text.trim()
      const terms = tokenize(text)
      return { src: 'memory' as const, name: m.id, text, terms, len: terms.length }
    })

  // 文件：每个文件切块
  const fileBlocks: BlockIndex[] = []
  for (const d of loadDocs().docs) {
    for (const chunk of chunkText(d.content)) {
      const terms = tokenize(chunk)
      fileBlocks.push({ src: 'file' as const, name: d.name, text: chunk, terms, len: terms.length })
    }
  }

  const pool = buildIndex([...memBlocks, ...fileBlocks])
  const memHits = topFor(memBlocks, qTerms, memK, pool)
  const fileHits = topFor(fileBlocks, qTerms, fileK, pool)

  // 记忆命中优先展示；文件块按相关度排序；均截断到注入上限
  const memOut = memHits.map((b) => ({
    src: b.src,
    name: b.name,
    text: b.text.slice(0, BLOCK_INJECT_MAX)
  }))
  const fileOut = fileHits.map((b) => ({
    src: b.src,
    name: b.name,
    text: b.text.slice(0, BLOCK_INJECT_MAX)
  }))
  return [...memOut, ...fileOut]
}

/** 渲染检索命中块：空命中返回空串（完全不占 token） */
export function renderRagBlock(query: string): string {
  const hits = retrieveRelevant(query)
  if (hits.length === 0) return ''
  const lines: string[] = ['# 相关资料（按当前话题从本地资料库检索命中）']
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]
    const tag = h.src === 'memory' ? '记忆' : `文件《${h.name}》`
    lines.push(`${i + 1}. [${tag}] ${h.text}`)
  }
  lines.push('')
  lines.push(
    '用法：以上片段是检索到的与你当前话题相关的本地资料。相关时自然引用即可；不相关就不要硬提。'
  )
  lines.push('只可依据片段里确实存在的内容作答；片段里没有的不要编造。与用户这次说的话冲突时，以用户这次说的为准。')
  return lines.join('\n')
}

/** 兜底：检索零命中但用户明确附带了文件时，提供这些文件的全文（每个截断） */
export function renderFilesFull(names: string[], maxCharsPerFile = 5000): string {
  const docs = loadDocs().docs
  const blocks: string[] = []
  for (const name of names) {
    const d = docs.find((x) => x.name === name)
    if (d && d.content.trim()) {
      blocks.push(`【文件《${d.name}》】\n${d.content.slice(0, maxCharsPerFile)}`)
    }
  }
  if (blocks.length === 0) return ''
  return [
    '# 附件资料（本次检索未命中，提供附件全文）',
    ...blocks,
    '',
    '用法：依据这些内容回答用户关于该文件的提问；片段没有的不要编造。'
  ].join('\n')
}
