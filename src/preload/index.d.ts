import type { ChatMessage, ConfigInfo, LlmConfig, ModelListResult, Session, TestConnectionResult, ToolCallTrace, ToolCatalogEntry, ToolMode, Project, Group, MusicTrack, UsageStats, ProactiveReason, ProactiveSuggestion, TaskItem, TaskPriority } from '../shared/types'
import type {
  BrowserAgentActivity,
  BrowserBindResult,
  ChatStreamEvent,
  ToolCallEvent,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalRunResult
} from '../shared/events'
import type { PickTextFileResult, Reminder, UserProfile, PersistedUserProfile, TaskItem } from '../shared/types'

export interface ShorekeeperApi {
  /** 发起流式对话：主进程立即返回；正文 / 思考 / 结束 / 出错通过 onChatStream 事件回流 */
  sendChat: (
    messages: ChatMessage[],
    mode: string,
    sessionId?: string,
    profile?: ProfileFacts,
    agentRole?: string,
    permLevel?: number
  ) => Promise<{ ok: boolean }>
  /** 停止当前正在进行的回复（保留已生成内容） */
  stopChat: () => void
  /** 复制文本到系统剪贴板 */
  copyText: (text: string) => void
  /** 订阅对话流式输出，返回取消订阅函数 */
  onChatStream: (callback: (event: ChatStreamEvent) => void) => () => void
  /** 弹系统文件选择框，读取一个文本文件（仅文本，512KB 以内） */
  pickTextFile: () => Promise<PickTextFileResult>
  listMusic: () => Promise<MusicTrack[]>
  /** 订阅音乐全局快捷键（Ctrl+Shift+→ 下一首 / ← 上一首 / 空格 播放暂停）；返回取消订阅函数 */
  onMusicKey: (callback: (cmd: 'next' | 'prev' | 'toggle') => void) => () => void
  /** 关闭确认弹窗：主进程要求选择「最小化到托盘 / 直接退出 / 取消」时回调 */
  onCloseAsk: (callback: (payload: { canTray: boolean; roleName: string }) => void) => () => void
  /** 关闭确认弹窗的选择：tray / quit / cancel */
  closeChoose: (action: 'tray' | 'quit' | 'cancel') => Promise<{ ok: boolean }>
  /** 媒体素材库（头像 / 背景卡 / 开屏 / 界面背景共用） */
  assetsList: () => Promise<
    Array<{ name: string; url: string; kind: 'image' | 'video'; size: number; mtime: number }>
  >
  /** 弹文件选择框并把所选文件复制进素材库，返回素材条目 */
  assetsImport: () => Promise<
    | { name: string; url: string; kind: 'image' | 'video'; size: number; mtime: number }
    | null
    | { error: string }
  >
  /** 选择文件（复制到应用数据目录，不进入素材库），返回条目 */
  assetsPickCustom: () => Promise<
    | { name: string; url: string; kind: 'image' | 'video'; size: number; mtime: number }
    | null
    | { error: string }
  >
  /** 在系统文件管理器中打开素材库文件夹 */
  assetsOpenDir: () => Promise<string>
  /** 用系统文件管理器打开曲库文件夹（歌单弹窗「打开文件夹」） */
  openMusicDir: () => Promise<{ ok: boolean; error?: string }>
  /** 导入歌曲：文件选择并复制进曲库目录 */
  importMusic: () => Promise<{ ok: boolean; canceled?: boolean; added?: string[]; error?: string }>
  /** 获取本机 Token 用量统计（仅本地） */
  getUsage: () => Promise<UsageStats>
  /** 清空本机 Token 用量统计 */
  resetUsage: () => Promise<UsageStats>
  listSessions: () => Promise<Session[]>
  saveSession: (session: Session) => Promise<Session[]>
  deleteSession: (id: string) => Promise<Session[]>
  renameSession: (id: string, title: string) => Promise<Session[]>
  patchSession: (id: string, patch: { pinned?: boolean; projectId?: string; groupId?: string }) => Promise<Session[]>
  listProjects: () => Promise<Project[]>
  listGroups: () => Promise<Group[]>
  saveProject: (project: Project) => Promise<Project[]>
  saveGroup: (group: Group) => Promise<Group[]>
  deleteProject: (id: string) => Promise<{ projects: Project[]; sessions: Session[] }>
  deleteGroup: (id: string) => Promise<{ groups: Group[]; sessions: Session[] }>
  renameGroup: (id: string, title: string) => Promise<Group[]>
  patchGroup: (id: string, patch: Partial<Pick<Group, 'name' | 'color' | 'pinned'>>) => Promise<Group[]>
  reorderGroups: (ids: string[]) => Promise<Group[]>
  assignSession: (sessionId: string, patch: { projectId?: string; groupId?: string }) => Promise<Session[]>
  /** 用户画像权威存储：主进程 data.json（localStorage 只作渲染层缓存） */
  getUserProfile: () => Promise<PersistedUserProfile | null>
  saveUserProfile: (profile: PersistedUserProfile) => Promise<PersistedUserProfile>
  /** 任务（D6）：与任务页 + Agent 工具共用 data.json */
  listTasks: () => Promise<TaskItem[]>
  saveTask: (task: Partial<TaskItem> & { title: string }) => Promise<TaskItem[]>
  patchTask: (
    id: string,
    patch: Partial<Pick<TaskItem, 'title' | 'note' | 'priority' | 'status' | 'dueAt' | 'tag'>>
  ) => Promise<TaskItem[]>
  deleteTask: (id: string) => Promise<TaskItem[]>
  /** 任务有变更（agent 工具改过）时回调，任务页实时刷新；返回取消订阅函数 */
  onTasksChanged: (cb: () => void) => () => void
  /** 本地语音合成（D1）：成功返回 data URL 音频，失败返回可读 error；force=true 跳过缓存强制重新合成 */
  ttsSpeak: (text: string, dayPart?: string, force?: boolean) => Promise<{ ok: boolean; dataUrl?: string; error?: string; chars?: number; cached?: boolean }>
  toolsRun: (id: string, args?: Record<string, unknown>) => Promise<{ ok: boolean; result?: string; error?: string }>
  ttsProbe: () => Promise<{ ok: boolean; error?: string }>
  /** 选参考音频并写回配置 */
  ttsPickRef: () => Promise<ConfigInfo>
  ttsCacheStats: () => Promise<{ count: number; bytes: number }>
  indexttsStatus: () => Promise<{ ok: boolean; message: string; paths?: { installDir: string; python: string; repo: string; runner: string; modelDir: string } }>
  indexttsSttStatus: (modelDir: string) => Promise<{ ok: boolean; message: string }>
  indexttsPickRef: () => Promise<import('../../shared/types').ConfigInfo>
  ttsCacheClear: () => Promise<void>
  ttsCacheDeleteText: (text: string) => Promise<void>
  /** 导出文本到用户选择的位置（F6）：返回保存路径或取消 */
  saveTextFile: (payload: {
    defaultName: string
    content: string
    ext?: string
  }) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** E5 定时提醒 */
  remindersList: () => Promise<Reminder[]>
  remindersSave: (r: Partial<Reminder>) => Promise<Reminder[]>
  remindersDelete: (id: string) => Promise<Reminder[]>
  remindersToggle: (id: string, enabled: boolean) => Promise<Reminder[]>
  onReminderFired: (cb: (r: Reminder) => void) => () => void
  /** E3 取拖入文件的真实路径（沙箱下 File 对象不含 path） */
  pathForFile: (file: File) => string
  /** E3 按路径读取文本文件 */
  readTextByPath: (path: string) => Promise<{
    ok: boolean
    name?: string
    path?: string
    content?: string
    size?: number
    error?: string
  }>
  /** E1 工作区文件（只读） */
  workspaceRoot: () => Promise<string>
  workspaceList: (rel?: string) => Promise<{
    ok: boolean
    path?: string
    entries?: Array<{ name: string; rel: string; isDir: boolean; size: number }>
    error?: string
  }>
  workspaceRead: (rel: string) => Promise<{
    ok: boolean
    text?: string
    truncated?: boolean
    notice?: string
    error?: string
  }>
  workspaceReveal: (rel: string) => Promise<{ ok: boolean; error?: string }>
  /** 记忆库（E0：Agent 记忆，仅本地 userData/memory.json） */
  memoryList: () => Promise<{
    ok: boolean
    entries?: Array<{ id: string; text: string; createdAt: number; updatedAt: number }>
    error?: string
  }>
  memoryAdd: (text: string) => Promise<{
    ok: boolean
    entries?: Array<{ id: string; text: string; createdAt: number; updatedAt: number }>
    error?: string
  }>
  memoryUpdate: (id: string, text: string) => Promise<{
    ok: boolean
    entries?: Array<{ id: string; text: string; createdAt: number; updatedAt: number }>
    error?: string
  }>
  memoryDelete: (id: string) => Promise<{
    ok: boolean
    entries?: Array<{ id: string; text: string; createdAt: number; updatedAt: number }>
    error?: string
  }>
  /** F1 主动关怀：返回 null 表示此刻不该开口（绝大多数情况） */
  proactiveDecide: (payload: {
    lastChatAt?: number
    emptySession: boolean
    profile?: ProfileFacts
  }) => Promise<ProactiveSuggestion | null>
  /** 记录「已经开口」，用于抑制规则 */
  proactiveSaid: (reason: ProactiveReason) => Promise<boolean>
  proactiveStatus: () => Promise<{ enabled: boolean; asked: boolean }>
  proactiveSetEnabled: (enabled: boolean) => Promise<{ enabled: boolean; asked: boolean }>
  proactiveResetSession: () => Promise<boolean>
  /** F4/F5/F8 系统集成：返回最新配置 */
  prefsTray: (enabled: boolean) => Promise<ConfigInfo>
  prefsAutoLaunch: (enabled: boolean) => Promise<ConfigInfo>
  /** 常规设置：关闭按钮行为（ask/tray/quit） */
  prefsCloseBehavior: (behavior: 'ask' | 'tray' | 'quit') => Promise<ConfigInfo>
  /** 常规设置：不再显示关闭确认 */
  prefsSkipCloseConfirm: (enabled: boolean) => Promise<ConfigInfo>
  prefsConfirmDangerous: (enabled: boolean) => Promise<ConfigInfo>
  prefsShortcut: (payload: { enabled?: boolean; accelerator?: string }) => Promise<ConfigInfo>
  /** 快捷键是否真的注册成功（被占用时为 false） */
  prefsShortcutStatus: () => Promise<{ accelerator: string; registered: boolean }>
  /** 任务批量操作 */
  tasksBulk: (ids: string[], action: 'done' | 'active' | 'cancelled' | 'delete', priority?: TaskPriority) => Promise<TaskItem[]>
  /** 清理所有已完成任务（已取消的保留） */
  tasksClearCompleted: () => Promise<TaskItem[]>
  /** 拖拽排序：按给定 id 顺序写入 sortOrder */
  tasksReorder: (ids: string[]) => Promise<TaskItem[]>
  getConfig: () => Promise<ConfigInfo>
  saveConfig: (cfg: Partial<LlmConfig>) => Promise<ConfigInfo>
  /** 用户画像与重要日期（C1/C4）：独立于 config 存储 */
  getProfile: () => Promise<UserProfile>
  saveProfile: (profile: Partial<UserProfile>) => Promise<UserProfile>
  testConfig: (cfg: Partial<LlmConfig>) => Promise<TestConnectionResult>
  listModels: (cfg: Partial<LlmConfig>) => Promise<ModelListResult>
  getToolCatalog: () => Promise<ToolCatalogEntry[]>
  getToolOverrides: () => Promise<Record<string, Record<ToolMode, boolean>>>
  setToolOverride: (toolId: string, mode: ToolMode, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  setChatToolsEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  /** 终端：真执行（主进程 child_process.spawn），输出流式回流 */
  terminalRun: (id: string, command: string, cwd?: string) => Promise<TerminalRunResult>
  terminalKill: (id: string) => Promise<{ ok: boolean }>
  /** 订阅终端输出分片，返回取消订阅函数 */
  onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void
  /** 订阅终端结束事件，返回取消订阅函数 */
  onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void
  /** 内置浏览器：把 <webview> 的 guest id 登记给主进程（Agent 的 browser_* 工具据此操作同一实例） */
  browserBind: (guestId: number) => Promise<BrowserBindResult>
  /** 解除内置浏览器绑定（面板卸载 / 切走时调用） */
  browserUnbind: () => Promise<{ ok: boolean }>
  /** guest webContents 挂上时回调，返回取消订阅函数 */
  onWebviewAttached: (callback: () => void) => () => void
  /** 主进程请求拉起内置浏览器（Agent 调 browser_open 且无可用实例时）：回调收到目标网址，返回取消订阅函数 */
  onBrowserEnsure: (callback: (url: string) => void) => () => void
  /** 右键链接选择「在新标签页打开」：回调收到链接地址，返回取消订阅函数 */
  onOpenTab: (callback: (url: string) => void) => () => void
  /** 右键链接「复制链接地址」已完成，返回取消订阅函数 */
  onLinkCopied: (callback: (url: string) => void) => () => void
  /** Agent 调用 browser_close 后回调，返回取消订阅函数 */
  onBrowserAgentClosed: (callback: () => void) => () => void
  /** Agent 操作了同一个 webview 后回调（面板显示「Agent 刚做了什么」），返回取消订阅函数 */
  onBrowserAgentActivity: (callback: (event: BrowserAgentActivity) => void) => () => void
  /** 窗口控制（自绘标题栏用；配合主进程 titleBarStyle: 'hidden'） */
  windowMinimize: () => Promise<{ ok: boolean }>
  windowToggleMaximize: () => Promise<{ ok: boolean; maximized?: boolean }>
  windowClose: () => Promise<{ ok: boolean }>
  windowIsMaximized: () => Promise<boolean>
  /** 订阅工具调用实时事件，返回取消订阅函数 */
  onToolEvent: (callback: (event: ToolCallEvent) => void) => () => void
  /** 订阅高危操作确认请求（agent 要执行危险动作，等待用户允许/拒绝） */
  onToolConfirm: (callback: (req: ToolConfirmRequest) => void) => () => void
  /** 回应高危操作确认：allow=true 允许执行，false 拒绝 */
  toolConfirmResolve: (id: string, allow: boolean) => Promise<{ ok: boolean }>
  /** 订阅 agent 提问请求（等待用户回答） */
  onToolAsk: (callback: (req: ToolAskRequest) => void) => () => void
  /** 回应 agent 提问：提交用户回答 */
  toolAskResolve: (id: string, answer: string) => Promise<{ ok: boolean }>
}

declare global {
  interface Window {
    shorekeeper: ShorekeeperApi
  }
}

export {}
