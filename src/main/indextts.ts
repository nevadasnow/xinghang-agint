import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { createHash } from 'crypto'
import { dirname, join, resolve } from 'path'
import { app } from 'electron'
import { cleanForSpeech, refFingerprint } from './tts'

/**
 * IndexTTS 本地引擎（参照 D:\shorekeeper-agent 的实现逐行移植）。
 *
 * 运行时布局：
 *   <installDir>/IndexTTSRuntime/
 *     python313/python.exe          内置 Python（拷贝自源项目）
 *     index-tts/                    引擎仓库（checkpoints_1_5 模型 + .venv）
 *     index-tts/checkpoints_1_5     1.5 低显存模型（gpt.pth + bigvgan_generator.pth）
 *   resources/indextts/runner.py    子进程入口（stdin/stdout JSON 协议）
 *
 * 通信协议（与源项目一致）：
 *   spawn python runner.py，stdin 写 {id, text, voice, output, lang}
 *   stdout 行内嵌 "@@INDEXTTS@@" + JSON：ready / result / error / fatal
 *
 * 设计取舍：
 *   1) 常驻子进程：首个请求加载模型（最长 5 分钟），之后复用；
 *   2) 本地缓存：userData/tts-cache/indextts/sha1(refAudio\0text).wav；
 *   3) 运行设备 cuda/cpu 通过 INDEXTTS_DEVICE 注入（切换设备会重启进程）。
 */

const PREFIX = '@@INDEXTTS@@'
const LOAD_TIMEOUT_MS = 5 * 60 * 1000
const SYNTH_TIMEOUT_MS = 10 * 60 * 1000

export interface IndexTtsParams {
  /** 待合成文本 */
  text: string
  /** 参考音频绝对路径（决定克隆音色） */
  refAudio: string
  /** 运行设备：cuda=NVIDIA GPU；cpu=CPU */
  device: 'cuda' | 'cpu'
  /** 语言（默认 ZH） */
  lang?: string
  /** true = 跳过本地缓存强制重新合成 */
  force?: boolean
}

export interface IndexTtsStatusResult {
  ok: boolean
  message: string
  paths: {
    installDir: string
    python: string
    repo: string
    runner: string
    modelDir: string
  }
}

export interface IndexTtsOut {
  ok: boolean
  dataUrl?: string
  error?: string
  chars?: number
  cached?: boolean
}

let child: ChildProcess | null = null
let ready: Promise<void> | null = null
let signature = ''
let sequence = 0
const pending = new Map<string, { resolve: (p: string) => void; reject: (e: Error) => void }>()

function runtimeInstallRoot(): string {
  return app.isPackaged
    ? join(dirname(process.execPath), 'IndexTTSRuntime')
    : resolve(app.getAppPath(), 'IndexTTSRuntime')
}

/** 解析引擎各部件路径（打包态：exe 同级 IndexTTSRuntime；开发态：项目根 IndexTTSRuntime） */
function defaults() {
  const installDir = runtimeInstallRoot()
  const repo = resolve(join(installDir, 'index-tts'))
  const runtimePython = join(installDir, 'python313', 'python.exe')
  const venvPython = join(repo, '.venv', 'Scripts', 'python.exe')
  const python = existsSync(runtimePython) ? runtimePython : venvPython
  const modelDir = resolve(join(repo, 'checkpoints_1_5'))
  const runner = app.isPackaged
    ? join(process.resourcesPath, 'indextts', 'runner.py')
    : join(app.getAppPath(), 'resources', 'indextts', 'runner.py')
  return { installDir, python, repo, modelDir, runner }
}

/** 引擎就绪检测：检查 python / 引擎仓库 / runner / 1.5 模型四件套 */
export function indexttsStatus(): IndexTtsStatusResult {
  const paths = defaults()
  const missing = [
    paths.python,
    paths.repo,
    paths.runner,
    join(paths.modelDir, 'config.yaml'),
    join(paths.modelDir, 'gpt.pth'),
    join(paths.modelDir, 'bigvgan_generator.pth'),
    join(paths.modelDir, 'bpe.model')
  ].filter((p) => !existsSync(p))
  return {
    ok: missing.length === 0,
    message: missing.length
      ? `IndexTTS 尚未就绪，缺少：${missing.join('；')}`
      : `IndexTTS 1.5 低显存版已就绪（${paths.repo}）`,
    paths
  }
}

/** STT（语音识别）模型就绪检测：faster-whisper 模型目录需含 config.json + model.bin */
export function indexttsSttStatus(modelDir: string): { ok: boolean; message: string } {
  const dir = String(modelDir ?? '').trim()
  if (!dir) return { ok: false, message: '未设置本地模型目录' }
  if (!existsSync(dir)) return { ok: false, message: `模型目录不存在：${dir}` }
  const missing = ['config.json', 'model.bin'].filter((f) => !existsSync(join(dir, f)))
  return missing.length
    ? { ok: false, message: `faster-whisper 模型不完整，缺少：${missing.join('、')}` }
    : { ok: true, message: 'faster-whisper 模型已就绪' }
}

function stopWorker(): void {
  const proc = child
  child = null
  ready = null
  if (proc && !proc.killed) proc.kill()
  for (const item of pending.values()) item.reject(new Error('IndexTTS 进程已停止'))
  pending.clear()
}

