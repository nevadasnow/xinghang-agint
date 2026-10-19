import {
  app,
  shell,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  Tray,
  webContents,
} from 'electron'
import type { WebContents } from 'electron'
import { basename, join, resolve, sep } from 'path'
import { existsSync } from 'node:fs'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { buildSystemPrompt, type AgentRoleId } from './prompts'
import { getUsageStats, recordUsage, resetUsageStats } from './usage'
import { ASSETS_DIR, CUSTOM_MEDIA_DIR, importMedia, listAssets, mimeOf, openAssetDirInShell } from './assets'
import { approxTokens, relTimeLabel, trimHistory } from './history'
import { renderProfileBlock, renderTaskBlock } from './facts'
import { mimoProbe, probe, synthesize, synthesizeMiMo, ttsCacheClear, ttsCacheDeleteText, ttsCacheStats } from './tts'
import { indexttsCacheDeleteText, indexttsStatus, indexttsSttStatus, indexttsSynthesize } from './indextts'
import { listDir, readWorkspaceFile, revealInFolder, workspaceRoot } from './workspace'
import { addMemory, deleteMemory, listMemory, updateMemory } from './memory'
import { listDocuments, removeDocument, renderFilesFull, renderRagBlock, saveDocument } from './rag'
import {
  deleteReminder,
  listReminders,
  notify,
  saveReminder,
  startReminderScheduler,
  toggleReminder,
} from './reminders'
import { decideProactive, markProactiveSaid, proactiveStatus, resetProactiveSession, setProactiveEnabled } from './proactive'
import { chatCompletion, chatCompletionStream, fetchModelList, isConfigured, testConnection } from './llm'
import type { ChatToolSpec } from './llm'
import {
  listSessions,
  saveSession,
  deleteSession,
  patchSession,
  renameSession,
  loadConfig,
  saveConfig,
  maskSecret,
  isMasked,
  listProjects,
  listGroups,
  saveProject,
  saveGroup,
  deleteProject,
  deleteGroup,
  renameGroup,
  patchGroup,
  reorderGroups,
  assignSession,
  getPersistedUserProfile,
  savePersistedUserProfile,
  listTasks,
  saveTask,
  patchTask,
  deleteTask,
  bulkTasks,
  clearCompletedTasks,
  reorderTasks
} from './store'
import { detectProvider } from './llm'
import { buildToolCatalog, getToolCatalog, registerAllTools, toolRegistry, TOOL_PARAMS } from './tools'
import { kill as killTerminal, killAll as killAllTerminals, run as runTerminal } from './terminal'
import { bindBrowser, unbindBrowser } from './browser-bridge'
import { BROWSER_LINK_COPIED_EVENT, BROWSER_OPEN_TAB_EVENT, CHAT_STREAM_CHANNEL, CHAT_TOOL_ASK_CHANNEL, CHAT_TOOL_CONFIRM_CHANNEL, CHAT_TOOL_EVENT_CHANNEL, WEBVIEW_ATTACHED_EVENT } from '../shared/events'
import type { ChatStreamEvent, ToolAskRequest, ToolCallEvent, ToolConfirmRequest } from '../shared/events'
import type { AgentMode, ChatMessage, ConfigInfo, Group, LlmConfig, PersistedUserProfile, ProfileFacts, Session, TaskItem, ToolMode, UserProfile, ProactiveReason } from '../shared/types'
  
  /**
  * 放开自动播放限制：本地 TTS 合成是异步的（点击试听 → 等 20~30s 才拿到音频），
  * 默认 autoplayPolicy 要求媒体播放必须发生在用户手势瞬间，异步 play() 会被拒。
  * 桌面应用在 app ready 之前通过命令行开关统一放开（webPreferences.autoplayPolicy 不生效）。
  */
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  
  /**
  * 自定义协议特权：必须在 app ready 之前注册。
  * skmusic 用于背景音乐曲库（audio 标签直接播放本地文件流）。
  */
  protocol.registerSchemesAsPrivileged([
  {
  scheme: 'skmusic',
  privileges: {
  standard: false,
  stream: true,
  bypassCSP: true,
  supportFetchAPI: true
  }
  },
  {
  scheme: 'skmedia',
  privileges: {
  standard: false,
  stream: true,
  bypassCSP: true,
  supportFetchAPI: true
  }
  }
  ])
  
  /** 主窗口引用：自绘标题栏的窗口控制 IPC 在拿不到 sender 时兜底 */
  let mainWindowRef: BrowserWindow | undefined
  
  /**
  * 当前进行中的流式对话（按 sender.id 索引）。
  * 渲染层「停止」按钮 → chat:stop → abort 对应 controller → 流以 stopped 收尾。
  */
  const activeChatStreams = new Map<number, AbortController>()
  
  /** 高危操作确认 / agent 提问的挂起表：toolExecutor 等待渲染层回应 */
  const toolConfirmPending = new Map<string, (allow: boolean) => void>()
  const toolAskPending = new Map<string, (answer: string) => void>()
  
  /** 需要用户确认的高危 risk 清单：执行命令 / 控制输入 / 外部副作用（如启动应用） */
  const CONFIRM_RISKS: Array<'shell' | 'input-control' | 'external_side_effect'> = ['shell', 'input-control', 'external_side_effect']
  
  /** 把工具调用压缩成一行可读摘要，展示「目的」 */
  function summarizeToolCall(tool: { name: string }, args: Record<string, unknown>): string {
    const keys = Object.keys(args ?? {})
    if (keys.length === 0) return tool.name
    const parts = keys.slice(0, 3).map((k) => {
      const v = (args as Record<string, unknown>)[k]
      const s = typeof v === 'string' ? v : JSON.stringify(v)
      return `${k}=${s.length > 48 ? s.slice(0, 45) + '…' : s}`
    })
    return `${tool.name}（${parts.join('，')}）`
  }
  
  /** 高危操作确认：向渲染层发确认卡并挂起，等用户允许/拒绝（超时 5 分钟默认拒绝） */
  function requestToolConfirm(sender: WebContents, tool: { id: string; name: string }, args: Record<string, unknown>): Promise<boolean> {
    const id = `confirm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const req: ToolConfirmRequest = {
    id,
    toolId: tool.id,
    toolName: tool.name,
    args: JSON.stringify(args ?? {}),
    summary: summarizeToolCall(tool, args)
    }
    if (!sender.isDestroyed()) sender.send(CHAT_TOOL_CONFIRM_CHANNEL, req)
    return new Promise((resolve) => {
    toolConfirmPending.set(id, resolve)
    setTimeout(() => {
      const fn = toolConfirmPending.get(id)
      if (fn) {
      toolConfirmPending.delete(id)
      fn(false)
      }
    }, 5 * 60 * 1000)
    })
  }
  
  /** agent 向用户提问：向渲染层发提问卡并挂起，等用户回答（超时 5 分钟返回空串） */
  function askUser(sender: WebContents, args: Record<string, unknown>): Promise<string> {
    const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const question = String(args.question ?? '').trim() || '请回答下面的问题'
    const options = Array.isArray(args.options) ? (args.options as unknown[]).map(String).filter(Boolean) : []
    const req: ToolAskRequest = { id, question, options: options.length > 0 ? options : undefined }
    if (!sender.isDestroyed()) sender.send(CHAT_TOOL_ASK_CHANNEL, req)
    return new Promise((resolve) => {
    toolAskPending.set(id, resolve)
    setTimeout(() => {
      const fn = toolAskPending.get(id)
      if (fn) {
      toolAskPending.delete(id)
      fn('')
      }
    }, 5 * 60 * 1000)
    })
  }
  
  /** 上传文件：只读文本类；二进制/超大文件拒绝 */
  const TEXT_FILE_FILTERS: Electron.FileFilter[] = [
  {
  name: '文本文件',
  extensions: [
  'txt', 'md', 'markdown', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h',
  'hpp', 'go', 'rs', 'rb', 'php', 'sql', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'scss',
  'less', 'log', 'csv', 'ini', 'conf', 'toml', 'sh', 'bat', 'ps1', 'tsv'
  ]
  },
  { name: '所有文件', extensions: ['*'] }
  ]
  const MAX_TEXT_FILE_SIZE = 512 * 1024 // 512KB
  
  // ---------- 背景音乐曲库 ----------
  /** 曲库目录：工程根/背景音乐（用户可自行放入 mp3/wav/m4a/flac/ogg） */
  export const MUSIC_DIR = join(app.getAppPath(), '背景音乐')
  const MUSIC_EXTS = new Set(['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac', '.webm'])
  const MUSIC_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm'
  }
  
  /** skmedia://local/<名> 从素材库读文件；skmedia://ext/<名> 从自定义媒体目录读文件（防路径穿越） */
  function registerMediaProtocol(): void {
  protocol.handle('skmedia', async (request) => {
  try {
  const u = new URL(request.url)
  const zone = u.hostname === 'ext' ? CUSTOM_MEDIA_DIR : ASSETS_DIR
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''))
  const dir = resolve(zone)
  const file = resolve(dir, name)
  if (file !== dir && !file.startsWith(dir + sep)) {
  return new Response('forbidden', { status: 403 })
  }
  const data = await readFile(file)
  const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
  return new Response(data, {
  headers: { 'content-type': mimeOf(ext) }
  })
  } catch {
  return new Response('not found', { status: 404 })
  }
  })
  }

  /** skmusic://local/<文件名> → 从背景音乐目录读文件（防路径穿越） */
  function registerMusicProtocol(): void {
  protocol.handle('skmusic', async (request) => {
  try {
  const u = new URL(request.url)
  const name = decodeURIComponent(u.pathname.replace(/^\//, ''))
  const dir = resolve(MUSIC_DIR)
  const file = resolve(dir, name)
  if (file !== dir && !file.startsWith(dir + sep)) {
  return new Response('forbidden', { status: 403 })
  }
  const data = await readFile(file)
  const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase()
  return new Response(data, {
  headers: { 'content-type': MUSIC_MIME[ext] ?? 'application/octet-stream' }
  })
  } catch {
  return new Response('not found', { status: 404 })
  }
  })
  }
  
  /** 扫描曲库目录，返回可播放曲目（按文件名排序；mtime 为文件修改时间=导入日期） */
  async function listMusicTracks(): Promise<{ name: string; url: string; size: number; mtime: number }[]> {
  try {
  const { readdir } = await import('node:fs/promises')
  const entries = await readdir(MUSIC_DIR)
  const out: { name: string; url: string; size: number; mtime: number }[] = []
  for (const entry of entries) {
  const ext = (entry.match(/\.[^.]+$/) || [''])[0].toLowerCase()
  if (!MUSIC_EXTS.has(ext)) continue
  const full = join(MUSIC_DIR, entry)
  try {
  const info = await stat(full)
  if (!info.isFile()) continue
  out.push({
  name: entry.replace(/\.[^.]+$/, ''),
  url: 'skmusic://local/' + encodeURIComponent(entry),
  size: info.size,
  mtime: info.mtimeMs
  })
  } catch { /* 单个文件失败跳过 */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
  } catch {
  return []
  }
  }
  
  /**
  * `<webview>` 的 URL 白名单：只允许 http / https。
  * file: / data: / javascript: / about: 以及自定义协议一律拒绝
  * （内嵌浏览器只需要看网页，不需要读本地文件或跑脚本）。
  */
  function isAllowedWebUrl(raw: string): boolean {
  try {
  const u = new URL(raw)
  return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
  return false
  }
  }
  
  function createWindow(): void {
  const win = new BrowserWindow({
  width: 1240,
  height: 800,
  minWidth: 960,
  minHeight: 640,
  show: false,
  autoHideMenuBar: true,
  // 与守岸蓝主题的天空渐变首帧同色（--sk-100），避免首帧/缩放时露出深色底形成黑边
  backgroundColor: '#F2F7FD',
  // 隐藏原生标题栏，由渲染层自绘（参考 D:\守岸人agent 的做法）
  titleBarStyle: 'hidden',
  title: `${agentRoleName(loadConfig().agentRole)} · 星航陪伴`,
  webPreferences: {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
  // 右侧面板的「浏览器」tab 用 <webview> 真内嵌（规格 5 二），必须显式打开
  webviewTag: true,
  // 本地 TTS 合成是异步的（点击试听→等 20~30s 才拿到音频），
  // 默认 autoplayPolicy 要求媒体播放必须发生在用户手势瞬间，异步 play() 会被拒；
  // 这是本地桌面应用，放开自动播放限制让朗读/试听正常出声
  autoplayPolicy: 'no-user-gesture-required'
  }
  })
  
  win.on('ready-to-show', () => win.show())
  // 窗口重新获得焦点时重注册全局快捷键：焦点从其他应用切回后，
  // 若热键曾被系统/输入法/其它程序短暂占用，重注册可恢复（无需再点播放按钮）
  win.on('focus', () => registerGlobalShortcut())
  mainWindowRef = win
  // 提前捕获：closed 事件触发时 win.webContents 已销毁，再读 .id 会抛
  // "Object has been destroyed"（这正是关窗时弹主进程 JS 错误的原因）
  const hostWebContentsId = win.webContents.id
  
  win.webContents.setWindowOpenHandler((details) => {
  shell.openExternal(details.url)
  return { action: 'deny' }
  })
  
  /* ------------------------------------------------------------------
  <webview> 安全闸门（三处）：
  1) will-attach-webview：挂载前改写 guest 的 webPreferences——删掉任何 preload、
  强制 nodeIntegration:false / contextIsolation:true / sandbox:true，
  并丢弃渲染层传来的非白名单初始 URL。
  2) did-attach-webview：给 guest 装 setWindowOpenHandler / will-navigate，
  弹窗与跳转都只放行 http(s)，其余交给系统浏览器。
  3) 渲染层（BrowserPane）自己也做一次协议校验，双保险。
  ------------------------------------------------------------------ */
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
  delete (webPreferences as Record<string, unknown>)['preload']
  delete (webPreferences as Record<string, unknown>)['preloadURL']
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.sandbox = true
  
  if (!isAllowedWebUrl(params.src)) {
  event.preventDefault()
  return
  }
  // 分区固定为 persist:sk-browser：会话内保留 cookie/登录态，且与主界面隔离
  params.partition = 'persist:sk-browser'
  })
  
  win.webContents.on('did-attach-webview', (_event, guest) => {
  // 渲染层拿到 getWebContentsId 需要等 guest 真正挂上，所以这里主动通知一次，
  // 避免「先挂载后监听」的竞态导致绑定丢失。
  try {
  if (!win.webContents.isDestroyed()) win.webContents.send(WEBVIEW_ATTACHED_EVENT)
  } catch {
  /* ignore */
  }
  
  const guard = (contents: WebContents): void => {
  // 链接右键：在新标签页打开 / 复制链接地址（原生菜单，坐标跟随鼠标）
  contents.on('context-menu', (event, params) => {
  if (!params.linkURL || !isAllowedWebUrl(params.linkURL)) return
  const menu = Menu.buildFromTemplate([
  {
  label: '在新标签页打开',
  click: () => {
  try {
  win.webContents.send(BROWSER_OPEN_TAB_EVENT, params.linkURL)
  } catch {
  /* 渲染层可能已销毁 */
  }
  }
  },
  {
  label: '复制链接地址',
  click: () => {
  clipboard.writeText(params.linkURL)
  try {
  win.webContents.send(BROWSER_LINK_COPIED_EVENT, params.linkURL)
  } catch {
  /* 渲染层可能已销毁 */
  }
  }
  }
  ])
  menu.popup({ window: win })
  })
  contents.setWindowOpenHandler((details) => {
  // 弹窗（target=_blank / window.open）：通知渲染层「新开标签页」。
  // 渲染层的 onOpenTab 会新增标签并切过去；与右键菜单共用同一通道。
  if (isAllowedWebUrl(details.url)) {
  setImmediate(() => {
  try {
  if (!win.webContents.isDestroyed()) {
  win.webContents.send(BROWSER_OPEN_TAB_EVENT, details.url)
  }
  } catch {
  /* ignore */
  }
  })
  }
  return { action: 'deny' }
  })
  contents.on('will-navigate', (e, url) => {
  if (!isAllowedWebUrl(url)) e.preventDefault()
  })
  }
  guard(guest)
  })
  
  // 常规设置：关闭按钮行为（ask=每次询问 / tray=最小化到托盘 / quit=直接退出）
  let closeAsking = false
  win.on('close', (e) => {
  if (quitting) return
  const cfg = loadConfig()
  const behavior = cfg.closeBehavior ?? 'ask'
  // 最小化到托盘：只有托盘真建起来了才拦截，否则直接退出（避免关不掉）
  if (behavior === 'tray' && trayRef) {
  e.preventDefault()
  win.hide()
  return
  }
  // 直接退出 / 已勾选「不再显示关闭确认」：不拦截，正常关闭退出
  if (behavior === 'quit' || cfg.skipCloseConfirm) return
  // 每次询问：通知渲染层弹主题风格确认弹窗（防重复弹出）
  if (closeAsking) {
  e.preventDefault()
  return
  }
  e.preventDefault()
  closeAsking = true
  win.webContents.send('app:close-ask', {
  canTray: !!trayRef,
  roleName: agentRoleName(loadConfig().agentRole)
  })
  })
  // 渲染层「关闭确认弹窗」的选择回传：tray=最小化到托盘 / quit=直接退出 / cancel=取消
  ipcMain.handle('app:close-choose', (_e, action: 'tray' | 'quit' | 'cancel') => {
  if (action === 'cancel') {
  closeAsking = false
  return { ok: true }
  }
  if (action === 'tray' && trayRef) {
  closeAsking = false
  win.hide()
  return { ok: true }
  }
  quitting = true
  app.quit()
  return { ok: true }
  })
  
  // 窗口关掉时把还在跑的终端进程一起收掉，避免孤儿进程
  win.on('closed', () => {
  killAllTerminals()
  // 用提前捕获的 id：此时 win.webContents 已销毁，直接读会抛异常
  if (typeof hostWebContentsId === 'number') unbindBrowser(hostWebContentsId)
  })
  
  if (process.env['ELECTRON_RENDERER_URL']) {
  win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
  win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  }
  
  /** Agent 角色显示名（窗口标题 / 托盘 / 通知 / 关闭确认 / 导出默认名共用） */
  function agentRoleName(role: LlmConfig['agentRole'] | undefined): string {
  return role === 'kindmita' ? '善良米塔' : role === 'mornye' ? '莫宁' : role === 'silverwolf' ? '银狼' : '守岸人'
  }
  
  function toConfigInfo(cfg: LlmConfig): ConfigInfo {
  return {
  configured: isConfigured(cfg),
  baseURL: cfg.baseURL,
  // 只回传掩码：明文 Key 留在主进程内存，渲染层拿不到
  apiKey: maskSecret(cfg.apiKey),
  model: cfg.model,
  provider: cfg.provider || detectProvider(cfg),
  displayName: cfg.displayName,
  profiles: cfg.profiles.map((p) => ({ ...p, apiKey: maskSecret(p.apiKey) })),
  defaultProfileId: cfg.defaultProfileId,
  timeoutSec: cfg.timeoutSec,
  maxRetries: cfg.maxRetries,
  contextWindowTokens: cfg.contextWindowTokens,
  toolModeOverrides: cfg.toolModeOverrides,
  chatToolsEnabled: cfg.chatToolsEnabled,
  skillModeOverrides: cfg.skillModeOverrides,
  autoRead: cfg.autoRead,
  agentRole: cfg.agentRole,
  ttsURL: cfg.ttsURL,
  ttsRefAudio: cfg.ttsRefAudio,
  ttsPromptText: cfg.ttsPromptText,
  ttsProvider: cfg.ttsProvider,
  mimoTTSKey: maskSecret(cfg.mimoTTSKey),
  mimoTTSModel: cfg.mimoTTSModel,
  mimoTTSVoice: cfg.mimoTTSVoice,
  mimoTTSBaseURL: cfg.mimoTTSBaseURL,
  mimoStylePrompt: cfg.mimoStylePrompt,
  indexttsRefAudio: cfg.indexttsRefAudio,
  indexttsUseRoleRef: cfg.indexttsUseRoleRef !== false,
  indexttsDevice: cfg.indexttsDevice,
  indexttsSpeed: cfg.indexttsSpeed,
  indexttsPitch: cfg.indexttsPitch,
  indexttsVolume: cfg.indexttsVolume,
  indexttsSTTEnabled: cfg.indexttsSTTEnabled,
  indexttsSTTModelDir: cfg.indexttsSTTModelDir,
  trayEnabled: cfg.trayEnabled,
  closeBehavior: cfg.closeBehavior,
  skipCloseConfirm: cfg.skipCloseConfirm,
  confirmDangerousTools: cfg.confirmDangerousTools !== false,
  autoLaunch: cfg.autoLaunch,
  globalShortcutEnabled: cfg.globalShortcutEnabled,
  globalShortcut: cfg.globalShortcut
  }
  }
  
  /**
  * 从某条会话的末尾提取一小段「上次聊到哪」（B5 主动话题延续）。
  *
  * 只取最后几条、每条截断，总长度封顶，避免把上一整个会话拖进来导致 token 暴涨。
  * 这是本地读取，不调用模型。
  */
  function previousTopicSnippet(messages: ChatMessage[] | undefined): string | undefined {
  if (!Array.isArray(messages) || messages.length === 0) return undefined
  const usable = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
  if (usable.length === 0) return undefined
  
  const CUT = 90 // 单条截断
  const MAX = 260 // 总长封顶
  const tail = usable.slice(-4)
  const parts: string[] = []
  for (const m of tail) {
  const raw = typeof m.content === 'string' ? m.content : ''
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) continue
  // 工具/代码块内容对"话题"没有帮助，先剥掉代码围栏
  const cleaned = text.replace(/```[\s\S]*?```/g, '（代码）').trim()
  if (!cleaned) continue
  const who = m.role === 'user' ? '用户' : '我'
  const piece = `${who}：${cleaned.length > CUT ? cleaned.slice(0, CUT) + '…' : cleaned}`
  parts.push(piece)
  }
  if (parts.length === 0) return undefined
  let out = parts.join(' ／ ')
  if (out.length > MAX) out = out.slice(0, MAX) + '…'
  return out
  }
  
  /**
  * 计算注入环境块用的会话时间线索。
  *
  * 全部来自本地会话存储，**不发起任何模型请求**，因此不产生额外 token 费用。
  *   1) sessionStartedAt：当前会话的 createdAt → 「这次对话已经持续…」
  *   2) lastChatAt：**除当前会话外**最近一次 updatedAt → 「距上一次对话…」
  *      刻意排除当前会话，否则刚发过一条消息就会显示"1 分钟前"。
  *   3) previousTopics：上次那个会话的末尾几句 → 「上次聊到…」（B5）
  */
  function sessionTimingFacts(sessionId?: string): {
  sessionStartedAt?: number
  lastChatAt?: number
  previousTopics?: string
  } {
  try {
  const sessions = listSessions()
  if (sessions.length === 0) return {}
  const now = Date.now()
  const current = sessionId ? sessions.find((s) => s.id === sessionId) : undefined
  
  // 上次对话：优先取「最近一次更新、且不是当前会话」
  const others = sessions.filter((s) => s.id !== sessionId && s.updatedAt > 0)
  const lastChatAt = others.length > 0 ? Math.max(...others.map((s) => s.updatedAt)) : undefined
  
  // 本次持续：当前会话的创建时间；没有 sessionId 时用最早那条的创建时间兜底
  const startedAt = current?.createdAt ?? (sessions.length > 0 ? Math.min(...sessions.map((s) => s.createdAt)) : undefined)
  
  const facts: {
  sessionStartedAt?: number
  lastChatAt?: number
  previousTopics?: string
  } = {}
  if (typeof startedAt === 'number' && startedAt > 0 && startedAt <= now) facts.sessionStartedAt = startedAt
  // 只有确实早于本次开始，才算"上一次对话"
  if (typeof lastChatAt === 'number' && lastChatAt > 0 && (!startedAt || lastChatAt < startedAt)) {
  facts.lastChatAt = lastChatAt
  // 话题延续：取最近更新的那条非当前会话
  const prev = others.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a))
  // 只有开启新会话时才带"上次聊到"，同一会话内没必要重复（它本来就在上下文里）
  if (!current) {
  const snippet = previousTopicSnippet(prev.messages)
  if (snippet) facts.previousTopics = snippet
  }
  }
  return facts
  } catch {
  return {}
  }
  }
  
  /** 启动一轮流式对话：后台执行，结果/思考/工具事件全部推给发起请求的渲染进程 */
  async function runChatStream(
  sender: WebContents,
  payload: { messages: ChatMessage[]; mode: AgentMode; sessionId?: string; profile?: ProfileFacts; agentRole?: string; permLevel?: number }
  ): Promise<void> {
  const cfg = loadConfig()
  // 会话时间线索（A1 本次聊了多久 / A2 距上次多久）。
  // 只读会话存储，不额外调用模型，因此不增加 token 与请求次数。
  // 用户画像（C1/C4）：权威来源是渲染层 localStorage，随消息传来；
  // 为空时 renderProfileBlock 返回空串，完全不占 token。
  // 任务（D6）：进行中任务清单随每次对话注入，让 agent 能感知用户手头的事；
  // 没有进行中任务时 renderTaskBlock 返回空串，不占 token。
  // RAG：记忆库 + 上传文件不再全量注入。以最后一条用户消息为 query，
  // 本地 BM25 检索命中片段注入（renderRagBlock 空命中返回空串不占 token）。
  // 兜底：检索零命中但用户明确附带了文件时，提供这些文件全文。
  // 人设提示词（prompts/*）不经过检索，仍在 buildSystemPrompt 内全量注入。
  const lastUserMsg = (() => {
    for (let i = payload.messages.length - 1; i >= 0; i--) {
      const m = payload.messages[i]
      if (m && m.role === 'user') return m
    }
    return null
  })()
  const lastUserText = lastUserMsg && typeof lastUserMsg.content === 'string' ? lastUserMsg.content.trim() : ''
  const ragBlock = renderRagBlock(lastUserText)
  const attachNames = Array.isArray(lastUserMsg?.attachments) ? lastUserMsg.attachments.map((a) => a && a.name ? a.name : '').filter(Boolean) : []
  const memoryBlock = ragBlock || (attachNames.length > 0 ? renderFilesFull(attachNames) : '')
  if (memoryBlock) console.log(`[rag] query=${lastUserText.slice(0, 60)} hits=${(memoryBlock.match(/^\d+\./gm) || []).length}`)
  const system = buildSystemPrompt(
  payload.mode,
  undefined,
  sessionTimingFacts(payload.sessionId),
  renderProfileBlock(payload.profile),
  (payload.agentRole ?? cfg.agentRole) as AgentRoleId | undefined,
  renderTaskBlock(listTasks()),
  memoryBlock
  )
  // 工具目录不直接拼进 system：交给 chatCompletionStream 在带 tools 请求时注入，降级纯文本时自动移除
  const catalog = buildToolCatalog(payload.mode, cfg)
  // 回放前剥掉 UI 留痕字段（toolCalls / reasoning / attachments），避免把非标准字段送回模型接口
  const history: ChatMessage[] = payload.messages.map((m) => {
  const { toolCalls: _tc, reasoning: _r, attachments: _a, ...rest } = m
  // 给回放的历史消息标注相对时间（[今天 14:30] 等），让模型分清新旧；
  // 只标注用户消息：若也给 agent 自己的历史回复加前缀，模型思考时会模仿这个格式，
  // 把「[今天 13:54]」复述进自己的输出。agent 回复紧随用户消息，时间可由上一条用户消息推断。
  if (m.role === 'user' && typeof m.createdAt === 'number' && m.createdAt > 0 && rest.content && typeof rest.content === 'string') {
    rest.content = `[${relTimeLabel(m.createdAt)}] ${rest.content}`
  }
  return rest as ChatMessage
  })
  // C2：按上下文预算裁剪历史。原先全量回放，长对话会撞上下文上限直接报错。
  // 裁剪是确定性的（不额外调模型），从尾部保留最近消息，并在最前面说明省略了多少条。
  const trimmed = trimHistory(history, cfg.contextWindowTokens, approxTokens(system))
  const full: ChatMessage[] = [{ role: 'system', content: system }, ...trimmed.messages]
  if (trimmed.dropped > 0) {
  console.log(
  `[history] 裁剪 ${trimmed.dropped} 条早期消息（≈${trimmed.originalTokens} → ≈${trimmed.tokens} tokens，窗口 ${cfg.contextWindowTokens}）`
  )
  }
  
  // 把当前模式启用的工具转成 function calling 参数，交给模型自动调用
  const enabledTools = payload.mode === 'chat'
  ? cfg.chatToolsEnabled
  ? toolRegistry.getAllTools().filter((t) => {
  const ov = cfg.toolModeOverrides[t.id]
  return !t.deprecated && t.enabled && ((t.chatBuiltin && ov?.chat !== false) || ov?.chat === true)
  })
  : toolRegistry.getAllTools().filter((t) => !t.deprecated && t.enabled && t.chatBuiltin && cfg.toolModeOverrides[t.id]?.chat !== false)
  : toolRegistry.getAllTools().filter((t) => {
  if (t.deprecated || !t.enabled) return false
  const ov = cfg.toolModeOverrides[t.id]
  if (ov && ov[payload.mode] !== undefined) return ov[payload.mode]
  if (t.modes.length === 0) return true
  return t.modes.includes(payload.mode)
  })
  
  const tools: ChatToolSpec[] = enabledTools.map((t) => ({
  name: t.id,
  description: `${t.name}。${t.description}`,
  parameters: TOOL_PARAMS[t.id] ?? { type: 'object', properties: {}, additionalProperties: true }
  }))
  
  const emit = (event: ChatStreamEvent): void => {
  if (!sender.isDestroyed()) sender.send(CHAT_STREAM_CHANNEL, event)
  }
  // 工具调用过程实时推给发起请求的那个渲染进程（不广播给其他窗口）
  const emitToolEvent = (event: ToolCallEvent): void => {
  if (!sender.isDestroyed()) sender.send(CHAT_TOOL_EVENT_CHANNEL, event)
  }
  
  const controller = new AbortController()
  activeChatStreams.set(sender.id, controller)
  let lastUsageAt = 0
  const roundStartAt = Date.now()
  try {
  const result = await chatCompletionStream(cfg, full, payload.mode, {
  tools,
  toolCatalogText: catalog,
  signal: controller.signal,
  onDelta: (text, round) => emit({ type: 'delta', round, text }),
  onReasoning: (text, round) => emit({ type: 'reasoning', round, text }),
  onToolEvent: emitToolEvent,
  onUsage: (usage, round) => {
  const now = Date.now()
  const durationMs = now - (lastUsageAt > 0 ? lastUsageAt : roundStartAt)
  lastUsageAt = now
  recordUsage(cfg.model, usage)
  emit({ type: 'usage', round: round ?? 0, model: cfg.model, usage: usage ?? {}, durationMs })
  },
  toolLabel: (id) => toolRegistry.getById(id)?.name,
  toolExecutor: async (name, args, mode) => {
  const tool = toolRegistry.getById(name)
  if (!tool) return `未知工具：${name}`
  // agent 主动向用户提问：挂起等用户回答，回答作为工具结果回传模型继续
  if (name === 'ask_user') {
    const answer = await askUser(sender, args)
    if (!answer) return '用户没有回答（超时或已忽略），请不要再追问同样的问题，改用已有信息继续或换一种方式。'
    return `用户回答：${answer}`
  }
  // 高危操作执行前确认：向用户展示目的，允许才执行。
  // 本机权限为「完全权限」（档位 3）时视为已授权，直接执行不再逐次确认；其余档位都要确认。
  const cfgNow = loadConfig()
  const perm = Number(payload.permLevel ?? 1)
  if (cfgNow.confirmDangerousTools !== false && perm < 3 && CONFIRM_RISKS.includes(tool.risk as (typeof CONFIRM_RISKS)[number])) {
    const allowed = await requestToolConfirm(sender, tool, args)
    if (!allowed) return `用户拒绝了该操作（${tool.name}），请立即停止该动作，并向用户说明原因或询问替代方案。`
  }
  return tool.execute(args, { config: cfgNow, mode })
  }
  })
  emit({
  type: 'done',
  round: 0,
  content: result.content,
  reasoning: result.reasoning,
  toolCalls: result.toolCalls,
  stopped: result.stopped
  })
  } catch (err) {
  emit({ type: 'error', round: 0, message: (err as Error).message })
  } finally {
  activeChatStreams.delete(sender.id)
  // agent 可能通过 task_* 工具改过任务：回复收尾后推一次变更，任务页实时刷新
  if (!sender.isDestroyed()) sender.send('tasks:changed')
  }
  }
  
  function registerIpc(): void {
  // ---------- 对话（流式）：chat:send 立即返回，正文/思考/结束全走 chat:stream 事件 ----------
  ipcMain.handle('chat:send', (e, payload: { messages: ChatMessage[]; mode: AgentMode; sessionId?: string; profile?: ProfileFacts; agentRole?: string; permLevel?: number }) => {
  void runChatStream(e.sender, payload)
  return { ok: true }
  })
  
  /** 渲染层「停止」按钮：中止当前进行中的流式对话（保留已生成内容） */
  ipcMain.on('chat:stop', (e) => {
  activeChatStreams.get(e.sender.id)?.abort()
  })
  
  /** 渲染层回应高危操作确认：允许 / 拒绝 */
  ipcMain.handle('chat:toolConfirmResolve', (_e, payload: { id?: string; allow?: boolean }) => {
  const id = String(payload?.id ?? '')
  const fn = toolConfirmPending.get(id)
  if (fn) {
    toolConfirmPending.delete(id)
    fn(Boolean(payload?.allow))
  }
  return { ok: true }
  })
  
  /** 渲染层回应 agent 提问：带上用户回答 */
  ipcMain.handle('chat:toolAskResolve', (_e, payload: { id?: string; answer?: string }) => {
  const id = String(payload?.id ?? '')
  const fn = toolAskPending.get(id)
  if (fn) {
    toolAskPending.delete(id)
    fn(String(payload?.answer ?? ''))
  }
  return { ok: true }
  })
  
  /** 上传文本文件：弹系统文件选择框，读回内容（限制 512KB、仅文本类） */
  ipcMain.handle('file:pickText', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
  const picked = win
  ? await dialog.showOpenDialog(win, {
  title: '选择要阅读的文本文件',
  filters: TEXT_FILE_FILTERS,
  properties: ['openFile']
  })
  : await dialog.showOpenDialog({ filters: TEXT_FILE_FILTERS, properties: ['openFile'] })
  if (picked.canceled || picked.filePaths.length === 0) return { ok: false as const, canceled: true as const }
  const path = picked.filePaths[0]
  const name = path.split(/[\\/]/).pop() ?? path
  try {
  const info = await stat(path)
  if (info.size > MAX_TEXT_FILE_SIZE) {
  return {
  ok: false as const,
  error: `文件太大（${Math.ceil(info.size / 1024)}KB），当前仅支持 ${Math.floor(MAX_TEXT_FILE_SIZE / 1024)}KB 以内的文本文件`
  }
  }
  const raw = await readFile(path)
  const content = raw.toString('utf8')
  if (content.includes('\u0000')) {
  return { ok: false as const, error: '这个文件看起来不是文本（含二进制内容），当前仅支持阅读文本文字' }
  }
  return { ok: true as const, name, path, content, size: info.size }
  } catch (err) {
  return { ok: false as const, error: `读取失败：${(err as Error).message}` }
  }
  })
  
  /** 背景音乐曲库：扫描 工程根/背景音乐 目录（mp3/wav/m4a/flac/ogg 等） */
  ipcMain.handle('assets:list', () => listAssets())
  ipcMain.handle('assets:import', async () => {
  const r = await dialog.showOpenDialog({
  title: '导入到素材库',
  properties: ['openFile'],
  filters: [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'] },
  { name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'] },
  { name: '所有文件', extensions: ['*'] }
  ]
  })
  if (r.canceled || !r.filePaths?.[0]) return null
  try {
  const item = await importMedia(r.filePaths[0], 'local')
  return item
  } catch (e) {
  return { error: (e as Error)?.message || '导入失败' }
  }
  })
  ipcMain.handle('assets:pickCustom', async () => {
  const r = await dialog.showOpenDialog({
  title: '选择媒体文件（复制到应用数据目录，不进入素材库）',
  properties: ['openFile'],
  filters: [
  { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico'] },
  { name: '视频', extensions: ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi'] },
  { name: '所有文件', extensions: ['*'] }
  ]
  })
  if (r.canceled || !r.filePaths?.[0]) return null
  try {
  const item = await importMedia(r.filePaths[0], 'ext')
  return item
  } catch (e) {
  return { error: (e as Error)?.message || '导入失败' }
  }
  })
  ipcMain.handle('assets:openDir', () => openAssetDirInShell())
  ipcMain.handle('music:list', () => listMusicTracks())
  /** 歌单弹窗「打开文件夹」：用系统文件管理器打开曲库目录 */
  ipcMain.handle('music:openDir', async () => {
  try {
  const err = await shell.openPath(MUSIC_DIR)
  return { ok: !err, error: err || undefined }
  } catch (e) {
  return { ok: false, error: (e as Error).message }
  }
  })
  /** 导入歌曲：文件选择（可多选）→ 复制进曲库目录（重名自动加序号，不覆盖已有文件） */
  ipcMain.handle('music:import', async () => {
  const win = BrowserWindow.getFocusedWindow()
  const opts = {
  title: '导入歌曲到曲库',
  properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
  filters: [{ name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'webm'] }]
  }
  let picked: string[]
  try {
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || r.filePaths.length === 0) return { ok: true as const, canceled: true, added: [] }
  picked = r.filePaths
  } catch (e) {
  return { ok: false as const, error: `打开文件选择框失败：${(e as Error).message}` }
  }
  const added: string[] = []
  for (const src of picked) {
  const ext = (src.match(/\.[^.]+$/) || [''])[0].toLowerCase()
  if (!MUSIC_EXTS.has(ext)) continue
  const base = basename(src, ext)
  let target = join(MUSIC_DIR, base + ext)
  let n = 2
  while (existsSync(target)) {
  target = join(MUSIC_DIR, `${base} (${n})${ext}`)
  n += 1
  }
  try {
  await copyFile(src, target)
  added.push(basename(target))
  } catch (e) {
  // 单个文件复制失败：跳过，不影响其它文件
  }
  }
  return { ok: true as const, canceled: false, added }
  })
  
  ipcMain.handle('sessions:list', () => listSessions())
  ipcMain.handle('sessions:save', (_e, session: Session) => saveSession(session))
  ipcMain.handle('sessions:delete', (_e, id: string) => deleteSession(id))
  ipcMain.handle('sessions:patch', (_, payload: { id: string; patch: { pinned?: boolean; projectId?: string; groupId?: string } }) =>
  patchSession(payload.id, payload.patch)
  )
  
  ipcMain.handle('sessions:rename', (_e, payload: { id: string; title: string }) =>
  renameSession(payload.id, payload.title)
  )
  
  // ---------- 项目与分组 ----------
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('groups:list', () => listGroups())
  ipcMain.handle('projects:save', (_e, p: { id: string; name: string; createdAt: number }) => saveProject(p))
  ipcMain.handle('groups:save', (_e, g: { id: string; name: string; createdAt: number }) => saveGroup(g))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('groups:delete', (_e, id: string) => deleteGroup(id))
  ipcMain.handle('groups:rename', (_e, payload: { id: string; name: string }) =>
  renameGroup(payload.id, payload.name)
  )
  ipcMain.handle(
  'groups:patch',
  (_e, payload: { id: string; patch: Partial<Pick<Group, 'name' | 'color' | 'pinned'>> }) =>
  patchGroup(payload.id, payload.patch)
  )
  ipcMain.handle('groups:reorder', (_e, ids: string[]) => reorderGroups(ids))
  ipcMain.handle('sessions:assign', (_e, payload: { sessionId: string; projectId?: string; groupId?: string }) =>
  assignSession(payload.sessionId, { projectId: payload.projectId, groupId: payload.groupId })
  )
  
  // ---------- 用户画像（权威存储 data.json，重启不丢；localStorage 只作渲染层缓存） ----------
  ipcMain.handle('user:getProfile', () => getPersistedUserProfile() ?? null)
  ipcMain.handle('user:setProfile', (_e, profile: PersistedUserProfile) => savePersistedUserProfile(profile))
  
  // ---------- 任务（任务页 + Agent 工具共用；权威存储 data.json） ----------
  ipcMain.handle('tasks:list', () => listTasks())
  ipcMain.handle('tasks:save', (_e, task: Partial<TaskItem> & { title: string }) => saveTask(task))
  ipcMain.handle(
  'tasks:patch',
  (_e, payload: { id: string; patch: Partial<Pick<TaskItem, 'title' | 'note' | 'priority' | 'status' | 'dueAt' | 'tag'>> }) =>
  patchTask(payload.id, payload.patch)
  )
  ipcMain.handle('tasks:delete', (_e, id: string) => deleteTask(id))
  /** 批量操作：一次 IPC 完成多条，避免循环调用造成多次磁盘读写 */
  ipcMain.handle('tasks:bulk', (_e, payload: { ids: string[]; action: string; priority?: string }) =>
  bulkTasks(
  Array.isArray(payload?.ids) ? payload.ids : [],
  (['done', 'active', 'cancelled', 'delete'].includes(payload?.action ?? '')
  ? payload.action
  : 'done') as 'done' | 'active' | 'cancelled' | 'delete',
  payload?.priority as TaskItem['priority'] | undefined
  )
  )
  /** 清理所有已完成任务（已取消的保留） */
  ipcMain.handle('tasks:clearCompleted', () => clearCompletedTasks())
  /** 拖拽排序：按给定 id 顺序写入 sortOrder */
  ipcMain.handle('tasks:reorder', (_e, ids: string[]) => reorderTasks(Array.isArray(ids) ? ids : []))
  
  ipcMain.handle('config:get', () => toConfigInfo(loadConfig()))
  
  ipcMain.handle('config:save', (_e, cfg: Partial<LlmConfig>) => {
  const current = loadConfig()
  const next = saveConfig({ ...current, ...cfg })
  return toConfigInfo(next)
  })
  
  ipcMain.handle('config:test', (_e, cfg: Partial<LlmConfig>) => {
  const current = loadConfig()
  // 渲染层可能回传掩码/空 Key：不能覆盖已存明文真 Key
  const apiKey = cfg.apiKey && !isMasked(cfg.apiKey) ? cfg.apiKey : current.apiKey
  const merged = { ...current, ...cfg, apiKey }
  return testConnection(merged)
  })
  
  ipcMain.handle('config:listModels', (_e, cfg: Partial<LlmConfig>) => {
  const current = loadConfig()
  // 渲染层可能回传掩码/空 Key：不能覆盖已存明文真 Key
  const apiKey = cfg.apiKey && !isMasked(cfg.apiKey) ? cfg.apiKey : current.apiKey
  const merged = { ...current, ...cfg, apiKey }
  return fetchModelList(merged)
  })
  
  // ---------- Token 用量统计（仅本地） ----------
  ipcMain.handle('usage:get', () => getUsageStats())
  ipcMain.handle('usage:reset', () => resetUsageStats())
  
  // ---------- E5 定时提醒 ----------
  ipcMain.handle('reminders:list', () => listReminders())
  ipcMain.handle('reminders:save', (_e, r: Partial<{ id: string; text: string; at: number; repeat: string; enabled: boolean }>) =>
  saveReminder({ ...r, repeat: r?.repeat === 'daily' ? 'daily' : 'once' })
  )
  ipcMain.handle('reminders:delete', (_e, id: string) => deleteReminder(id))
  ipcMain.handle('reminders:toggle', (_e, payload: { id: string; enabled: boolean }) =>
  toggleReminder(payload.id, payload.enabled)
  )
  
  // ---------- F1 主动关怀 ----------
  // 全部本地判断，不调用模型，因此不产生 token 成本。
  // 渲染层只需告诉三件事：上次对话时间、当前是否空会话、用户画像。
  ipcMain.handle(
  'proactive:decide',
  (_e, payload: { lastChatAt?: number; emptySession: boolean; profile?: UserProfile }) =>
  decideProactive({
  lastChatAt: payload?.lastChatAt,
  emptySession: payload?.emptySession !== false,
  profile: payload?.profile,
  // 文案随人设切换（守岸人 / 莫宁），由渲染层切换角色时 saveConfig 同步过来
  role: loadConfig().agentRole
  })
  )
  ipcMain.handle('proactive:said', (_e, reason: ProactiveReason) => {
  markProactiveSaid(reason)
  return true
  })
  ipcMain.handle('proactive:status', () => proactiveStatus())
  ipcMain.handle('proactive:setEnabled', (_e, enabled: boolean) => setProactiveEnabled(Boolean(enabled)))
  /** 新会话开始时重置「本轮已开口」计数 */
  ipcMain.handle('proactive:resetSession', () => {
  resetProactiveSession()
  return true
  })
  
  // ---------- E3 拖拽落文件：按路径读取（与「选择文件」同一套校验）----------
  // 拖拽不走 dialog，所以渲染层通过 webUtils.getPathForFile 拿到真实路径后交给这里。
  // 体积上限与二进制检测刻意与 file:pickText 保持一致，避免两处行为不一致。
  ipcMain.handle('file:readTextByPath', async (_e, payload: { path: string }) => {
  const p = String(payload?.path ?? '').trim()
  if (!p) return { ok: false as const, error: '没有拿到文件路径' }
  const name = p.split(/[\\/]/).pop() ?? p
  try {
  const info = await stat(p)
  if (info.isDirectory()) return { ok: false as const, error: '这是一个文件夹，拖入文件才有效' }
  if (info.size > MAX_TEXT_FILE_SIZE) {
  return {
  ok: false as const,
  error: `文件太大（${Math.ceil(info.size / 1024)}KB），当前仅支持 ${Math.floor(MAX_TEXT_FILE_SIZE / 1024)}KB 以内的文本文件`
  }
  }
  const raw = await readFile(p)
  const content = raw.toString('utf8')
  if (content.includes('\u0000')) {
  return { ok: false as const, error: '这个文件看起来不是文本（含二进制内容），当前仅支持阅读文本文字' }
  }
  return { ok: true as const, name, path: p, content, size: info.size }
  } catch (err) {
  return { ok: false as const, error: `读取失败：${(err as Error).message}` }
  }
  })
  
  // ---------- E1 工作区文件 ----------
  // 只读：列目录、读文本、在资源管理器里定位。写盘能力不在这里暴露。
  ipcMain.handle('workspace:root', () => workspaceRoot())
  ipcMain.handle('workspace:list', (_e, rel?: string) => listDir(rel))
  ipcMain.handle('workspace:read', (_e, rel: string) => readWorkspaceFile(rel))
  ipcMain.handle('workspace:reveal', (_e, rel: string) => revealInFolder(rel))
  ipcMain.handle('memory:list', () => ({ ok: true, entries: listMemory() }))
  ipcMain.handle('memory:add', (_e, text: string) => addMemory(text))
  ipcMain.handle('memory:update', (_e, id: string, text: string) => updateMemory(id, text))
  ipcMain.handle('memory:delete', (_e, id: string) => deleteMemory(id))

  // RAG 资料库（上传文件入库 / 列表 / 移除）
  ipcMain.handle('rag:saveDoc', (_e, name: string, content: string) => saveDocument(name, content))
  ipcMain.handle('rag:listDocs', () => ({ ok: true, names: listDocuments() }))
  ipcMain.handle('rag:removeDoc', (_e, name: string) => removeDocument(name))
  
  // ---------- F4/F5/F8：托盘、全局快捷键、开机自启 ----------
  ipcMain.handle('prefs:tray', (_e, enabled: boolean) => {
  const next = saveConfig({ ...loadConfig(), trayEnabled: Boolean(enabled) })
  refreshTray()
  return next
  })
  ipcMain.handle('prefs:autoLaunch', (_e, enabled: boolean) => {
  const next = saveConfig({ ...loadConfig(), autoLaunch: Boolean(enabled) })
  applyAutoLaunch()
  return next
  })
  // 常规设置：关闭按钮行为（ask / tray / quit）
  ipcMain.handle('prefs:closeBehavior', (_e, behavior: 'ask' | 'tray' | 'quit') => {
  const cur = loadConfig()
  const next = saveConfig({ ...cur, closeBehavior: behavior === 'tray' || behavior === 'quit' ? behavior : 'ask' })
  return next
  })
  // 常规设置：不再显示关闭确认
  ipcMain.handle('prefs:skipCloseConfirm', (_e, enabled: boolean) => {
  const next = saveConfig({ ...loadConfig(), skipCloseConfirm: Boolean(enabled) })
  return next
  })
  // 常规设置：agent 执行高危操作前请求用户确认
  ipcMain.handle('prefs:confirmDangerous', (_e, enabled: boolean) => {
  const next = saveConfig({ ...loadConfig(), confirmDangerousTools: enabled !== false })
  return next
  })
  ipcMain.handle('prefs:shortcut', (_e, payload: { enabled?: boolean; accelerator?: string }) => {
  const cur = loadConfig()
  const next = saveConfig({
  ...cur,
  globalShortcutEnabled: payload?.enabled !== undefined ? Boolean(payload.enabled) : cur.globalShortcutEnabled,
  globalShortcut: typeof payload?.accelerator === 'string' && payload.accelerator.trim() ? payload.accelerator.trim() : cur.globalShortcut
  })
  registerGlobalShortcut()
  return next
  })
  /** 如实回报快捷键是否真的注册上了（被占用时用户需要知道） */
  ipcMain.handle('prefs:shortcutStatus', () => shortcutStatus())
  
  // ---------- 导出为文件（F6）：纯本地写盘，不消耗任何模型调用 ----------
  ipcMain.handle(
  'file:saveText',
  async (_e, payload: { defaultName: string; content: string; ext?: string }) => {
  const win = mainWindowRef
  const ext = (payload?.ext ?? 'md').replace(/^\./, '')
  const r = win
  ? await dialog.showSaveDialog(win, {
  title: '导出为文件',
  defaultPath: payload?.defaultName || `${agentRoleName(loadConfig().agentRole)}对话.${ext}`,
  filters: [
  { name: ext === 'md' ? 'Markdown' : '文本', extensions: [ext] },
  { name: '全部文件', extensions: ['*'] }
  ]
  })
  : { canceled: true, filePath: undefined as string | undefined }
  if (r.canceled || !r.filePath) return { ok: false, canceled: true as const }
  try {
  await writeFile(r.filePath, String(payload?.content ?? ''), 'utf-8')
  return { ok: true, path: r.filePath }
  } catch (e) {
  return { ok: false, error: (e as Error)?.message || '写入失败' }
  }
  }
  )
  
  // ---------- 本地语音合成（D1 · GPT-SoVITS api_v2） ----------
  // 只在本机发起请求，不经过任何云服务；失败返回可读原因而不是抛异常。
  ipcMain.handle('tts:speak', async (_e, payload: { text: string; dayPart?: string; force?: boolean }) => {
  const cfg = loadConfig()
  if (cfg.ttsProvider === 'mimo') {
  return synthesizeMiMo({
  text: payload?.text ?? '',
  apiKey: cfg.mimoTTSKey,
  model: cfg.mimoTTSModel,
  voice: cfg.mimoTTSVoice,
  baseURL: cfg.mimoTTSBaseURL,
  refAudio: cfg.ttsRefAudio,
  // 语气描述优先（用户填的风格指令）；缺省回退到参考音频文本（对齐 Cyrene fallback）
  stylePrompt: cfg.mimoStylePrompt || cfg.ttsPromptText,
  force: Boolean(payload?.force)
  })
  }
  if (cfg.ttsProvider === 'indextts') {
  return indexttsSynthesize({
  text: payload?.text ?? '',
  refAudio: cfg.indexttsRefAudio,
  device: cfg.indexttsDevice,
  force: Boolean(payload?.force)
  })
  }
  return synthesize(
  {
  text: payload?.text ?? '',
  refAudio: cfg.ttsRefAudio,
  promptText: cfg.ttsPromptText,
  // D2：时段由渲染层按系统时间给出，用来调语速与停顿
  dayPart: payload?.dayPart,
  force: Boolean(payload?.force)
  },
  cfg.ttsURL
  )
  })
  ipcMain.handle('tts:probe', async () => {
  const cfg = loadConfig()
  if (cfg.ttsProvider === 'mimo') return mimoProbe(cfg.mimoTTSKey, cfg.mimoTTSBaseURL)
  return probe(cfg.ttsURL)
  })
  ipcMain.handle('tts:cacheStats', async () => ttsCacheStats())
  ipcMain.handle('tts:cacheClear', async () => ttsCacheClear())
  ipcMain.handle('tts:cacheDeleteText', async (_e, payload: { text?: string }) => {
    const cfg = loadConfig()
    ttsCacheDeleteText(payload?.text ?? '')
    if (cfg.ttsProvider === 'indextts' && cfg.indexttsRefAudio) {
      indexttsCacheDeleteText(payload?.text ?? '', cfg.indexttsRefAudio)
    }
    return { ok: true }
  })
  // ---------- IndexTTS 本地引擎（参照 D:\shorekeeper-agent 移植） ----------
  ipcMain.handle('indextts:status', async () => indexttsStatus())
  ipcMain.handle('indextts:sttStatus', async (_e, modelDir: string) => indexttsSttStatus(modelDir))
  /** 选 IndexTTS 参考音频（wav/mp3），写回配置并返回最新配置 */
  ipcMain.handle('indextts:pickRef', async () => {
  const win = mainWindowRef
  const r = win
  ? await dialog.showOpenDialog(win, {
  title: '选择 IndexTTS 参考音频（建议 5–15 秒、单人、无背景音乐）',
  filters: [{ name: '音频', extensions: ['wav', 'mp3', 'flac', 'ogg'] }],
  properties: ['openFile']
  })
  : { canceled: true, filePaths: [] as string[] }
  if (r.canceled || r.filePaths.length === 0) return loadConfig()
  return saveConfig({ ...loadConfig(), indexttsRefAudio: r.filePaths[0] })
  })
  /** 选参考音频文件（wav），写回配置并返回最新配置 */
  ipcMain.handle('tts:pickRef', async () => {
  const win = mainWindowRef
  const r = win
  ? await dialog.showOpenDialog(win, {
  title: '选择参考音频（决定音色）',
  filters: [{ name: '音频', extensions: ['wav', 'mp3', 'flac', 'ogg'] }],
  properties: ['openFile']
  })
  : { canceled: true, filePaths: [] as string[] }
  if (r.canceled || r.filePaths.length === 0) return loadConfig()
  return saveConfig({ ...loadConfig(), ttsRefAudio: r.filePaths[0] })
  })
  
  
  // ---------- 界面直连工具执行（只读 + 打开白名单；写入/命令类工具不开放，避免界面按钮被滥用） ----------
  const UI_TOOL_WHITELIST = new Set([
    'system_status',
    'system_info',
    'open_path',
    'read_file',
    'list_dir',
    'web_search',
    'fetch_url',
    'exchange_rate',
    'weather',
    'translate',
    'recall_history',
    'task_list',
    'query_expense'
  ])
  ipcMain.handle('tools:run', async (_e, payload: { id?: string; args?: Record<string, unknown> }) => {
    const id = String(payload?.id ?? '').trim()
    if (!UI_TOOL_WHITELIST.has(id)) return { ok: false, error: `界面直连不允许调用工具「${id}」` }
    const tool = toolRegistry.getById(id)
    if (!tool) return { ok: false, error: `未知工具：${id}` }
    try {
      const result = await tool.execute(payload?.args ?? {}, { config: loadConfig(), mode: 'chat' })
      return { ok: true, result }
    } catch (e) {
      return { ok: false, error: (e as Error).message || String(e) }
    }
  })
  
  // ---------- 工具开关（参照 Shorekeeper TOOL_GET_CATALOG / TOOL_SET_MODE_OVERRIDE） ----------
  ipcMain.handle('tools:getCatalog', () => getToolCatalog())
  
  ipcMain.handle('tools:getOverrides', () => loadConfig().toolModeOverrides)
  
  ipcMain.handle('tools:setOverride', (_e, payload: { toolId: string; mode: ToolMode; enabled: boolean }) => {
  const p = payload
  if (!p?.toolId || !p?.mode) return { ok: false, error: 'missing toolId or mode' }
  const validModes: ToolMode[] = ['chat', 'code', 'work', 'learn']
  if (!validModes.includes(p.mode)) return { ok: false, error: 'invalid mode' }
  const current = loadConfig()
  const next: Record<string, Record<ToolMode, boolean>> = { ...current.toolModeOverrides }
  next[p.toolId] = { ...(next[p.toolId] ?? {}), [p.mode]: p.enabled !== false }
  saveConfig({ ...current, toolModeOverrides: next })
  return { ok: true }
  })
  
  ipcMain.handle('tools:setChatToolsEnabled', (_e, enabled: boolean) => {
  const current = loadConfig()
  saveConfig({ ...current, chatToolsEnabled: enabled !== false })
  return { ok: true }
  })
  
  // ---------- 终端（规格 5 三：真执行 + 流式输出） ----------
  ipcMain.handle(
  'terminal:run',
  (e, payload: { id: string; command: string; cwd?: string }) =>
  runTerminal(String(payload?.id ?? ''), String(payload?.command ?? ''), payload?.cwd, e.sender)
  )
  
  ipcMain.handle('terminal:kill', (_e, id: string) => killTerminal(String(id ?? '')))
  
  // ---------- 内置浏览器 ↔ Agent 工具的绑定（规格 5 · 八） ----------
  // 渲染层的 <webview> 挂载后把 getWebContentsId() 交上来，主进程用 webContents.fromId()
  // 拿到同一个被控页面，之后 browser_* 工具操作的就是用户眼前这一个实例。
  ipcMain.handle('browser:bind', (e, guestId: number) => {
  const guest = webContents.fromId(Number(guestId))
  if (!guest || guest.isDestroyed()) return { ok: false, error: 'webview 的 webContents 不存在' }
  // 只接受本窗口自己创建的 <webview>（其 host 必须是某个 BrowserWindow 的 webContents）
  const owner = guest.hostWebContents
  if (!owner || owner.isDestroyed()) return { ok: false, error: '该 webContents 不是内嵌 webview' }
  if (!BrowserWindow.fromWebContents(owner)) return { ok: false, error: '拒绝绑定：来源不是本应用的窗口' }
  return bindBrowser(e.sender.id, guest.id)
  })
  ipcMain.handle('browser:unbind', (e) => {
  unbindBrowser(e.sender.id)
  return { ok: true }
  })
  
  // ---------- 窗口控制（自绘标题栏用；配合 titleBarStyle: 'hidden'） ----------
  const windowOf = (e: Electron.IpcMainInvokeEvent) =>
  BrowserWindow.fromWebContents(e.sender) ?? mainWindowRef
  
  ipcMain.handle('window:minimize', (e) => {
  windowOf(e)?.minimize()
  return { ok: true }
  })
  
  ipcMain.handle('window:toggleMaximize', (e) => {
  const w = windowOf(e)
  if (!w) return { ok: false }
  if (w.isMaximized()) w.unmaximize()
  else w.maximize()
  return { ok: true, maximized: w.isMaximized() }
  })
  
  ipcMain.handle('window:close', (e) => {
  windowOf(e)?.close()
  return { ok: true }
  })
  
  ipcMain.handle('window:isMaximized', (e) => Boolean(windowOf(e)?.isMaximized()))
  }
  
  // ---------- 独立数据目录：与打包版（守岸人陪伴终端.exe）共用 userData 会被单实例锁互斥，这里分开 ----------
  app.setPath('userData', join(app.getPath('appData'), 'shorekeeper-agent-dev'))

  // ---------- 单实例：只允许开启一个应用实例（托盘图标也不会叠加） ----------
  if (!app.requestSingleInstanceLock()) {
    // 已有实例在运行：直接退出，不做任何托盘/窗口动作
    app.quit()
  } else {
    // 用户再次启动（双击 / 命令行）：聚焦已有窗口而不是开第二个
    app.on('second-instance', () => {
      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        if (mainWindowRef.isMinimized()) mainWindowRef.restore()
        mainWindowRef.show()
        mainWindowRef.focus()
      }
    })
  }

  app.whenReady().then(() => {
  registerAllTools()
  registerMediaProtocol()
  registerMusicProtocol()
  registerIpc()
  createWindow()
  // F4 / F8：按配置决定是否常驻托盘与开机自启（在窗口之后做，避免拖慢首屏）
  setupTray()
  // E5：定时提醒调度。触发时弹系统通知，并推给渲染层留一条痕迹
  //（只弹通知容易被漏看；对话界面里也有一行更稳妥）
  startReminderScheduler((r) => {
  notify(`${agentRoleName(loadConfig().agentRole)} · 提醒`, r.text)
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
  mainWindowRef.webContents.send('reminders:fired', r)
  }
  })
  applyAutoLaunch()
  // F5：全局快捷键唤起窗口（注册失败不影响启动，例如被其它程序占用）
  registerGlobalShortcut()
  
  app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
  else mainWindowRef?.show()
  })
  })
  
  app.on('window-all-closed', () => {
  killAllTerminals()
  if (process.platform !== 'darwin') app.quit()
  })
  
  app.on('before-quit', () => {
  killAllTerminals()
  // 退出前务必注销全局快捷键，否则可能残留在系统里
  globalShortcut.unregisterAll()
  trayRef?.destroy()
  trayRef = null
  })
  
  /* ============================================================
  F4 托盘常驻 / F5 全局快捷键 / F8 开机自启
  ============================================================ */
  
  let trayRef: Tray | null = null
  /** 真正要退出时置 true，让 close 事件不再拦截 */
  let quitting = false
  /** F5 默认快捷键（可在设置里关闭） */
  const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+S'
  
  /** 显示并聚焦主窗口（托盘与全局快捷键共用） */
  function showMainWindow(): void {
  const win = mainWindowRef
  if (!win || win.isDestroyed()) {
  createWindow()
  return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  }
  
  /** F4：托盘常驻。关闭窗口时不退出，而是隐藏到托盘。 */
  function setupTray(): void {
  const cfg = loadConfig()
  if (!cfg.trayEnabled) return
  if (trayRef) return
  
  // 图标优先用打包进 resources 的 icon.png；开发态回退到 build/ 目录
  const candidates = [
  join(process.resourcesPath ?? '', 'icon.png'),
  join(__dirname, '../../build/icon.png'),
  join(app.getAppPath(), 'build/icon.png')
  ]
  let img = nativeImage.createEmpty()
  for (const p of candidates) {
  if (p && existsSync(p)) {
  const candidate = nativeImage.createFromPath(p)
  if (!candidate.isEmpty()) {
  img = candidate
  break
  }
  }
  }
  if (img.isEmpty()) return // 没图标就不做托盘，避免出现空白图标
  
  trayRef = new Tray(img.resize({ width: 16, height: 16 }))
  trayRef.setToolTip(`${agentRoleName(loadConfig().agentRole)} · 星航陪伴`)
  trayRef.setContextMenu(
  Menu.buildFromTemplate([
  { label: `显示${agentRoleName(loadConfig().agentRole)}`, click: () => showMainWindow() },
  { type: 'separator' },
  {
  label: '退出',
  click: () => {
  quitting = true
  app.quit()
  }
  }
  ])
  )
  // 单击托盘图标也能唤起（Windows 上习惯如此）
  trayRef.on('click', () => showMainWindow())
  }
  
  /** 重建托盘（配置切换时调用） */
  function refreshTray(): void {
  if (trayRef) {
  trayRef.destroy()
  trayRef = null
  }
  setupTray()
  }
  
  /**
  * 是否拦截关闭：只有在「开启托盘常驻」且托盘确实建起来了才拦截。
  * 托盘没建成功却拦截关闭，会让用户关不掉应用。
  */
  function shouldHideOnClose(): boolean {
  return trayRef !== null && !quitting
  }
  
  /** F8：开机自启。用 Electron 内置设置，不写注册表、不加依赖。 */
  function applyAutoLaunch(): void {
  const cfg = loadConfig()
  try {
  app.setLoginItemSettings({
  openAtLogin: Boolean(cfg.autoLaunch),
  // Windows 下用安静启动，避免每次开机弹命令行窗口
  openAsHidden: false
  })
  } catch {
  /* 某些受管环境不允许，忽略即可 */
  }
  }
  
  /** F5：注册/重新注册全局快捷键 */
  function registerGlobalShortcut(): void {
  globalShortcut.unregisterAll()
  const cfg = loadConfig()
  if (!cfg.globalShortcutEnabled) return
  const accel = cfg.globalShortcut || DEFAULT_SHORTCUT
  try {
  globalShortcut.register(accel, () => showMainWindow())
  } catch {
  /* 组合键非法或被占用：不影响应用运行 */
  }
  registerMusicHotkeys()
  }

  /**
  * 音乐全局快捷键（任何界面都生效）：
  * Ctrl+Shift+→ 下一首 / Ctrl+Shift+← 上一首 / Ctrl+Shift+Space 播放·暂停
  * 主进程收到后转发渲染层，由 musicStore 执行（与播放器按钮同一状态源）。
  */
  function registerMusicHotkeys(): void {
  const send = (cmd: 'next' | 'prev' | 'toggle'): void => {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
  mainWindowRef.webContents.send('sk:music-key', cmd)
  }
  }
  const binds: Array<[string, 'next' | 'prev' | 'toggle']> = [
  ['CommandOrControl+Shift+Right', 'next'],
  ['CommandOrControl+Shift+Left', 'prev'],
  ['CommandOrControl+Shift+Space', 'toggle']
  ]
  for (const [accel, cmd] of binds) {
  try {
  globalShortcut.register(accel, () => send(cmd))
  } catch {
  /* 组合键被系统/输入法占用：忽略，不影响应用运行 */
  }
  }
  }
  
  /** 查询当前全局快捷键是否注册成功（设置页用来如实显示） */
  function shortcutStatus(): { accelerator: string; registered: boolean } {
  const cfg = loadConfig()
  const accel = cfg.globalShortcut || DEFAULT_SHORTCUT
  return { accelerator: accel, registered: globalShortcut.isRegistered(accel) }
  }
  