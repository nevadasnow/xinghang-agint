import { exec } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, readdir } from 'fs'
import { join } from 'path'
import { promisify } from 'util'
import os from 'os'
import { app, screen, shell } from 'electron'
import type { AgentMode, LlmConfig, TaskItem, ToolDefinition, ToolExecContext, ToolMode } from '../shared/types'
import { deleteTask, listSessions, listTasks, patchTask, saveTask } from './store'
import { listMemory } from './memory'
import { listDocuments } from './rag'
import { getUsageStats } from './usage'
// 内置浏览器的 Agent 工具（规格 5 · 八）：操作的是右侧面板里那个 <webview> 实例
import { BROWSER_TOOLS, BROWSER_TOOL_PARAMS } from './browser-tools'

// ============================================================
// 工具注册表（复刻自 Shorekeeper orchestrator/tool-registry.js）
// - 单例 ToolRegistry：register / getAllTools / getById
// - 过滤优先级：总开关(enabled) → overrides[id][mode]（显式覆盖）
//   → modes.includes(mode)；未声明 modes 且无覆盖 → 全模式可见
// - chat 模式双轨：chatBuiltin 内建集 + chatToolsEnabled 开启后的
//   opt-in（overrides[id].chat===true）
// ============================================================

const execAsync = promisify(exec)

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool)
  }

  getAllTools(): ToolDefinition[] {
    return [...this.tools.values()]
  }

  getById(id: string): ToolDefinition | undefined {
    return this.tools.get(id)
  }
}

export const toolRegistry = new ToolRegistry()

export function isToolAvailable(tool: ToolDefinition): boolean {
  // unavailable：宿主未接入对应后端（execute 只返回占位说明），
  // 不注册给模型，避免模型调用后拿到「未接入」而浪费一轮。
  return tool.enabled && !tool.deprecated && !tool.unavailable
}

/** 非 chat 模式过滤：总开关 → override → modes 声明（未声明且无 override → 全模式可见） */
export function getEnabledToolsForMode(
  mode: ToolMode,
  overrides: Record<string, Record<ToolMode, boolean>>
): ToolDefinition[] {
  return toolRegistry.getAllTools().filter((tool) => {
    if (!isToolAvailable(tool)) return false
    const ov = overrides[tool.id]
    if (ov && ov[mode] !== undefined) return ov[mode]
    if (tool.modes.length === 0) return true
    return tool.modes.includes(mode)
  })
}

/** chat 模式工具集（参照 Shorekeeper run-capabilities 的 chat 双轨） */
export function resolveChatTools(config: LlmConfig): ToolDefinition[] {
  const all = toolRegistry.getAllTools().filter(isToolAvailable)
  const ov = config.toolModeOverrides
  if (!config.chatToolsEnabled) {
    // 关闭增强：只给 chatBuiltin 内建集（可被 override chat:false 隐藏）
    return all.filter((t) => t.chatBuiltin === true && ov[t.id]?.chat !== false)
  }
  // 开启增强：内建集 + 用户显式 opt-in 的工具（overrides[id].chat===true）
  return all.filter(
    (t) => (t.chatBuiltin === true && ov[t.id]?.chat !== false) || ov[t.id]?.chat === true
  )
}

/** 运行时工具目录（注入 system prompt，参照 Shorekeeper buildToolCatalog 的 `- id 用途 风险` 形态） */
export function buildToolCatalog(mode: AgentMode, config: LlmConfig): string {
  const tools = mode === 'chat' ? resolveChatTools(config) : getEnabledToolsForMode(mode, config.toolModeOverrides)
  if (tools.length === 0) return ''
  const lines = tools.map((t) => {
    const risk = t.risk === 'safe' ? '' : `（${riskLabel(t.risk)}）`
    return `- ${t.id}：${t.name}${risk}`
  })
  return `## 当前可用工具（${mode === 'chat' ? '聊天模式' : mode === 'code' ? '代码模式' : '工作模式'}）\n${lines.join('\n')}\n\n规则：只使用上面列出的工具；未列出的能力不要假装拥有。`
}

function riskLabel(risk: ToolDefinition['risk']): string {
  switch (risk) {
    case 'fs-read':
      return '读取文件'
    case 'fs-write':
      return '修改文件'
    case 'shell':
      return '执行命令'
    case 'network':
      return '联网'
    case 'input-control':
      return '控制输入'
    case 'external_side_effect':
      return '外部副作用'
    default:
      return risk
  }
}

// ------------------------------------------------------------
// 通用小工具
// ------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url: string, timeoutSec = 20): Promise<string> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * E4 通用 HTTP 请求（GET/POST/PUT/PATCH/DELETE/HEAD）
 *
 * 与既有的 `fetch_url` 的区别：
 *   - `fetch_url` 面向**读网页**：GET、把 HTML 转文本、只给正文
 *   - 本工具面向**调接口**：可指定方法/头/请求体，返回状态码 + 响应头 + 原文
 *
 * 安全约束（重要）：
 *   1) 只放行 http/https，挡掉 file: 等本地协议
 *   2) **默认拒绝**指向本机/内网的地址，避免模型被诱导去探测用户的内网服务
 *      （需要时可以用 allowLocal 显式打开，但这个开关不暴露给模型）
 *   3) 响应体截断，防止一个巨大响应把上下文顶爆
 */
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
const HTTP_MAX_BODY = 20_000

function looksLocal(url: string): boolean {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true
    // 私有网段与链路本地
    if (/^10\./.test(host)) return true
    if (/^192\.168\./.test(host)) return true
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
    if (/^169\.254\./.test(host)) return true
    return false
  } catch {
    return false
  }
}

async function httpRequest(args: Record<string, unknown>): Promise<string> {
  const url = String(args.url ?? '').trim()
  if (!/^https?:\/\//i.test(url)) return '请提供以 http:// 或 https:// 开头的完整地址。'

  if (looksLocal(url)) {
    return '出于安全考虑，这个工具不会请求本机或内网地址（localhost / 127.0.0.1 / 私有网段）。如果你确实要调试本地服务，请直接在终端里用 curl。'
  }

  const method = String(args.method ?? 'GET').toUpperCase()
  if (!HTTP_METHODS.has(method)) {
    return `不支持的方法：${method}。可用：${[...HTTP_METHODS].join(' / ')}`
  }

  // 请求头：接受对象，也接受 JSON 字符串（模型有时会传字符串）
  let headers: Record<string, string> = {}
  const rawHeaders = args.headers
  if (rawHeaders && typeof rawHeaders === 'object') {
    headers = Object.fromEntries(
      Object.entries(rawHeaders as Record<string, unknown>).map(([k, v]) => [k, String(v)])
    )
  } else if (typeof rawHeaders === 'string' && rawHeaders.trim()) {
    try {
      const parsed = JSON.parse(rawHeaders) as Record<string, unknown>
      headers = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]))
    } catch {
      return '请求头需要是 JSON 对象，例如 {"Content-Type":"application/json"}。'
    }
  }

  let body: string | undefined
  if (args.body !== undefined && method !== 'GET' && method !== 'HEAD') {
    body =
      typeof args.body === 'string'
        ? args.body
        : JSON.stringify(args.body)
    // 传了 JSON 体但没声明 Content-Type 时补上，否则很多接口会 400
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      try {
        JSON.parse(body)
        headers['Content-Type'] = 'application/json'
      } catch {
        /* 不是 JSON，保持原样 */
      }
    }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 30_000)
  const started = Date.now()
  try {
    const res = await fetch(url, { method, headers, body, signal: ctrl.signal })
    const ms = Date.now() - started
    const text = method === 'HEAD' ? '' : await res.text()
    const clipped = text.length > HTTP_MAX_BODY ? text.slice(0, HTTP_MAX_BODY) + `\n…（已截断，完整长度 ${text.length} 字符）` : text
    const headLines = [...res.headers.entries()].slice(0, 20).map(([k, v]) => `  ${k}: ${v}`)

    return [
      `${method} ${url}`,
      `状态：${res.status} ${res.statusText}（${ms}ms）`,
      headLines.length ? `响应头：\n${headLines.join('\n')}` : '',
      '',
      clipped || '（响应体为空）'
    ]
      .filter(Boolean)
      .join('\n')
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err.name === 'AbortError') return '请求超时（30 秒）。'
    return `请求失败：${err.message ?? String(e)}`
  } finally {
    clearTimeout(timer)
  }
}

