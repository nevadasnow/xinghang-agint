import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join, extname } from 'path'
import { app } from 'electron'

/**
 * 本地 TTS 客户端 —— 支持两种 GPT-SoVITS 服务形态，自动探测：
 *
 * A) api_v2 接口（默认端口 9880）
 *    GET http://127.0.0.1:9880/tts?text=...&text_lang=zh&ref_audio_path=...&media_type=wav
 *    返回 wav 二进制（RIFF 头）。
 *
 * B) WebUI（Gradio，默认端口 9872，用户已启动的形式）
 *    1) POST /gradio_api/upload         上传参考音频 → 服务端临时路径
 *    2) POST /gradio_api/call/inference 排队合成 → { event_id }
 *    3) GET  /gradio_api/call/inference/{event_id}  SSE 轮询 → 输出 FileData.path
 *    4) GET  /gradio_api/file=...        下载合成好的 wav
 *
 * 设计取舍：
 *   1) 不依赖用户额外启动 api_v2.py：只要 WebUI 开着就能用。
 *   2) 不做流式：整段合成后一次性返回，交给渲染层播放。
 *   3) 文本先做朗读前清理（cleanForSpeech）：去掉代码块、Markdown 标记、emoji，
 *      不改变界面显示的原文。
 */

export interface TtsRequest {
  text: string
  /** 语言：默认 zh（仅 api_v2 使用） */
  lang?: string
  refAudio: string
  promptText?: string
  promptLang?: string
  /**
   * 当前时段（渲染层按系统时间给出）。
   * 用来调整语速与停顿：深夜放慢、工作时段紧凑。
   */
  dayPart?: string
  /** true = 强制重新合成：跳过本地缓存（「重新合成语音」按钮用） */
  force?: boolean
}

function voiceTuning(dayPart?: string): { speed: number; gap: number } {
  switch (dayPart) {
    case 'latenight':
      return { speed: 0.92, gap: 0.45 }
    case 'evening':
    case 'night':
      return { speed: 0.96, gap: 0.36 }
    case 'morning':
    case 'afternoon':
      return { speed: 1.06, gap: 0.22 }
    default:
      return { speed: 1.0, gap: 0.3 }
  }
}

export interface TtsResult {
  ok: boolean
  /** 成功时返回 data:audio/wav;base64,... 供 <audio> 直接播放 */
  dataUrl?: string
  /** 失败原因（面向用户，可直接显示） */
  error?: string
  /** 实际送去的文本长度（用于诊断） */
  chars?: number
  /** true = 本次命中本地缓存，没有重新合成 */
  cached?: boolean
}

const MAX_SPEECH_CHARS = 600
const TTS_TIMEOUT_MS = 150_000

/**
 * 朗读前清理：把不适合朗读的内容剥掉。
 * 只影响送进 TTS 的文本，界面显示的原文不变。
 */