/** 拉起/复用常驻引擎进程（python runner），设备或模型目录变化时重启 */
async function ensureWorker(device: 'cuda' | 'cpu'): Promise<void> {
  const status = indexttsStatus()
  if (!status.ok) throw new Error(status.message)
  const paths = status.paths
  const nextSignature = JSON.stringify([paths.python, paths.modelDir, device])
  if (child && signature === nextSignature && ready) return ready
  stopWorker()
  signature = nextSignature
  const tempDir = join(paths.repo, '.tmp')
  mkdirSync(tempDir, { recursive: true })
  ready = new Promise((resolveReady, rejectReady) => {
    const proc = spawn(paths.python, [paths.runner], {
      cwd: paths.repo,
      windowsHide: true,
      env: {
        ...process.env,
        INDEXTTS_MODEL_DIR: paths.modelDir,
        INDEXTTS_DEVICE: device === 'cpu' ? 'cpu' : 'cuda:0',
        PYTHONPATH: [
          join(paths.repo, '.venv', 'Lib', 'site-packages'),
          paths.repo,
          process.env.PYTHONPATH ?? ''
        ].filter(Boolean).join(';'),
        TEMP: tempDir,
        TMP: tempDir,
        PYTHONUTF8: '1'
      }
    })
    child = proc
    let buffer = ''
    proc.stdout?.setEncoding('utf8')
    proc.stdout?.on('data', (chunk: string) => {
      buffer += chunk
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const at = line.indexOf(PREFIX)
        if (at < 0) continue
        try {
          const msg = JSON.parse(line.slice(at + PREFIX.length))
          if (msg.type === 'ready') resolveReady()
          else if (msg.type === 'fatal') rejectReady(new Error(msg.error))
          else if (msg.id && pending.has(msg.id)) {
            const item = pending.get(msg.id)!
            pending.delete(msg.id)
            if (msg.type === 'result') item.resolve(msg.path)
            else item.reject(new Error(msg.error || 'IndexTTS 合成失败'))
          }
        } catch {
          /* 非协议行忽略 */
        }
      }
    })
    let stderr = ''
    proc.stderr?.setEncoding('utf8')
    proc.stderr?.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-5000)
    })
    proc.on('exit', (code) => {
      const error = new Error(`IndexTTS 进程退出（${code ?? 'unknown'}）${stderr ? `：${stderr.slice(-1000)}` : ''}`)
      rejectReady(error)
      if (child === proc) {
        child = null
        ready = null
        for (const item of pending.values()) item.reject(error)
        pending.clear()
      }
    })
  })
  const startup = ready
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('IndexTTS 模型加载超时（5 分钟）')), LOAD_TIMEOUT_MS)
  })
  return Promise.race([startup, timeout])
}

/** 合成一段文本 → wav → dataUrl（同文本二次朗读走本地缓存） */
export async function indexttsSynthesize(params: IndexTtsParams): Promise<IndexTtsOut> {
  const ref = String(params.refAudio ?? '').trim()
  if (!ref || !existsSync(ref)) {
    return { ok: false, error: '请先选择有效的参考音频（建议 5–15 秒、无背景音乐）' }
  }
  const clean = cleanForSpeech(params.text).replace(/\s+/g, ' ').trim()
  if (!clean) return { ok: false, error: '没有可合成的文本' }
  try {
    await ensureWorker(params.device)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  const id = `tts_${Date.now().toString(36)}_${++sequence}`
  const cacheDir = join(app.getPath('userData'), 'tts-cache', 'indextts')
  mkdirSync(cacheDir, { recursive: true })
  // 缓存 key 用参考音频内容指纹（而非路径）：换文件/覆盖同一文件换内容都会自动失效，试听会重新合成
  const hash = createHash('sha1').update(refFingerprint(ref) + '\0' + clean).digest('hex').slice(0, 20)
  const output = join(cacheDir, hash + '.wav')
  let cached = false
  let path = output
  if (!params.force && existsSync(output)) {
    cached = true
  } else {
    cached = false
    const proc = child
    if (!proc) return { ok: false, error: 'IndexTTS 进程不可用' }
    try {
      path = await new Promise<string>((resolveResult, reject) => {
        pending.set(id, { resolve: resolveResult, reject })
        proc.stdin?.write(
          JSON.stringify({ id, text: clean, voice: ref, output, lang: params.lang || 'ZH' }) + '\n'
        )
        setTimeout(() => {
          pending.delete(id)
          reject(new Error('IndexTTS 语音合成超时（10 分钟）'))
        }, SYNTH_TIMEOUT_MS)
      })
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
  try {
    const bytes = statSync(path).size
    if (bytes <= 0) return { ok: false, error: 'IndexTTS 输出为空' }
    const b64 = readFileSync(path).toString('base64')
    return { ok: true, dataUrl: `data:audio/wav;base64,${b64}`, chars: clean.length, cached }
  } catch (e) {
    return { ok: false, error: `读取合成音频失败：${(e as Error).message}` }
  }
}

/** 按文本删除 IndexTTS 缓存 wav（hash 规则与合成一致：指纹+\0+clean） */
export function indexttsCacheDeleteText(text: string, refAudio: string): void {
  const clean = cleanForSpeech(text || '').replace(/\s+/g, ' ').trim()
  if (!clean || !refAudio) return
  try {
    const dir = join(app.getPath('userData'), 'tts-cache', 'indextts')
    if (!existsSync(dir)) return
    const hash = createHash('sha1').update(refFingerprint(refAudio) + '\0' + clean).digest('hex').slice(0, 20)
    const p = join(dir, hash + '.wav')
    if (existsSync(p)) unlinkSync(p)
  } catch {
    /* 缓存清理失败不影响主流程 */
  }
}

/** 进程清理（应用退出时调用） */
export function disposeIndexTts(): void {
  stopWorker()
}