/** 简易翻译：复用已配置的大模型 */
async function translateWithLlm(text: string, target: string, ctx?: ToolExecContext): Promise<string> {
  const cfg = ctx?.config
  if (!cfg?.apiKey || !cfg?.baseURL) {
    return '未配置大模型接口，无法翻译。请先在「模型设置」中配置接口地址与 API Key。'
  }
  const base = cfg.baseURL.replace(/\/+$/, '')
  const urls = /maas\.aliyuncs\.com/i.test(base) && /\/api\/v1$/i.test(base)
    ? [`${base.replace(/\/api\/v1$/i, '/compatible-mode/v1')}/chat/completions`]
    : [`${base}/chat/completions`]
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), Math.min(cfg.timeoutSec || 120, 30) * 1000)
  try {
    const res = await fetch(urls[0], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey.trim()}` },
      body: JSON.stringify({
        model: cfg.model.trim(),
        messages: [
          { role: 'system', content: '你是专业翻译。只输出译文本身，不要任何解释、引号或前后缀。' },
          { role: 'user', content: `翻译成${target}：\n${text.slice(0, 4000)}` }
        ],
        stream: false,
        temperature: 0.3
      }),
      signal: ctrl.signal
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() || '（翻译结果为空）'
  } finally {
    clearTimeout(timer)
  }
}

function ledgerPath(): string {
  return join(app.getPath('userData'), 'ledger.json')
}

interface Ledger {
  items: Array<{ id: string; type: 'in' | 'out'; amount: number; note: string; at: number }>
}

function readLedger(): Ledger {
  try {
    if (!existsSync(ledgerPath())) return { items: [] }
    const raw = JSON.parse(readFileSync(ledgerPath(), 'utf-8'))
    return { items: Array.isArray(raw.items) ? raw.items : [] }
  } catch {
    return { items: [] }
  }
}

const DANGEROUS_SHELL_RE =
  /^\s*(rm\s+(-rf\s+)?\/|del\s+\/s\s+\/q\s+c:|format\s+c:|shutdown\b|reboot\b|rd\s+\/s\s+\/q\s+c:\\)/i

async function runCommand(command: string, cwd?: string): Promise<string> {
  if (DANGEROUS_SHELL_RE.test(command)) {
    return '[安全拦截] 该命令被判定为危险操作（格式化/删除系统盘/关机重启），已拒绝执行。'
  }
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwd || undefined,
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true
    })
    const out = `${stdout || ''}${stderr ? '\n[stderr] ' + stderr : ''}`.trim()
    return out.length > 4000 ? out.slice(0, 4000) + '\n…（输出过长已截断）' : (out || '（无输出）')
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string }
    return `执行失败：${err.message ?? String(e)}${err.stdout ? '\n' + err.stdout : ''}${err.stderr ? '\n' + err.stderr : ''}`.slice(0, 4000)
  }
}

function notImplemented(name: string): (args: Record<string, unknown>, ctx?: ToolExecContext) => Promise<string> {
  return async () =>
    `[未接入] “${name}”是 Shorekeeper 专属后端能力，守岸人目前未接入对应服务。开关体系、模式声明与元数据已完整复刻；接入后端后此工具即可被守岸人调用。`
}

// ------------------------------------------------------------
// 注册全部工具（全量复刻 Shorekeeper 注册表）
// ------------------------------------------------------------

const BUILTIN_CORE: ToolDefinition[] = [
  {
    id: 'web_search',
    name: '联网搜索',
    description: '搜索互联网获取实时信息，返回结果标题、链接与摘要。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args) => {
      const q = String(args.query ?? args.q ?? '').trim()
      if (!q) return '请提供要搜索的关键词（query）。'
      try {
        const html = await fetchText(`https://www.baidu.com/s?wd=${encodeURIComponent(q)}`, 20)
        const titles = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/g)].slice(0, 8).map((m) =>
          m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
        )
        if (titles.length === 0) {
          // 回退：DuckDuckGo Instant Answer
          const json = await fetchText(`https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1`, 15)
          try {
            const d = JSON.parse(json)
            const ab = d.AbstractText
            const topics = (d.RelatedTopics ?? []).slice(0, 6).map((t: { Text?: string }) => t.Text).filter(Boolean)
            return ab ? `摘要：${ab}\n\n相关话题：\n- ${topics.join('\n- ')}` : `未检索到摘要。建议：${topics.join('、') || '换个关键词'}`
          } catch {
            return '搜索服务暂不可用，请稍后再试。'
          }
        }
        return `搜索结果（百度）：\n${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      } catch (e) {
        return `搜索失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'fetch_url',
    name: '读取网页',
    description: '下载指定 URL 的网页内容并返回正文（转成可读文本，保留标题）。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args) => {
      const url = String(args.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return '请提供以 http:// 或 https:// 开头的完整网址。'
      try {
        const text = await fetchText(url, 25)
        const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]?.trim() ?? ''
        const body = text
          .replace(/<script[\s\S]*?<\/script>/gi, ' ')
          .replace(/<style[\s\S]*?<\/style>/gi, ' ')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/\s+/g, ' ')
          .trim()
        return `${title ? '标题：' + title + '\n' : ''}${body.slice(0, 6000)}${body.length > 6000 ? '\n…（正文过长已截断）' : ''}`
      } catch (e) {
        return `读取失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'http_request',
    name: 'HTTP 请求',
    description:
      '调用任意 HTTP 接口（GET/POST/PUT/PATCH/DELETE/HEAD），可自定义请求头与请求体，返回状态码、响应头与响应正文。适合调试 API、查接口返回。不接受本机与内网地址。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'network',
    verificationPolicy: 'none',
    execute: httpRequest
  },
  {
    id: 'download_file',
    name: '下载文件',
    description: '把指定 URL 的文件下载保存到本地路径。',
    enabled: true,
    modes: [],
    effectKind: 'mutation',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args) => {
      const url = String(args.url ?? '').trim()
      const path = String(args.path ?? '').trim()
      if (!/^https?:\/\//i.test(url)) return '请提供合法的下载地址。'
      if (!path) return '请提供保存路径（path）。'
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 60_000)
        const res = await fetch(url, { signal: ctrl.signal })
        clearTimeout(timer)
        if (!res.ok) return `下载失败：HTTP ${res.status}`
        const buf = Buffer.from(await res.arrayBuffer())
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, buf)
        return `已下载 ${buf.length} 字节到 ${path}`
      } catch (e) {
        return `下载失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'run_shell',
    name: '执行命令',
    description: '在用户电脑上执行一条 Shell 命令（cmd 语法），返回 exitCode 与输出。危险命令会被拦截。',
    enabled: true,
    modes: ['code', 'work'],
    effectKind: 'unknown',
    risk: 'shell',
    verificationPolicy: 'none',
    execute: async (args, ctx) => {
      const command = String(args.command ?? '').trim()
      if (!command) return '请提供要执行的命令（command）。'
      const cwd = String(args.cwd ?? '') || undefined
      return runCommand(command, cwd && existsSync(cwd) ? cwd : undefined)
    }
  },
  {
    id: 'run_verification',
    name: '运行验证',
    description: '执行代码验证（类型检查 / 测试 / 构建 / lint），返回结果。是唯一能产生可信验证证据的工具。',
    enabled: true,
    modes: ['code', 'work'],
    effectKind: 'verification',
    risk: 'shell',
    verificationPolicy: 'bypass',
    execute: async (args) => {
      const type = String(args.verificationType ?? args.type ?? 'typecheck').trim()
      const cwd = String(args.cwd ?? '').trim() || undefined
      const scripts: Record<string, string> = {
        typecheck: 'npm run typecheck',
        test: 'npm test',
        build: 'npm run build',
        lint: 'npm run lint'
      }
      const cmd = scripts[type] ?? `npm run ${type}`
      const r = await runCommand(cmd, cwd && existsSync(cwd) ? cwd : undefined)
      return `[验证 ${type}] ${r}`
    }
  },
  {
    id: 'weather',
    name: '查天气',
    description: '查询指定城市的实时天气：温度、体感、湿度、风速、降水、日出日落、AQI 等。',
    enabled: true,
    modes: ['work'],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args) => {
      const city = String(args.city ?? '').trim()
      if (!city) return '请提供要查询的城市名（city）。'
      try {
        const geo = JSON.parse(
          await fetchText(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`, 15)
        )
        const loc = geo.results?.[0]
        if (!loc) return `未找到城市「${city}」的坐标信息。`
        const w = JSON.parse(
          await fetchText(
            `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure&timezone=auto`,
            20
          )
        )
        const c = w.current ?? {}
        const codeMap: Record<number, string> = { 0: '晴', 1: '基本晴朗', 2: '多云', 3: '阴', 45: '雾', 51: '毛毛雨', 53: '小雨', 61: '小雨', 63: '中雨', 65: '大雨', 71: '小雪', 73: '中雪', 80: '阵雨', 95: '雷雨' }
        return [
          `${loc.name}（${loc.country ?? ''}${loc.admin1 ? '·' + loc.admin1 : ''}）当前天气：`,
          `天气：${codeMap[c.weather_code] ?? '未知'}｜温度 ${c.temperature_2m ?? '-'}°C（体感 ${c.apparent_temperature ?? '-'}°C）`,
          `湿度 ${c.relative_humidity_2m ?? '-'}%｜风速 ${c.wind_speed_10m ?? '-'} km/h｜气压 ${c.surface_pressure ?? '-'} hPa｜降水 ${c.precipitation ?? '-'} mm`
        ].join('\n')
      } catch (e) {
        return `天气查询失败：${(e as Error).message}`
      }
    }
  }
]

const FILE_TOOLS: ToolDefinition[] = [
  {
    id: 'read_file',
    name: '读取文件',
    description: '读取本地文本文件（小说、笔记、代码、配置、日志等），返回带行号内容。超过 256KB 自动截断，可用 startLine/maxLines 翻页。',
    enabled: true,
    modes: ['learn', 'code', 'work'],
    effectKind: 'read',
    risk: 'fs-read',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '请提供文件绝对路径（path）。'
      if (!existsSync(path)) return `文件不存在：${path}`
      try {
        const content = readFileSync(path, 'utf-8')
        const lines = content.split('\n')
        const start = Math.max(1, Number(args.startLine) || 1)
        const maxLines = Math.max(1, Math.min(500, Number(args.maxLines) || 200))
        const slice = lines.slice(start - 1, start - 1 + maxLines)
        const head = slice.map((l, i) => `${start + i}\t${l}`).join('\n')
        const truncated = lines.length > start - 1 + maxLines
        return `${path}（共 ${lines.length} 行，显示 ${start}-${start + slice.length - 1} 行）\n${head}${truncated ? '\n…（后续内容省略，可传 startLine 翻页）' : ''}`
      } catch (e) {
        return `读取失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'write_file',
    name: '写入文件',
    description: '把文本内容写入本地文件（覆盖或追加），自动创建父目录。',
    enabled: true,
    modes: ['code', 'work'],
    effectKind: 'mutation',
    risk: 'fs-write',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const content = String(args.content ?? '')
      if (!path) return '请提供文件路径（path）。'
      if (content.length > 500_000) return '内容过大（超过 500KB），请拆分写入。'
      try {
        mkdirSync(join(path, '..'), { recursive: true })
        if (args.append === true) {
          writeFileSync(path, content, { flag: 'a' })
        } else {
          writeFileSync(path, content)
        }
        return `已${args.append === true ? '追加' : '写入'} ${content.length} 字符 → ${path}`
      } catch (e) {
        return `写入失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'list_dir',
    name: '列出目录',
    description: '列出指定目录下的子目录和文件（对图片标注 [图片]，并汇总数量）。',
    enabled: true,
    modes: ['learn', 'code', 'work'],
    effectKind: 'read',
    risk: 'fs-read',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      if (!path) return '请提供目录绝对路径（path）。'
      if (!existsSync(path)) return `目录不存在：${path}`
      try {
        const entries = readdirSync(path, { withFileTypes: true }).filter((e) =>
          args.showHidden === true || !e.name.startsWith('.')
        )
        const dirs = entries.filter((e) => e.isDirectory())
        const files = entries.filter((e) => !e.isDirectory())
        const imgRe = /\.(png|jpe?g|gif|webp|bmp|svg)$/i
        const imgs = files.filter((f) => imgRe.test(f.name))
        const lines: string[] = []
        for (const d of dirs) lines.push(`${d.name}/`)
        for (const f of files) lines.push(`${f.name}${imgRe.test(f.name) ? ' [图片]' : ''}`)
        const head = lines.slice(0, 300).join('\n')
        return `${path}\n目录 ${dirs.length} 个，文件 ${files.length} 个（图片 ${imgs.length} 张）${entries.length > 300 ? '，仅显示前 300 项' : ''}\n${head}`
      } catch (e) {
        return `列出失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'Edit',
    name: 'Edit（精准编辑）',
    description: '对已有文件做局部精准替换：需先 Read 定位 old_string，再替换为新内容。',
    enabled: true,
    modes: ['learn'],
    effectKind: 'mutation',
    risk: 'fs-write',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const oldStr = String(args.old_string ?? '')
      const newStr = String(args.new_string ?? '')
      if (!path || !oldStr) return '请提供 path 与 old_string。'
      if (!existsSync(path)) return `文件不存在：${path}`
      try {
        const content = readFileSync(path, 'utf-8')
        if (!content.includes(oldStr)) return 'old_string 未在文件中找到，编辑中止（可能内容已变化，请先重新读取）。'
        writeFileSync(path, content.replace(oldStr, newStr))
        return `已编辑 ${path}（替换 1 处）`
      } catch (e) {
        return `编辑失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'Glob',
    name: 'Glob（查找文件）',
    description: '按通配模式查找文件路径列表。',
    enabled: true,
    modes: ['learn'],
    effectKind: 'read',
    risk: 'fs-read',
    verificationPolicy: 'none',
    execute: async (args) => {
      const pattern = String(args.pattern ?? '').trim()
      const path = String(args.path ?? '')
      if (!pattern) return '请提供查找模式（pattern），例如 **/*.ts。'
      try {
        const root = path || process.cwd()
        const { glob } = await import('glob')
        const matches = await glob(pattern, { cwd: existsSync(root) ? root : undefined, ignore: ['node_modules/**'] })
        return matches.length
          ? `找到 ${matches.length} 个匹配：\n${matches.slice(0, 100).join('\n')}${matches.length > 100 ? '\n…' : ''}`
          : '没有匹配的文件。'
      } catch (e) {
        return `查找失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'Grep',
    name: 'Grep（搜索内容）',
    description: '在文件或目录中按正则搜索文本，返回匹配行。',
    enabled: true,
    modes: ['learn'],
    effectKind: 'read',
    risk: 'fs-read',
    verificationPolicy: 'none',
    execute: async (args) => {
      const pattern = String(args.pattern ?? '').trim()
      const path = String(args.path ?? process.cwd()).trim()
      if (!pattern) return '请提供搜索模式（pattern）。'
      try {
        const { execFile } = await import('child_process')
        const { promisify: pr } = await import('util')
        const run = pr(execFile)
        const { stdout } = await run('rg', ['-n', '--no-heading', pattern, path, '-g', '!node_modules'], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })
        const lines = stdout.trim().split('\n')
        return lines.length ? `找到 ${lines.length} 处匹配：\n${lines.slice(0, 60).join('\n')}${lines.length > 60 ? '\n…' : ''}` : '没有匹配。'
      } catch (e) {
        const err = e as { code?: number }
        if (err.code === 1) return '没有匹配。'
        return `搜索失败（需要 ripgrep rg 命令）：${(e as Error).message}`
      }
    }
  },
  {
    id: 'Read',
    name: 'Read（读取文件）',
    description: '读取本地文件全文（支持图片以视觉方式读取）。',
    enabled: true,
    modes: ['learn'],
    effectKind: 'read',
    risk: 'fs-read',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? args.file_path ?? '').trim()
      if (!path) return '请提供文件路径（path）。'
      if (!existsSync(path)) return `文件不存在：${path}`
      try {
        const content = readFileSync(path, 'utf-8')
        return content.length > 20_000 ? content.slice(0, 20_000) + '\n…（过长已截断）' : content
      } catch (e) {
        return `读取失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'Write',
    name: 'Write（写入文件）',
    description: '创建或整体覆写一个文件。',
    enabled: true,
    modes: ['learn'],
    effectKind: 'mutation',
    risk: 'fs-write',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? args.file_path ?? '').trim()
      const content = String(args.content ?? '')
      if (!path) return '请提供文件路径（path）。'
      if (content.length > 500_000) return '内容过大（超过 500KB）。'
      try {
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, content)
        return `已写入 ${content.length} 字符 → ${path}`
      } catch (e) {
        return `写入失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'apply_patch',
    name: '编辑文件（补丁）',
    description: '对代码文件做多块精准修改（Shorekeeper apply-patch 语义），守岸人按逐块替换实现。',
    enabled: true,
    modes: ['code'],
    effectKind: 'mutation',
    risk: 'fs-write',
    verificationPolicy: 'artifact',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const edits = args.edits
      if (!path || !existsSync(path)) return '请提供存在的文件路径（path）。'
      if (!Array.isArray(edits) || edits.length === 0) return '请提供 edits 数组（[{old_string, new_string}]）。'
      try {
        let content = readFileSync(path, 'utf-8')
        let count = 0
        for (const e of edits) {
          const oldStr = String((e as { old_string?: unknown }).old_string ?? '')
          const newStr = String((e as { new_string?: unknown }).new_string ?? '')
          if (oldStr && content.includes(oldStr)) {
            content = content.replace(oldStr, newStr)
            count++
          }
        }
        if (count === 0) return '没有可应用的修改（old_string 均未命中）。'
        writeFileSync(path, content)
        return `已应用 ${count} 处修改 → ${path}`
      } catch (e) {
        return `编辑失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'str_replace',
    name: '精确替换',
    description: '对文件中唯一出现的字符串做精确替换。',
    enabled: true,
    modes: ['code'],
    effectKind: 'mutation',
    risk: 'fs-write',
    verificationPolicy: 'none',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const oldStr = String(args.old_string ?? '')
      const newStr = String(args.new_string ?? '')
      if (!path || !oldStr) return '请提供 path 与 old_string。'
      if (!existsSync(path)) return `文件不存在：${path}`
      try {
        const content = readFileSync(path, 'utf-8')
        const count = content.split(oldStr).length - 1
        if (count === 0) return 'old_string 未找到。'
        if (count > 1) return `old_string 出现 ${count} 次，不是唯一匹配，请提供更多上下文。`
        writeFileSync(path, content.replace(oldStr, newStr))
        return `已替换 1 处 → ${path}`
      } catch (e) {
        return `替换失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'search_text',
    name: '文本搜索',
    description: '在当前工作区按关键词搜索文本（rg 实现）。',
    enabled: true,
    modes: ['code'],
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      const q = String(args.query ?? args.pattern ?? '').trim()
      const path = String(args.path ?? process.cwd()).trim()
      if (!q) return '请提供搜索关键词（query）。'
      try {
        const { execFile } = await import('child_process')
        const { promisify: pr } = await import('util')
        const { stdout } = await pr(execFile)('rg', ['-n', '--no-heading', q, path, '-g', '!node_modules'], { timeout: 15_000, maxBuffer: 2 * 1024 * 1024 })
        const lines = stdout.trim().split('\n')
        return lines.length ? `找到 ${lines.length} 处：\n${lines.slice(0, 60).join('\n')}${lines.length > 60 ? '\n…' : ''}` : '没有匹配。'
      } catch (e) {
        const err = e as { code?: number }
        if (err.code === 1) return '没有匹配。'
        return `搜索失败（需要 ripgrep rg）：${(e as Error).message}`
      }
    }
  },
  {
    id: 'search_code',
    name: '搜索代码',
    description: '搜索代码文件（已废弃，请使用 search_text）。',
    enabled: true,
    modes: ['code'],
    deprecated: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => '该工具已废弃，请使用 search_text 或 ast_grep_search。'
  },
  {
    id: 'write_markdown',
    name: '写 Markdown',
    description: '生成 Markdown 文档并写入本地文件。',
    enabled: true,
    modes: ['learn'],
    effectKind: 'mutation',
    risk: 'fs-write',
    verificationPolicy: 'artifact',
    execute: async (args) => {
      const path = String(args.path ?? '').trim()
      const content = String(args.content ?? '')
      if (!path) return '请提供文件路径（path）。'
      try {
        mkdirSync(join(path, '..'), { recursive: true })
        writeFileSync(path, content)
        return `已生成 Markdown（${content.length} 字符）→ ${path}`
      } catch (e) {
        return `写入失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'exchange_rate',
    name: '汇率查询',
    description: '查询两种货币间的实时汇率（默认美元兑人民币）。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args) => {
      const from = String(args.from ?? 'USD').toUpperCase()
      const to = String(args.to ?? 'CNY').toUpperCase()
      try {
        const data = JSON.parse(await fetchText(`https://open.er-api.com/v6/latest/${from}`, 15))
        if (!data.rates) return '汇率接口未返回数据，请稍后再试。'
        const rate = data.rates[to]
        if (!rate) return `不支持货币：${to}`
        const amount = Number(args.amount) || 1
        return `${amount} ${from} = ${(amount * rate).toFixed(4)} ${to}（1 ${from} ≈ ${rate} ${to}，数据源 open.er-api.com，更新于 ${data.time_last_update_utc ?? '最近'})`
      } catch (e) {
        return `汇率查询失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'translate',
    name: '翻译',
    description: '把文本翻译成目标语言（使用已配置的大模型）。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args, ctx) => {
      const text = String(args.text ?? '').trim()
      const target = String(args.target ?? '中文').trim()
      if (!text) return '请提供要翻译的文本（text）。'
      return translateWithLlm(text, target, ctx)
    }
  },
  {
    id: 'recall_history',
    name: '回忆历史',
    description: '读取最近的会话记录，回忆你们聊过什么。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => {
      const sessions = listSessions().slice(0, 5)
      if (sessions.length === 0) return '还没有历史会话记录。'
      return sessions
        .map((s) => {
          const last = [...s.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
          return `【${s.title || '未命名会话'}】模式 ${s.mode}，更新于 ${new Date(s.updatedAt).toLocaleString('zh-CN')}：${last.slice(0, 60)}`
        })
        .join('\n')
    }
  },
  {
    id: 'query_expense',
    name: '查账',
    description: '查询本地账本流水（守岸人内置记账能力）。',
    enabled: true,
    modes: ['work'],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => {
      const ledger = readLedger()
      if (ledger.items.length === 0) return '账本为空。可先用 record_expense 记账。'
      const income = ledger.items.filter((i) => i.type === 'in').reduce((s, i) => s + i.amount, 0)
      const expense = ledger.items.filter((i) => i.type === 'out').reduce((s, i) => s + i.amount, 0)
      const recent = ledger.items.slice(-8).reverse().map((i) => `${new Date(i.at).toLocaleDateString('zh-CN')} ${i.type === 'in' ? '+' : '-'}${i.amount} ${i.note}`)
      return `共 ${ledger.items.length} 笔：收入 ${income}，支出 ${expense}，结余 ${income - expense}\n最近流水：\n${recent.join('\n')}`
    }
  },
  {
    id: 'record_expense',
    name: '记账',
    description: '记录一笔收支到本地账本。参数：amount 金额、type in|out、note 备注。',
    enabled: true,
    modes: ['work'],
    effectKind: 'external_side_effect',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      const amount = Number(args.amount)
      if (!Number.isFinite(amount) || amount <= 0) return '请提供有效的金额（amount）。'
      const type = args.type === 'in' ? 'in' : 'out'
      const note = String(args.note ?? '').slice(0, 60)
      const ledger = readLedger()
      ledger.items.push({ id: 'e-' + Date.now().toString(36), type, amount, note, at: Date.now() })
      writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2))
      return `已记账：${type === 'in' ? '收入' : '支出'} ${amount} 元${note ? '（' + note + '）' : ''}`
    }
  }
]

const GIT_TOOLS: Array<Omit<ToolDefinition, 'enabled'>> = [
  { id: 'git_status', name: 'Git 状态', description: '读取当前工作区的 Git 分支、变更和同步状态。', modes: ['code'], effectKind: 'read', risk: 'fs-read', verificationPolicy: 'none', execute: async (a, c) => runGit('git status -sb', a, c) },
  { id: 'git_init', name: 'Git 初始化', description: '在当前目录初始化 Git 仓库。', modes: ['code'], effectKind: 'mutation', risk: 'fs-write', verificationPolicy: 'none', execute: async (a, c) => runGit('git init', a, c) },
  { id: 'git_commit', name: 'Git 提交', description: '把暂存区提交为一次 commit。参数：message。', modes: ['code'], effectKind: 'mutation', risk: 'fs-write', verificationPolicy: 'artifact', execute: async (a, c) => runGit(`git commit -m "${String(a.message ?? '').replace(/"/g, '\\"').slice(0, 120)}"`, a, c) },
  { id: 'git_switch_branch', name: 'Git 切换分支', description: '创建并切换分支，或直接切换已有分支。参数：branch。', modes: ['code'], effectKind: 'mutation', risk: 'fs-write', verificationPolicy: 'none', execute: async (a, c) => runGit(`git switch ${String(a.branch ?? '')}`, a, c) },
  { id: 'git_push', name: 'Git 推送', description: '推送当前分支到远程仓库。', modes: ['code'], effectKind: 'external_side_effect', risk: 'network', verificationPolicy: 'bypass', execute: async (a, c) => runGit('git push', a, c) },
  { id: 'git_revert', name: 'Git 还原', description: '还原指定提交的改动。参数：commit。', modes: ['code'], effectKind: 'mutation', risk: 'fs-write', verificationPolicy: 'artifact', execute: async (a, c) => runGit(`git revert ${String(a.commit ?? '')} --no-edit`, a, c) },
  { id: 'git_diff', name: 'Git 差异', description: '显示当前工作区与暂存区的差异。', modes: ['code'], effectKind: 'read', risk: 'fs-read', verificationPolicy: 'none', execute: async (a, c) => runGit('git diff --stat && git diff | head -200', a, c) },
  { id: 'git_log', name: 'Git 日志', description: '显示最近的提交历史。参数：count（默认 20）。', modes: ['code'], effectKind: 'read', risk: 'fs-read', verificationPolicy: 'none', execute: async (a, c) => runGit(`git log --oneline -${Math.max(1, Math.min(50, Number(a.count) || 20))}`, a, c) }
]

// ------------------------------------------------------------
// 任务工具（D6）：agent 可查 / 建 / 改用户的任务。
// 与任务页共用 data.json（store.ts 的 tasks），改动会实时同步到界面。
// modes: [] + chatBuiltin: true → 聊天模式内建集默认可用，无需开增强。
// ------------------------------------------------------------

/** 解析截止时间：接受毫秒时间戳（dueAt）或自然语言字符串（dueAtText，Date.parse 解析） */
function parseDue(dueAt?: unknown, dueAtText?: unknown): number | undefined {
  if (typeof dueAt === 'number' && Number.isFinite(dueAt) && dueAt > 0) return Math.round(dueAt)
  if (typeof dueAtText === 'string' && dueAtText.trim()) {
    const t = Date.parse(dueAtText.trim())
    if (Number.isFinite(t) && t > 0) return t
  }
  return undefined
}

const PRIORITY_NAME: Record<TaskItem['priority'], string> = { high: '高', medium: '中', low: '低' }

function fmtTask(t: TaskItem): string {
  const due = t.dueAt ? `（截止 ${new Date(t.dueAt).toLocaleString('zh-CN')}）` : ''
  const tag = t.tag ? ` #${t.tag}` : ''
  const src = t.source === 'agent' ? '（由我创建）' : ''
  const status = t.status === 'done' ? '（已完成）' : t.status === 'cancelled' ? '（已取消）' : ''
  return `- [${PRIORITY_NAME[t.priority]}] ${t.title}${due}${tag}${src}${status}${t.note ? ` —— ${t.note}` : ''}（id: ${t.id}）`
}

const TASK_TOOLS: ToolDefinition[] = [
  {
    id: 'task_list',
    name: '查看任务',
    description: '查看用户的本地任务清单（与任务页同源）。参数：status 可选（active 进行中 / done 已完成 / cancelled 已取消 / all 全部；默认 active）。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      const status = String(args.status ?? 'active')
      const all = listTasks()
      const filtered = status === 'all' ? all : all.filter((t) => t.status === status)
      if (filtered.length === 0) {
        if (status === 'all') return '任务列表为空。'
        const label = status === 'active' ? '进行中' : status === 'done' ? '已完成' : '已取消'
        return `没有${label}的任务。${status !== 'active' ? '（进行中任务：' + all.filter((t) => t.status === 'active').length + ' 条）' : ''}`
      }
      return filtered.map(fmtTask).join('\n')
    }
  },
  {
    id: 'task_create',
    name: '创建任务',
    description: '给用户创建一条本地任务，会同步显示在任务页。参数：title 标题（必填）、note 备注、priority 优先级（high/medium/low，默认 medium）、dueAt 截止时间（毫秒时间戳）或 dueAtText（自然语言，如 "明天下午 3 点"）、tag 标签。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'mutation',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      const title = String(args.title ?? '').trim()
      if (!title) return '请提供任务标题（title）。'
      const id = `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
      const dueAt = parseDue(args.dueAt, args.dueAtText)
      const priority: TaskItem['priority'] =
        args.priority === 'high' || args.priority === 'low' ? args.priority : 'medium'
      const list = saveTask({
        id,
        title,
        note: typeof args.note === 'string' && args.note.trim() ? String(args.note).trim() : undefined,
        priority,
        dueAt,
        tag: typeof args.tag === 'string' && args.tag.trim() ? String(args.tag).trim() : undefined,
        source: 'agent',
        status: 'active'
      })
      const created = list.find((t) => t.id === id)
      if (!created) return '任务创建失败。'
      return `已创建任务：${fmtTask(created)}`
    }
  },
  {
    id: 'task_update',
    name: '更新任务',
    description: '更新一条已有任务（按 id）。可改 title / note / priority / status / dueAt / tag；status 用 done=完成、cancelled=取消、active=恢复进行中。任务 id 用 task_list 查询。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'mutation',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      const id = String(args.id ?? '').trim()
      if (!id) return '请提供任务 id（id），可用 task_list 查询。'
      const before = listTasks().find((t) => t.id === id)
      if (!before) return `没有找到 id 为「${id}」的任务。请先 task_list 确认。`
      const dueAt = parseDue(args.dueAt, args.dueAtText)
      const status =
        args.status === 'done' || args.status === 'cancelled' || args.status === 'active'
          ? (args.status as TaskItem['status'])
          : undefined
      const list = patchTask(id, {
        title: typeof args.title === 'string' && args.title.trim() ? String(args.title).trim() : undefined,
        note: typeof args.note === 'string' ? String(args.note).trim() : undefined,
        priority: args.priority === 'high' || args.priority === 'medium' || args.priority === 'low'
          ? (args.priority as TaskItem['priority'])
          : undefined,
        status,
        dueAt,
        tag: typeof args.tag === 'string' ? String(args.tag).trim() : undefined
      })
      const after = list.find((t) => t.id === id)
      if (!after) return '任务更新失败。'
      return `已更新任务：${fmtTask(after)}`
    }
  },
  {
    id: 'task_delete',
    name: '删除任务',
    description: '永久删除一条任务（按 id）。误删无法恢复，除非用户明确要求删除才使用。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'mutation',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      const id = String(args.id ?? '').trim()
      if (!id) return '请提供任务 id（id），可用 task_list 查询。'
      const before = listTasks().find((t) => t.id === id)
      if (!before) return `没有找到 id 为「${id}」的任务。`
      const list = deleteTask(id)
      if (!list.find((t) => t.id === id)) return `已删除任务「${before.title}」。`
      return '任务删除失败。'
    }
  }
]

// ------------------------------------------------------------
// 本地电脑操作工具（agent 自检 / 打开路径 / 系统信息）
// - system_status：只读自检，agent 可随时汇报自己的运行状态
// - open_path：用系统方式打开文件/文件夹/应用（不执行任意命令）
// - system_info：只读系统信息
// ------------------------------------------------------------

const ROLE_NAMES: Record<string, string> = {
  shorekeeper: '守岸人',
  mornye: '莫宁',
  kindmita: '善良米塔',
  silverwolf: '银狼'
}

/** 可执行/脚本类扩展名：open_path 拒绝打开，避免被诱导执行任意程序 */
const EXEC_EXT_RE = /\.(exe|bat|cmd|ps1|vbs|msi|jar|com|scr|reg|inf|hta|wsf|sh)$/i

const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    id: 'ask_user',
    name: '向用户提问',
    description: '当执行任务缺少必要信息、需要用户做决定或确认时，向用户提出一个具体问题（可附带选项）。调用后任务会暂停，等用户回答后再继续。用于：让用户在几个方案里选一个、需要用户提供路径/数值/选择、用户意图不明确时需要澄清。问题要具体、一次只问一个。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (args) => {
      // 真正的「向用户提问并等待回答」握手在 toolExecutor 层特判处理；
      // 这里只是兜底：万一绕过握手直接执行，给出提示让模型知道要等用户。
      const q = String(args.question ?? '').trim() || '（未提供问题）'
      const opts = Array.isArray(args.options) ? (args.options as unknown[]).map(String) : []
      return `需要向用户提问（等待用户回答）：${q}${opts.length > 0 ? `；可选项：${opts.join(' / ')}` : ''}。请等待用户回答后继续。`
    }
  },
  {
    id: 'system_status',
    name: '自检',
    description: '检查你自己（agent）的当前运行状态：角色、模型接口配置、语音引擎、用量统计、记忆库、本地资料库、任务与会话概况。适合用户问"你还好吗/检查一下自己/报告状态"时调用。',
    enabled: true,
    modes: [],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async (_args, ctx) => {
      const cfg = ctx?.config
      const roleId = String((cfg as unknown as { agentRole?: string })?.agentRole ?? 'shorekeeper')
      const theme = String((cfg as unknown as { themeSource?: string })?.themeSource ?? '')
      const roleName = ROLE_NAMES[roleId] ?? roleId
      const modelOk = Boolean(cfg?.apiKey && cfg?.baseURL && cfg?.model)
      const ttsProvider = cfg?.ttsProvider ?? 'local'
      const ttsLabel =
        ttsProvider === 'indextts'
          ? 'IndexTTS（本地引擎）' + (cfg?.indexttsRefAudio ? `，参考音频：${cfg.indexttsRefAudio.split(/\\|\//).pop()}` : '，未选参考音频')
          : ttsProvider === 'mimo'
            ? '小米 MiMo（云端）'
            : '本地 GPT-SoVITS' + (cfg?.ttsRefAudio ? `，参考音频：${cfg.ttsRefAudio.split(/\\|\//).pop()}` : '，未选参考音频')
      const usage = getUsageStats()
      const today = usage.daily?.[new Date().toISOString().slice(0, 10)]
      const memCount = listMemory().length
      const ragDocs = listDocuments().length
      const activeTasks = listTasks().filter((x) => x.status === 'active').length
      const sessionCount = listSessions().length
      return [
        `【自检报告】`,
        `- 角色：${roleName}${theme ? `（主题：${theme}）` : ''}`,
        `- 模型：${cfg?.model || '未配置'}｜${modelOk ? '接口已配置 ✓' : '接口未配置（演示模式）'}`,
        `- 对话工具：${cfg?.chatToolsEnabled ? '增强已开启' : '默认内建集'}｜自动朗读：${cfg?.autoRead ? '开' : '关'}`,
        `- 语音合成：${ttsLabel}`,
        `- 用量：今日 ${today?.totalTokens ?? 0} tokens / 累计 ${usage.totalTokens ?? 0} tokens（${usage.totalCalls ?? 0} 次请求）`,
        `- 记忆库：${memCount} 条｜本地资料库：${ragDocs} 个文档｜进行中任务：${activeTasks} 条｜会话：${sessionCount} 个`
      ].join('\n')
    }
  },
  {
    id: 'system_info',
    name: '系统信息',
    description: '查看这台电脑的系统信息：操作系统版本、CPU、内存占用、磁盘可用空间、屏幕分辨率。仅在聊天与代码模式可用。',
    enabled: true,
    modes: ['chat', 'code'],
    chatBuiltin: true,
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => {
      const cpus = os.cpus()
      const cpuName = cpus[0]?.model?.trim() ?? '未知'
      const cores = cpus.length
      const totalMem = os.totalmem() / 1024 ** 3
      const freeMem = os.freemem() / 1024 ** 3
      const usedPct = Math.round(((totalMem - freeMem) / totalMem) * 100)
      const primary = screen.getPrimaryDisplay()
      const size = primary.size
      let disks = '（磁盘信息读取失败）'
      try {
        const { stdout } = await execAsync('wmic logicaldisk get caption,size,freespace /format:list', { timeout: 8000, windowsHide: true })
        const lines = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
        const parts: Array<{ cap?: string; free?: string; size?: string }> = []
        let cur: { cap?: string; free?: string; size?: string } = {}
        for (const l of lines) {
          const m = /^(Caption|FreeSpace|Size)=(.+)$/.exec(l)
          if (!m) continue
          if (m[1] === 'Caption') {
            if (cur.cap) parts.push(cur)
            cur = { cap: m[2] }
          } else if (m[1] === 'Size') cur.size = m[2]
          else if (m[1] === 'FreeSpace') cur.free = m[2]
        }
        if (cur.cap) parts.push(cur)
        disks = parts
          .map((p) => {
            const total = Number(p.size) / 1024 ** 3
            const free = Number(p.free) / 1024 ** 3
            return `${p.cap}：${total.toFixed(1)}G 总 / ${free.toFixed(1)}G 可用`
          })
          .join('｜') || '（未识别到磁盘）'
      } catch {
        /* 磁盘读取失败不阻塞 */
      }
      return [
        `【系统信息】`,
        `- 系统：${os.version()}（${os.platform()} ${os.arch()}）`,
        `- CPU：${cpuName}（${cores} 核）｜内存：${totalMem.toFixed(1)}G，已用 ${usedPct}%`,
        `- 磁盘：${disks}`,
        `- 屏幕：${size.width} × ${size.height}`
      ].join('\n')
    }
  },
  {
    id: 'open_path',
    name: '打开文件/文件夹/应用',
    description: '用系统方式打开本地路径：文件夹会在资源管理器中打开，文档/图片/音频会用默认程序打开，应用（.exe）也会启动。可执行脚本类（.bat/.ps1/.cmd/.vbs 等）出于安全会被拒绝。仅在聊天与代码模式可用。',
    enabled: true,
    modes: ['chat', 'code'],
    chatBuiltin: true,
    effectKind: 'external_side_effect',
    risk: 'fs-read',
    verificationPolicy: 'none',
    execute: async (args) => {
      const p = String(args.path ?? args.path2 ?? '').trim()
      if (!p) return '请提供要打开的路径（path）。'
      if (!existsSync(p)) return `路径不存在：${p}`
      // 权限档位（来自界面选择，透传 args）：1=仅可查看 2=工作目录内修改 3=完全权限
      const level = Number(args.permissionLevel ?? 1)
      if (EXEC_EXT_RE.test(p)) {
        const isScript = /\.(bat|cmd|ps1|vbs|msi|jar|com|scr|reg|inf|hta|wsf|sh)$/i.test(p)
        if (isScript) {
          return `出于安全考虑，不会直接打开可执行/脚本文件（${p.split(/\\|\//).pop()}）。脚本类在任何档位都会被拒绝，请改用代码模式让 agent 用 run_shell 执行。`
        }
        if (level < 3) {
          return `当前权限档位（仅可查看/工作目录内修改）不允许启动应用。将权限档位调至「完全权限」后再打开应用（${p.split(/\\|\//).pop()}）。`
        }
      }
      try {
        const err = await shell.openPath(p)
        if (err) return `打开失败：${err}`
        return `已打开：${p}`
      } catch (e) {
        return `打开失败：${(e as Error).message}`
      }
    }
  }
]

async function runGit(cmd: string, args: Record<string, unknown>, ctx?: ToolExecContext): Promise<string> {
  const cwd = String(args.cwd ?? '')
  if (!cwd || !existsSync(cwd)) return '请提供 Git 仓库目录（cwd 参数）。'
  return runCommand(cmd, cwd)
}

export function registerAllTools(): void {
  // 浏览器工具带真实 execute（不是占位），所以直接原样注册
  for (const t of [
    ...BUILTIN_CORE,
    ...FILE_TOOLS,
    ...GIT_TOOLS,
    ...TASK_TOOLS,
    ...SYSTEM_TOOLS,
    ...BROWSER_TOOLS
  ]) {
    const def = t as ToolDefinition
    toolRegistry.register({ ...def, enabled: def.enabled ?? true, execute: def.execute ?? notImplemented(def.name) })
  }
}

/**
 * 核心工具的 function calling 参数 schema（按工具 id）。
 * 只给有真实 execute 的工具精确 schema；其余工具在调用方回退宽松 schema。
 */
export const TOOL_PARAMS: Record<string, Record<string, unknown>> = {
  web_search: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' } }, required: ['query'] },
  http_request: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '完整地址，以 http:// 或 https:// 开头' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: 'HTTP 方法，默认 GET' },
      headers: { type: 'object', description: '请求头对象，例如 {"Content-Type":"application/json"}' },
      body: { type: 'string', description: '请求体（GET/HEAD 会忽略）。传 JSON 字符串或对象' }
    },
    required: ['url']
  },
  fetch_url: { type: 'object', properties: { url: { type: 'string', description: '完整网址，以 http:// 或 https:// 开头' } }, required: ['url'] },
  download_file: { type: 'object', properties: { url: { type: 'string', description: '文件下载地址' }, path: { type: 'string', description: '本地保存路径（绝对路径）' } }, required: ['url', 'path'] },
  read_image_url: { type: 'object', properties: { url: { type: 'string', description: '图片网络地址' } }, required: ['url'] },
  run_shell: { type: 'object', properties: { command: { type: 'string', description: '要执行的 Shell 命令（cmd 语法）' }, cwd: { type: 'string', description: '工作目录（可选）' } }, required: ['command'] },
  run_verification: { type: 'object', properties: { verificationType: { type: 'string', enum: ['typecheck', 'test', 'build', 'lint'], description: '验证类型' }, cwd: { type: 'string', description: '项目目录（可选）' } }, required: ['verificationType'] },
  weather: { type: 'object', properties: { city: { type: 'string', description: '城市名' } }, required: ['city'] },
  read_file: { type: 'object', properties: { path: { type: 'string', description: '文件绝对路径' }, startLine: { type: 'number', description: '起始行号（可选，默认 1）' }, maxLines: { type: 'number', description: '最多读取行数（可选，默认 200）' } }, required: ['path'] },
  read_image: { type: 'object', properties: { path: { type: 'string', description: '图片绝对路径' } }, required: ['path'] },
  write_file: { type: 'object', properties: { path: { type: 'string', description: '文件路径（自动创建父目录）' }, content: { type: 'string', description: '要写入的文本内容' }, append: { type: 'boolean', description: '是否追加（可选）' } }, required: ['path', 'content'] },
  list_dir: { type: 'object', properties: { path: { type: 'string', description: '目录绝对路径' }, showHidden: { type: 'boolean', description: '是否显示隐藏文件（可选）' } }, required: ['path'] },
  Edit: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, old_string: { type: 'string', description: '要替换的旧内容（需先在文件中存在）' }, new_string: { type: 'string', description: '新内容' } }, required: ['path', 'old_string', 'new_string'] },
  Glob: { type: 'object', properties: { pattern: { type: 'string', description: '通配模式，如 **/*.ts' }, path: { type: 'string', description: '搜索根目录（可选）' } }, required: ['pattern'] },
  Grep: { type: 'object', properties: { pattern: { type: 'string', description: '正则搜索模式' }, path: { type: 'string', description: '搜索目录' } }, required: ['pattern'] },
  Read: { type: 'object', properties: { path: { type: 'string', description: '文件路径' } }, required: ['path'] },
  Write: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, content: { type: 'string', description: '内容' } }, required: ['path', 'content'] },
  apply_patch: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, edits: { type: 'array', description: '修改块数组，每项含 old_string 与 new_string' } }, required: ['path', 'edits'] },
  str_replace: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, old_string: { type: 'string', description: '旧内容（须唯一匹配）' }, new_string: { type: 'string', description: '新内容' } }, required: ['path', 'old_string', 'new_string'] },
  search_text: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, path: { type: 'string', description: '搜索目录（可选）' } }, required: ['query'] },
  write_markdown: { type: 'object', properties: { path: { type: 'string', description: '文件路径' }, content: { type: 'string', description: 'Markdown 内容' } }, required: ['path', 'content'] },
  exchange_rate: { type: 'object', properties: { from: { type: 'string', description: '源货币代码，默认 USD' }, to: { type: 'string', description: '目标货币代码，默认 CNY' }, amount: { type: 'number', description: '金额（可选，默认 1）' } } },
  translate: { type: 'object', properties: { text: { type: 'string', description: '要翻译的文本' }, target: { type: 'string', description: '目标语言，默认中文' } }, required: ['text'] },
  record_expense: { type: 'object', properties: { amount: { type: 'number', description: '金额' }, type: { type: 'string', enum: ['in', 'out'], description: 'in=收入 out=支出' }, note: { type: 'string', description: '备注（可选）' } }, required: ['amount'] },
  git_status: { type: 'object', properties: { cwd: { type: 'string', description: 'Git 仓库目录' } }, required: ['cwd'] },
  task_list: { type: 'object', properties: { status: { type: 'string', enum: ['active', 'done', 'cancelled', 'all'], description: '任务状态过滤，默认 active' } } },
  task_create: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '任务标题（必填）' },
      note: { type: 'string', description: '备注（可选）' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级，默认 medium' },
      dueAt: { type: 'number', description: '截止时间（毫秒时间戳，可用 Date.parse("2026-10-12 18:00") 得到）' },
      dueAtText: { type: 'string', description: '截止时间的自然语言描述，如 "明天下午 3 点"（与 dueAt 二选一）' },
      tag: { type: 'string', description: '标签（可选）' }
    },
    required: ['title']
  },
  task_update: {
    type: 'object',
    properties: {
      id: { type: 'string', description: '任务 id（用 task_list 查询）' },
      title: { type: 'string', description: '新标题（可选）' },
      note: { type: 'string', description: '新备注；传空串清除（可选）' },
      priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级（可选）' },
      status: { type: 'string', enum: ['active', 'done', 'cancelled'], description: 'done=完成 / cancelled=取消 / active=恢复' },
      dueAt: { type: 'number', description: '截止时间（毫秒时间戳，可选）' },
      dueAtText: { type: 'string', description: '截止时间自然语言（与 dueAt 二选一）' },
      tag: { type: 'string', description: '标签；传空串清除（可选）' }
    },
    required: ['id']
  },
  task_delete: { type: 'object', properties: { id: { type: 'string', description: '任务 id（用 task_list 查询）' } }, required: ['id'] },
  git_init: { type: 'object', properties: { cwd: { type: 'string', description: '目录' } }, required: ['cwd'] },
  git_commit: { type: 'object', properties: { cwd: { type: 'string', description: '仓库目录' }, message: { type: 'string', description: '提交信息' } }, required: ['cwd', 'message'] },
  git_switch_branch: { type: 'object', properties: { cwd: { type: 'string', description: '仓库目录' }, branch: { type: 'string', description: '分支名' } }, required: ['cwd', 'branch'] },
  git_push: { type: 'object', properties: { cwd: { type: 'string', description: '仓库目录' } }, required: ['cwd'] },
  git_revert: { type: 'object', properties: { cwd: { type: 'string', description: '仓库目录' }, commit: { type: 'string', description: '要还原的提交' } }, required: ['cwd', 'commit'] },
  git_diff: { type: 'object', properties: { cwd: { type: 'string', description: '仓库目录' } }, required: ['cwd'] },
  git_log: { type: 'object', properties: { cwd: { type: 'string', description: '仓库目录' }, count: { type: 'number', description: '显示条数（默认 20）' } }, required: ['cwd'] },
  system_status: { type: 'object', properties: {}, additionalProperties: false },
  system_info: { type: 'object', properties: {}, additionalProperties: false },
  open_path: { type: 'object', properties: { path: { type: 'string', description: '要打开的本地路径（文件夹/文档/图片/音频/应用 exe）' } }, required: ['path'] },
  ask_user: {
    type: 'object',
    properties: {
      question: { type: 'string', description: '要向用户提出的具体问题（一次只问一个，具体明确）' },
      options: { type: 'array', items: { type: 'string' }, description: '可选的候选答案（2-4 个），用户可直接点选；不提供时用户自由输入' }
    },
    required: ['question']
  },
  // 内置浏览器（规格 5 · 八）：schema 定义在 browser-tools.ts，这里合并进同一张表
  ...BROWSER_TOOL_PARAMS
}


/** 供设置面板展示的目录（参照 Shorekeeper TOOL_GET_CATALOG：id/name/description/enabled/modes/chatBuiltin/deprecated + risk） */
export function getToolCatalog(): Array<{
  id: string
  name: string
  description: string
  enabled: boolean
  modes: ToolMode[] | null
  chatBuiltin: boolean
  deprecated: boolean
  /** 宿主未接入对应后端：设置里标「未接入」，且不会注册给模型 */
  unavailable: boolean
  risk: string
}> {
  return toolRegistry
    .getAllTools()
    .filter((t) => !t.unavailable)
    .map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    enabled: t.enabled,
    modes: t.modes.length > 0 ? t.modes : null,
    chatBuiltin: t.chatBuiltin === true,
    deprecated: t.deprecated === true,
    unavailable: t.unavailable === true,
    risk: t.risk ?? 'safe'
  }))
}