export function cleanForSpeech(raw: string): string {
  let t = raw
  t = t.replace(/```[\s\S]*?```/g, '（代码块已省略）')
  t = t.replace(/~~~[\s\S]*?~~~/g, '（代码块已省略）')
  t = t.replace(/`([^`]*)`/g, '$1')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  t = t.replace(/^\s{0,3}>\s?/gm, '')
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '')
  t = t.replace(/^\s{0,3}\d+\.\s+/gm, '')
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2')
  t = t.replace(/(\*|_)(.*?)\1/g, '$2')
  t = t.replace(/~~(.*?)~~/g, '$1')
  t = t.replace(/^\s*\|?[\s:|-]{5,}\|?\s*$/gm, '')
  t = t.replace(/\|/g, '，')
  t = t.replace(/^\s*([-*_])\1{2,}\s*$/gm, '')
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, '')
  t = t.replace(/[ \t]+/g, ' ')
  t = t.replace(/\n{2,}/g, '\n')
  return t.trim()
}

function normalizeBase(apiBase: string): string {
  return (apiBase || 'http://127.0.0.1:9872').trim().replace(/\/+$/, '')
}

/* ---------------- 模式探测（带缓存） ---------------- */

type TtsMode = 'api' | 'gradio'
/** gradio 版本差异：v2Pro 用 /call/inference（21 参数），v2ProPlus 用 /call/get_tts_wav（17 参数） */
type GradioApi = 'inference' | 'get_tts_wav'
/** gradio 前缀：v2Pro 整合包在根级（''），官方版在 /gradio_api */
interface ModeInfo {
  mode: TtsMode
  prefix: string
  apiName?: GradioApi
}
let modeCache: { base: string; info: ModeInfo } | null = null

/** 探测服务形态：先试 api_v2 /tts，再试 WebUI（Gradio）的 /call 端点 */
async function detectMode(base: string): Promise<ModeInfo> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 6000)
  try {
    // 1) api_v2：/tts 存在（即使参数缺失也会返回 4xx JSON，而不是 404）
    try {
      const r = await fetch(base + '/tts?text=hi&text_lang=zh&ref_audio_path=x&media_type=wav', {
        method: 'GET',
        signal: ctl.signal
      })
      if (r.status !== 404) return { mode: 'api', prefix: '' }
    } catch {
      /* 连不上，继续试 WebUI */
    }
    // 2) WebUI：Gradio 的 /call/{api_name}（v2Pro 在根级，官方版在 /gradio_api）
    //    先试 v2ProPlus 的 get_tts_wav，再试 v2Pro 的 inference
    for (const prefix of ['', '/gradio_api']) {
      for (const apiName of ['get_tts_wav', 'inference'] as GradioApi[]) {
        try {
          const r = await fetch(base + prefix + '/call/' + apiName, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: ctl.signal
          })
          if (r.status === 422 || r.status === 400 || (r.status >= 200 && r.status < 300)) {
            return { mode: 'gradio', prefix, apiName }
          }
        } catch {
          /* 试下一个 */
        }
      }
    }
    return { mode: 'api', prefix: '' }
  } finally {
    clearTimeout(timer)
  }
}

async function cachedMode(base: string): Promise<ModeInfo> {
  if (modeCache && modeCache.base === base) return modeCache.info
  const info = await detectMode(base)
  modeCache = { base, info }
  return info
}

/** 探测 TTS 服务是否在线（设置页「测试连接」用）；返回服务形态 */
export async function probe(
  apiBase: string
): Promise<{ ok: boolean; mode?: TtsMode; error?: string }> {
  const base = normalizeBase(apiBase)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 5000)
  try {
    // WebUI（Gradio）的 /call 端点（v2ProPlus get_tts_wav / v2Pro inference）
    for (const prefix of ['', '/gradio_api']) {
      for (const apiName of ['get_tts_wav', 'inference'] as GradioApi[]) {
        try {
          const r = await fetch(base + prefix + '/call/' + apiName, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            signal: ctl.signal
          })
          if (r.status === 422 || r.status === 400 || (r.status >= 200 && r.status < 300)) {
            return { ok: true, mode: 'gradio' }
          }
        } catch {
          /* 试下一个 */
        }
      }
    }
    // api_v2 /tts
    try {
      const r = await fetch(base + '/tts?text=hi&text_lang=zh&ref_audio_path=x&media_type=wav', {
        method: 'GET',
        signal: ctl.signal
      })
      if (r.status !== 404) return { ok: true, mode: 'api' }
    } catch {
      /* 连不上 */
    }
    return { ok: false, error: `连不上 ${base}（既不是 WebUI 也不是 api_v2）` }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- 本地语音缓存 ---------------- */

/**
 * 同一句话 + 同一参考音频（音色）的合成结果完全一致，
 * 把合成好的 wav 缓存到本机，第二次点朗读直接播放、零延迟。
 * key = sha1(参考音频指纹 + 文本 + 时段参数)；参考音频换掉后自动失效。
 */
const CACHE_MAX_ITEMS = 200
const CACHE_MAX_BYTES = 250 * 1024 * 1024 // 250MB

function ttsCacheDir(): string {
  return join(app.getPath('userData'), 'tts-cache')
}

/** 参考音频指纹：大小 + 修改时间，换文件/覆盖文件都会变 */
export function refFingerprint(file: string): string {
  try {
    // 参考音频内容哈希：稳定（拷贝/访问不改变内容就命中缓存），
    // 内容真变了会准确失效。10MB 以上退化为 stat（避免每次读大文件）。
    const st = statSync(file)
    if (st.size > 10 * 1024 * 1024) return `${st.size}:${Math.round(st.mtimeMs)}`
    const buf = readFileSync(file)
    return createHash('sha1').update(buf).digest('hex')
  } catch {
    return 'missing'
  }
}

function speechKey(refFile: string, text: string, dayPart?: string): string {
  return createHash('sha1')
    .update(`${refFingerprint(refFile)}|${text}|${dayPart || ''}`)
    .digest('hex')
}

interface CacheMeta {
  text: string
  created: number
  size: number
}

function loadCacheIndex(): Record<string, CacheMeta> {
  try {
    const j = JSON.parse(readFileSync(join(ttsCacheDir(), 'index.json'), 'utf-8')) as Record<string, CacheMeta>
    return j || {}
  } catch {
    return {}
  }
}

function cachePath(key: string): string {
  return join(ttsCacheDir(), key + '.wav')
}

function cacheGet(key: string): Buffer | null {
  const p = cachePath(key)
  if (!existsSync(p)) return null
  try {
    return readFileSync(p)
  } catch {
    return null
  }
}

function cachePut(key: string, buf: Buffer, text: string): void {
  try {
    mkdirSync(ttsCacheDir(), { recursive: true })
    const idx = loadCacheIndex()
    idx[key] = { text: text.slice(0, 80), created: Date.now(), size: buf.length }
    // 超上限：按创建时间删最旧
    const keys = Object.keys(idx).sort((a, b) => idx[a].created - idx[b].created)
    let total = Object.values(idx).reduce((sum, v) => sum + v.size, 0)
    while (keys.length > CACHE_MAX_ITEMS || total > CACHE_MAX_BYTES) {
      const k = keys.shift()
      if (!k) break
      try {
        unlinkSync(cachePath(k))
      } catch {
        /* 文件可能已不存在 */
      }
      total -= idx[k].size
      delete idx[k]
    }
    writeFileSync(cachePath(key), buf)
    writeFileSync(join(ttsCacheDir(), 'index.json'), JSON.stringify(idx))
  } catch {
    /* 缓存失败不影响主流程 */
  }
}

/** 缓存统计（设置页显示）：index.json 条目 + IndexTTS 子目录内的实际 wav 文件 */
export function ttsCacheStats(): { count: number; bytes: number } {
  const idx = loadCacheIndex()
  let count = Object.keys(idx).length
  let bytes = Object.values(idx).reduce((sum, v) => sum + v.size, 0)
  // IndexTTS 引擎缓存：userData/tts-cache/indextts/*.wav（不入 index.json，按实际文件统计）
  try {
    const sub = join(ttsCacheDir(), 'indextts')
    if (existsSync(sub)) {
      for (const f of readdirSync(sub)) {
        if (f.endsWith('.wav')) {
          const st = statSync(join(sub, f))
          count += 1
          bytes += st.size
        }
      }
    }
  } catch {
    /* 目录不存在或读失败时忽略 */
  }
  return { count, bytes }
}

/** 清空语音缓存 */
export function ttsCacheClear(): void {
  const dir = ttsCacheDir()
  try {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}

/** 按文本删除主缓存条目（重新生成前清理，避免新回复命中旧语音）；仅删该文本对应条目 */
export function ttsCacheDeleteText(text: string): void {
  const clean = cleanForSpeech(text || '').replace(/\s+/g, ' ').trim()
  if (!clean) return
  try {
    const idx = loadCacheIndex()
    const mark = clean.slice(0, 80)
    let changed = false
    for (const k of Object.keys(idx)) {
      if (idx[k].text === mark) {
        try {
          unlinkSync(cachePath(k))
        } catch {
          /* 文件可能已不存在 */
        }
        delete idx[k]
        changed = true
      }
    }
    if (changed) writeFileSync(join(ttsCacheDir(), 'index.json'), JSON.stringify(idx))
  } catch {
    /* 缓存清理失败不影响主流程 */
  }
}

/** 合成中同 key 请求复用（自动朗读 + 手动点喇叭同时触发时只合成一次） */
const inflight = new Map<string, Promise<TtsResult>>()

/* ---------------- 合成（按模式分流） ---------------- */

export async function synthesize(req: TtsRequest, apiBase: string): Promise<TtsResult> {
  const base = normalizeBase(apiBase)
  const refAudio = (req.refAudio || '').trim()

  if (!refAudio) {
    return {
      ok: false,
      error: '还没有设置参考音频。GPT-SoVITS 需要一段音频来定音色，请在「设置 → 语音朗读」里选择 wav。'
    }
  }
  if (!existsSync(refAudio)) {
    return { ok: false, error: `参考音频不存在：${refAudio}` }
  }

  const text = cleanForSpeech(req.text || '')
  if (!text) return { ok: false, error: '这段内容没有可朗读的文本。' }
  const chars = text.length
  const clipped = text.length > MAX_SPEECH_CHARS ? text.slice(0, MAX_SPEECH_CHARS) : text

  // 本地缓存：同一句话 + 同一参考音频直接秒播（force 时跳过，用于「重新合成」）
  const key = speechKey(refAudio, clipped, req.dayPart)
  const hit = cacheGet(key)
  if (hit && hit.length > 0 && !req.force) {
    return {
      ok: true,
      dataUrl: `data:audio/wav;base64,${hit.toString('base64')}`,
      cached: true,
      chars
    }
  }

  // 同一句话正在合成（自动朗读/手动朗读并发）时，复用同一个 Promise
  const existing = inflight.get(key)
  if (existing) return existing

  const task = (async () => {
    const info = await cachedMode(base)
    const r =
      info.mode === 'gradio'
        ? await synthesizeGradio(base, info.prefix, info.apiName || 'inference', req, refAudio, clipped, chars)
        : await synthesizeApiV2(base, req, refAudio, clipped, chars)
    // 合成成功 → 写缓存；失败不缓存（下次可重试）
    if (r.ok && r.dataUrl) {
      const b64 = r.dataUrl.split(',')[1]
      if (b64) {
        try {
          cachePut(key, Buffer.from(b64, 'base64'), clipped)
        } catch {
          /* 忽略缓存写入错误 */
        }
      }
    }
    return r
  })()
  inflight.set(key, task)
  void task.finally(() => {
    if (inflight.get(key) === task) inflight.delete(key)
  })
  return task
}

/** api_v2：GET /tts 一次性返回 wav */
async function synthesizeApiV2(
  base: string,
  req: TtsRequest,
  refAudio: string,
  text: string,
  chars: number
): Promise<TtsResult> {
  const tune = voiceTuning(req.dayPart)
  const params = new URLSearchParams({
    text,
    text_lang: req.lang || 'zh',
    ref_audio_path: refAudio,
    prompt_lang: req.promptLang || req.lang || 'zh',
    text_split_method: 'cut0', // 整段合成（不分段），避免分段拼接产生的停顿感
    media_type: 'wav',
    streaming_mode: 'false',
    speed_factor: tune.speed.toFixed(2),
    fragment_interval: tune.gap.toFixed(2)
  })
  if (req.promptText && req.promptText.trim()) params.set('prompt_text', req.promptText.trim())

  const url = `${base}/tts?${params.toString()}`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TTS_TIMEOUT_MS)
  try {
    const res = await fetch(url, { method: 'GET', signal: ctl.signal })
    if (!res.ok) {
      let detail = ''
      try {
        const j = (await res.json()) as { message?: string; detail?: string }
        detail = j.message || j.detail || ''
      } catch {
        try {
          detail = (await res.text()).slice(0, 200)
        } catch {
          /* 读不出来就算了 */
        }
      }
      return { ok: false, error: `TTS 服务返回 ${res.status}${detail ? '：' + detail : ''}`, chars }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return finishAudio(buf, chars)
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err.name === 'AbortError') {
      return {
        ok: false,
        error: `TTS 合成超时（${TTS_TIMEOUT_MS / 1000}s）。文本较长或服务未就绪时容易发生，可先发短句试试。`,
        chars
      }
    }
    return {
      ok: false,
      error: `连不上 TTS 服务（${base}）。可填 WebUI 地址（如 http://localhost:9872）或 api_v2 地址（如 http://127.0.0.1:9880）。`,
      chars
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 校验并封装 wav 字节 */
function finishAudio(buf: Buffer, chars: number): TtsResult {
  if (buf.length === 0) return { ok: false, error: 'TTS 服务返回了空音频。', chars }
  if (buf.toString('ascii', 0, 4) !== 'RIFF') {
    const head = buf.toString('utf8', 0, Math.min(200, buf.length))
    return { ok: false, error: `TTS 返回的不是音频：${head}`, chars }
  }
  return { ok: true, dataUrl: `data:audio/wav;base64,${buf.toString('base64')}`, chars }
}

