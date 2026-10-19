import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * 记忆库（E0：Agent 记忆）
 *
 * 一段持久化的「你记得的事」：用户在记忆库面板里手动维护的记忆条目，
 * 会在每次对话时注入 system prompt（见 prompts.ts 的 renderMemoryBlock /
 * index.ts 的 runChatStream），让 agent 在后续对话中能引用这些记忆。
 *
 * 数据仅保存在本地 userData/memory.json（与 config.json 同一目录），
 * 不经过任何网络；格式：
 *   { entries: [{ id, text, createdAt, updatedAt }] }
 */

export interface MemoryEntry {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

export interface MemoryStore {
  entries: MemoryEntry[]
}

export interface MemoryResult {
  ok: boolean
  entries?: MemoryEntry[]
  error?: string
}

export function memoryFilePath(): string {
  return join(app.getPath('userData'), 'memory.json')
}

export function loadMemory(): MemoryStore {
  const p = memoryFilePath()
  try {
    if (!existsSync(p)) return { entries: [] }
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<MemoryStore>
    if (!Array.isArray(raw.entries)) return { entries: [] }
    return { entries: raw.entries as MemoryEntry[] }
  } catch {
    return { entries: [] }
  }
}

function saveMemory(store: MemoryStore): void {
  const p = memoryFilePath()
  try {
    mkdirSync(dirname(p), { recursive: true })
    // 无 BOM、紧凑 JSON，与 data.json 的写入规范保持一致
    writeFileSync(p, JSON.stringify(store), 'utf-8')
  } catch (e) {
    console.error('[memory] 写入失败:', (e as Error)?.message)
  }
}

export function listMemory(): MemoryEntry[] {
  const st = loadMemory()
  // 最新编辑的排前面，方便扫读
  return [...st.entries].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function addMemory(text: string): MemoryResult {
  const clean = (text ?? '').trim()
  if (!clean) return { ok: false, error: '记忆内容不能为空。' }
  const st = loadMemory()
  const now = Date.now()
  const entry: MemoryEntry = { id: `mem-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`, text: clean, createdAt: now, updatedAt: now }
  st.entries.push(entry)
  saveMemory(st)
  return { ok: true, entries: listMemory() }
}

export function updateMemory(id: string, text: string): MemoryResult {
  const clean = (text ?? '').trim()
  if (!clean) return { ok: false, error: '记忆内容不能为空。' }
  const st = loadMemory()
  const e = st.entries.find((x) => x.id === id)
  if (!e) return { ok: false, error: '记忆条目不存在。' }
  e.text = clean
  e.updatedAt = Date.now()
  saveMemory(st)
  return { ok: true, entries: listMemory() }
}

export function deleteMemory(id: string): MemoryResult {
  const st = loadMemory()
  st.entries = st.entries.filter((x) => x.id !== id)
  saveMemory(st)
  return { ok: true, entries: listMemory() }
}

/** 记忆库注入上限：最多注入 12 条、每条 200 字，防止挤占上下文 */
const MEMORY_BLOCK_MAX = 12
const MEMORY_CHAR_MAX = 200

/**
 * 渲染记忆块。空记忆返回空串（不占 token）。
 * 措辞刻意与画像块区分：画像 = 用户自述的事实，记忆 = agent 记住的事，
 * 且明确要求「提到但不复述、不主动揭底」，避免 agent 把记忆当履历背出来。
 */
export function renderMemoryBlock(): string {
  const list = listMemory()
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .slice(0, MEMORY_BLOCK_MAX)
    .map((m) => m.text.trim().slice(0, MEMORY_CHAR_MAX))
  if (list.length === 0) return ''
  return [
    '# 你记得的事（记忆库）',
    ...list.map((t, i) => `${i + 1}. ${t}`),
    '',
    '用法：这些是你在过往陪伴中记住的碎片。当话题相关时可以自然提到，帮助延续默契；',
    '但不要整段复述，也不要在不相关的时候主动罗列，更不要把记忆内容当作用户当前说的话。',
    '如果用户这次说的与记忆冲突，以用户这次说的为准。'
  ].join('\n')
}