/* ---------------- Gradio（WebUI 9872）流程 ---------------- */

/** 上传参考音频到 WebUI，返回服务端临时路径 */
async function uploadRefAudio(
  base: string,
  prefix: string,
  refAudio: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const buf = readFileSync(refAudio)
    const form = new FormData()
    const name = refAudio.split(/[\\/]/).pop() || 'ref.wav'
    form.append('files', new Blob([buf], { type: 'audio/wav' }), name)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 20000)
    try {
      const res = await fetch(base + prefix + '/upload', { method: 'POST', body: form, signal: ctl.signal })
      if (!res.ok) return { ok: false, error: `上传参考音频失败（${res.status}）` }
      const j = (await res.json()) as unknown
      const arr = Array.isArray(j) ? j : (j as { files?: unknown[] }).files
      const item = (arr && arr[0]) as { path?: string; url?: string } | string | undefined
      // v2Pro 整合包直接返回路径字符串数组；官方 gradio 返回 { path } 对象
      const path = typeof item === 'string' ? item : item?.path
      if (!path) return { ok: false, error: '上传参考音频：服务端没有返回路径。' }
      return { ok: true, path }
    } finally {
      clearTimeout(timer)
    }
  } catch (e) {
    return { ok: false, error: `上传参考音频失败：${(e as Error).message}` }
  }
}

async function synthesizeGradio(
  base: string,
  prefix: string,
  apiName: GradioApi,
  req: TtsRequest,
  refAudio: string,
  text: string,
  chars: number
): Promise<TtsResult> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TTS_TIMEOUT_MS)

  // 1) 上传参考音频
  const up = await uploadRefAudio(base, prefix, refAudio)
  if (!up.ok || !up.path) {
    clearTimeout(timer)
    return { ok: false, error: up.error || '上传参考音频失败', chars }
  }

  const tune = voiceTuning(req.dayPart)
  const promptText = (req.promptText || '').trim()
  // 与 WebUI 的组件顺序一一对应（从 gradio config 实测）
  const payload =
    apiName === 'get_tts_wav'
      ? {
          // v2ProPlus（Shorekeeperv0.1 权重）：17 参数
          data: [
            { path: up.path }, // 11 参考音频（audio）
            promptText, // 15 参考音频的文本
            '中文', // 19 参考音频的语种
            text, // 28 需要合成的文本
            '中文', // 31 需要合成的语种
            '凑四句一切', // 32 怎么切
            15, // 40 top_k
            1, // 41 top_p
            1, // 42 temperature
            false, // 13 无参考文本模式（v2ProPlus 填了参考文本即关）
            tune.speed, // 36 语速
            false, // 34 是否直接对上次合成结果调整语速和音色
            null, // 20 可选项：多个参考音频融合
            8, // 21 采样步数（觉得电就调高，慢就调低）
            false, // 22 v3 输出超分
            tune.gap, // 37 句间停顿秒数
            true // 48 CUDA Graph 加速
          ]
        }
      : {
          // v2Pro（守岸人1.0 权重）：21 参数
          data: [
            text, // text
            '中文', // text_lang
            { path: up.path }, // ref_audio_path（FileData）
            null, // aux_ref_audio_paths
            promptText, // prompt_text
            '中文', // prompt_lang
            15, // top_k
            1, // top_p
            1, // temperature
            '按标点符号切', // text_split_method
            20, // batch_size
            tune.speed, // speed_factor
            false, // ref_text_free
            true, // split_bucket
            tune.gap, // fragment_interval
            -1, // seed
            true, // keep_random
            true, // parallel_infer
            1.35, // repetition_penalty
            32, // sample_steps
            false // super_sampling
          ]
        }

  try {
    // 2) 发起合成
    let res: Response
    try {
      res = await fetch(base + prefix + '/call/' + apiName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctl.signal
      })
    } catch {
      throw new Error(`连不上 WebUI（${base}）`)
    }
    if (!res.ok) {
      let detail = ''
      try {
        const j = (await res.json()) as { detail?: string; message?: string }
        detail = j.detail || j.message || ''
      } catch {
        /* 忽略 */
      }
      return { ok: false, error: `WebUI 合成失败（${res.status}）${detail ? '：' + detail : ''}`, chars }
    }
    const call = (await res.json()) as { event_id?: string; data?: unknown[] }
    if (call.event_id) {
      // 3) SSE 轮询
      const sse = await fetch(base + `${prefix}/call/${apiName}/${call.event_id}`, {
        headers: { Accept: 'text/event-stream' },
        signal: ctl.signal
      })
      if (!sse.ok) return { ok: false, error: `WebUI 结果读取失败（${sse.status}）`, chars }
      const body = await sse.text()
      let outPath: string | undefined
      let outUrl: string | undefined
      for (const line of body.split('\n')) {
        if (!line.startsWith('data:')) continue
        const raw = line.slice(5).trim()
        if (!raw || raw === '[DONE]') continue
        try {
          const parsed = JSON.parse(raw) as unknown
          const arr = Array.isArray(parsed) ? parsed : [parsed]
          const first = arr[0] as { output?: { data?: unknown[] }; path?: string; url?: string } | null
          if (!first || typeof first !== 'object') continue
          // 兼容两种输出形态：Simple Predict 直接返回 [FileData, seed]；
          // queue 模式返回 { output: { data: [...] } }
          const direct = first.path ? first : undefined
          const data = first.output?.data
          const fd = (direct ?? (Array.isArray(data) && data[0] ? data[0] : null)) as
            | { path?: string; url?: string }
            | null
            | undefined
          if (fd && typeof fd === 'object' && fd.path) {
            outPath = fd.path
            outUrl = fd.url
          }
        } catch {
          /* 跳过非 JSON 行 */
        }
      }
      if (!outPath && !outUrl) {
        return { ok: false, error: '合成没有返回音频（参考音频可能不合格或服务还在预热）。', chars }
      }
      // 4) 下载 wav：v2Pro 返回的 url 字段带 /cal/ 前缀（不可用），统一用 path 构造 /file= 下载
      const fileUrl = base + prefix + '/file=' + encodeURIComponent(outPath as string)
      const dl = await fetch(fileUrl, { signal: ctl.signal })
      if (!dl.ok) return { ok: false, error: `下载音频失败（${dl.status}）`, chars }
      const buf = Buffer.from(await dl.arrayBuffer())
      return finishAudio(buf, chars)
    }
    // 队列关闭时：结果直接返回
    const data = call.data
    if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
      const fd = data[0] as { path?: string; url?: string }
      const fileUrl = fd.url
        ? fd.url.startsWith('http')
          ? fd.url
          : base + fd.url
        : base + prefix + '/file=' + encodeURIComponent(fd.path || '')
      const dl = await fetch(fileUrl, { signal: ctl.signal })
      if (!dl.ok) return { ok: false, error: `下载音频失败（${dl.status}）`, chars }
      const buf = Buffer.from(await dl.arrayBuffer())
      return finishAudio(buf, chars)
    }
    return { ok: false, error: 'WebUI 没有返回合成结果。', chars }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err.name === 'AbortError') {
      return {
        ok: false,
        error: `TTS 合成超时（${TTS_TIMEOUT_MS / 1000}s）。文本较长或服务未就绪时容易发生，可先发短句试试。`,
        chars
      }
    }
    return { ok: false, error: err.message || '语音合成失败', chars }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- 小米 MiMo 云端 TTS（OpenAI 兼容协议） ---------------- */

/**
 * MiMo 走 OpenAI 兼容 chat/completions：assistant 消息内容就是要合成的文本，
 * audio.voice 指定预置音色或参考音频 base64（voiceclone）。返回 choices[0].message.audio.data = base64 wav。
 * 官方文档：https://mimo.mi.com/docs/zh-CN/api/audio/tts
 */
export const MIMO_DEFAULT_BASE = 'https://api.xiaomimimo.com/v1'

/** 把用户填的 base URL 归一化为完整合成端点（兼容已带 /chat/completions 的写法） */
function mimoEndpoint(baseURL?: string): string {
  const b = (baseURL || MIMO_DEFAULT_BASE).trim().replace(/\/+$/, '')
  return b.endsWith('/chat/completions') ? b : b + '/chat/completions'
}

/** 参考音频 MIME 猜测（对齐 Cyrene mimo-engine guessAudioMime，支持 wav/m4a/mp4/ogg/flac，其余按 mp3） */
function guessAudioMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4'
  if (ext === '.ogg') return 'audio/ogg'
  if (ext === '.flac') return 'audio/flac'
  return 'audio/mpeg'
}

/** 参考音频 → data URI（voice 字段要求，对齐 Cyrene buildVoiceDataUrl） */
function buildVoiceDataUrl(filePath: string): string {
  const audio = readFileSync(filePath)
  if (audio.length === 0) throw new Error('MiMo 克隆音频为空')
  return `data:${guessAudioMime(filePath)};base64,${audio.toString('base64')}`
}

/** 预置音色列表（mimo-v2.5-tts） */
export const MIMO_VOICES: Array<{ id: string; label: string }> = [
  { id: 'mimo_default', label: '默认音色' },
  { id: '冰糖', label: '冰糖' },
  { id: '茉莉', label: '茉莉' },
  { id: '苏打', label: '苏打' },
  { id: '白桦', label: '白桦' },
  { id: 'Mia', label: 'Mia' },
  { id: 'Chloe', label: 'Chloe' },
  { id: 'Milo', label: 'Milo' },
  { id: 'Dean', label: 'Dean' }
]

export const MIMO_MODELS: Array<{ id: string; label: string }> = [
  { id: 'mimo-v2.5-tts', label: 'mimo-v2.5-tts（预置音色）' },
  { id: 'mimo-v2.5-tts-voiceclone', label: 'mimo-v2.5-tts-voiceclone（克隆你的参考音频）' }
]

export interface MimoTtsRequest {
  text: string
  apiKey: string
  model?: string
  voice?: string
  baseURL?: string
  /** voiceclone 模式的参考音频本地路径（必填，对齐 Cyrene voiceAudioPath） */
  refAudio?: string
  /** 风格指令：作为 user 消息传给 MiMo（可选；对齐 Cyrene stylePrompt，缺省可回退到参考音频文本） */
  stylePrompt?: string
  /** true = 跳过本地缓存强制重新合成 */
  force?: boolean
}

/** MiMo 缓存 key：模型 + 音色（或参考音频指纹） + 语气描述 + 文本 */
function mimoCacheKey(req: MimoTtsRequest, text: string): string {
  const voice = req.model === 'mimo-v2.5-tts-voiceclone'
    ? 'clone:' + (req.refAudio ? refFingerprint(req.refAudio) : 'none')
    : 'voice:' + (req.voice || 'mimo_default')
  const style = (req.stylePrompt || '').trim()
  return createHash('sha1').update(`mimo|${req.model || ''}|${voice}|${style}|${text}`).digest('hex')
}

/** 测试 MiMo 连接：用最小请求验证 Key 是否有效（不实际合成，不产生音频计费） */
export async function mimoProbe(apiKey: string, baseURL?: string): Promise<{ ok: boolean; error?: string }> {
  if (!apiKey) return { ok: false, error: '缺少 MiMo API Key（设置 → 语音朗读 → 小米 MiMo）。' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15000)
  try {
    const res = await fetch(mimoEndpoint(baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        // MiMo TTS 模型要求消息里必须有 assistant 角色（其 content 即待合成文本），
        // 纯 user 消息会 400。这里发一段最小合成请求验证全链路。
        model: 'mimo-v2.5-tts',
        messages: [
          { role: 'user', content: '' },
          { role: 'assistant', content: '测试' }
        ],
        audio: { format: 'wav', voice: 'mimo_default' }
      }),
      signal: ctl.signal
    })
    if (res.ok) return { ok: true }
    if (res.status === 401 || res.status === 403) return { ok: false, error: `MiMo TTS 鉴权失败（${res.status}）：API Key 无效。` }
    const txt = (await res.text()).slice(0, 200)
    return { ok: false, error: `MiMo TTS 连接失败: ${res.status} ${txt}`.trim() }
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err.name === 'AbortError') return { ok: false, error: 'MiMo 连接超时（15s）。检查网络或 API 地址。' }
    return { ok: false, error: `MiMo TTS 请求失败: ${err.message || '未知错误'}` }
  } finally {
    clearTimeout(timer)
  }
}

/** 合成：chat/completions + audio 参数，返回 wav dataUrl（对齐 Cyrene mimo-engine 契约） */
export async function synthesizeMiMo(req: MimoTtsRequest): Promise<TtsResult> {
  const text = cleanForSpeech(req.text || '')
  if (!text) return { ok: false, error: '缺少合成文本' }
  const chars = text.length
  const clipped = text.length > MAX_SPEECH_CHARS ? text.slice(0, MAX_SPEECH_CHARS) : text

  // 本地缓存：同模型 + 同音色 + 同文本 → 秒播（不走网络；force 时跳过）
  const key = mimoCacheKey(req, clipped)
  const hit = cacheGet(key)
  if (hit && hit.length > 0 && !req.force) {
    return { ok: true, dataUrl: `data:audio/wav;base64,${hit.toString('base64')}`, cached: true, chars }
  }

  const existing = inflight.get(key)
  if (existing) return existing

  const task = (async () => {
    const apiKey = (req.apiKey || '').trim()
    if (!apiKey) return { ok: false, error: '缺少 MiMo API Key（设置 → 语音朗读 → 小米 MiMo）。', chars }

    // voiceclone：克隆音频必填；预置音色：voice 用音色 ID（UI 两种模式都保留）
    let voice: string
    const isClone = (req.model || 'mimo-v2.5-tts-voiceclone') === 'mimo-v2.5-tts-voiceclone'
    if (isClone) {
      const refAudio = (req.refAudio || '').trim()
      if (!refAudio || !existsSync(refAudio)) {
        return { ok: false, error: '缺少 MiMo 克隆音频：请在「语音朗读」里选择一段 3~10 秒的 wav/mp3。', chars }
      }
      try {
        voice = buildVoiceDataUrl(refAudio)
      } catch (e) {
        return { ok: false, error: (e as Error).message, chars }
      }
    } else {
      voice = req.voice || 'mimo_default'
    }

    // 消息结构（对齐 Cyrene）：有语气描述（风格指令）才加 user 消息，合成文本放 assistant
    const messages: Array<{ role: string; content: string }> = []
    const stylePrompt = (req.stylePrompt || '').trim()
    if (stylePrompt) {
      messages.push({ role: 'user', content: stylePrompt })
    } else if (!isClone) {
      // 预置音色无语气描述时给一个默认朗读风格
      messages.push({ role: 'user', content: '请用自然、温柔的中文朗读下面的内容。' })
    }
    messages.push({ role: 'assistant', content: clipped })

    const endpointUrl = mimoEndpoint(req.baseURL)
    const body = JSON.stringify({
      model: req.model || 'mimo-v2.5-tts-voiceclone',
      messages,
      audio: { format: 'wav', voice }
    })
    // MiMo 云端偶发慢响应/瞬时限流：自动重试一次（网络错误与 429/超时），避免"每次都要重新试听"
    let lastHint = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), 90000)
      try {
        const res = await fetch(endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': apiKey
          },
          body,
          signal: ctl.signal
        })
        if (!res.ok) {
          const preview = (await res.text().catch(() => '')).slice(0, 200)
          if (res.status === 401 || res.status === 403) {
            return { ok: false, error: `MiMo TTS 鉴权失败（${res.status}）：API Key 无效，请到设置里重新填写。`, chars }
          }
          // 429 限流：等服务端喘息一下再试一次
          if (res.status === 429 && attempt === 1) {
            lastHint = 'MiMo 限流（429），自动重试一次'
            await new Promise((r) => setTimeout(r, 3000))
            continue
          }
          return { ok: false, error: `MiMo TTS 合成失败: ${res.status} ${preview}`.trim(), chars }
        }
        const j = (await res.json()) as {
          choices?: Array<{ message?: { audio?: { data?: string } } }>
        }
        const b64 = j.choices?.[0]?.message?.audio?.data
        if (typeof b64 !== 'string' || !b64.trim()) {
          return { ok: false, error: 'MiMo TTS 响应缺少音频数据', chars }
        }
        const buf = Buffer.from(b64, 'base64')
        if (buf.length === 0) return { ok: false, error: 'MiMo TTS 返回空音频', chars }
        const r = finishAudio(buf, chars)
        if (r.ok && r.dataUrl) cachePut(key, buf, clipped)
        return r
      } catch (e) {
        const err = e as { name?: string; message?: string }
        if (err.name === 'AbortError' && attempt === 1) {
          lastHint = 'MiMo 合成超时（90s），自动重试一次'
          await new Promise((r) => setTimeout(r, 2000))
          continue
        }
        if (attempt === 1) {
          lastHint = '网络波动，自动重试一次'
          await new Promise((r) => setTimeout(r, 2000))
          continue
        }
        if (err.name === 'AbortError') {
          return { ok: false, error: 'MiMo TTS 合成超时（90s）。可稍后再试。', chars }
        }
        return { ok: false, error: `MiMo TTS 请求失败: ${err.message || '未知错误'}`, chars }
      } finally {
        clearTimeout(timer)
      }
    }
    return { ok: false, error: `MiMo TTS 合成失败：${lastHint || '未知错误'}`, chars }
  })()
  inflight.set(key, task)
  void task.finally(() => {
    if (inflight.get(key) === task) inflight.delete(key)
  })
  return task
}
