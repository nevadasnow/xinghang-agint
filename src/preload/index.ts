import { clipboard, contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  BROWSER_AGENT_ACTIVITY_EVENT,
  BROWSER_AGENT_CLOSED_EVENT,
  BROWSER_ENSURE_EVENT,
  BROWSER_LINK_COPIED_EVENT,
  BROWSER_OPEN_TAB_EVENT,
  CHAT_STREAM_CHANNEL,
  CHAT_TOOL_ASK_CHANNEL,
  CHAT_TOOL_CONFIRM_CHANNEL,
  CHAT_TOOL_EVENT_CHANNEL,
  TERMINAL_DATA_CHANNEL,
  TERMINAL_EXIT_CHANNEL,
  WEBVIEW_ATTACHED_EVENT
} from '../shared/events'
import type {
  BrowserAgentActivity,
  BrowserBindResult,
  ChatStreamEvent,
  ToolAskRequest,
  ToolCallEvent,
  ToolConfirmRequest,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalRunResult
} from '../shared/events'
import type { MusicTrack, PersistedUserProfile, PickTextFileResult, TaskItem } from '../shared/types'
import type { Group } from '../shared/types'

const api = {
  sendChat: (messages: unknown, mode: string, sessionId?: string, profile?: unknown, agentRole?: string, permLevel?: number) =>
    ipcRenderer.invoke('chat:send', { messages, mode, sessionId, profile, agentRole, permLevel }),
  /** 复制文本到系统剪贴板（渲染层 navigator.clipboard 在 file:// 下受限，走主进程最稳） */
  copyText: (text: string) => clipboard.writeText(String(text ?? '')),
  /** 停止当前正在进行的回复（主进程 abort 流，保留已生成内容） */
  stopChat: () => ipcRenderer.send('chat:stop'),
  /**
   * 订阅对话流式输出（思考 / 正文增量 / 结束 / 出错 / 被停止）。
   * 返回取消订阅函数；增量文本由渲染层自行累积拼接。
   */
  onChatStream: (callback: (event: ChatStreamEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: ChatStreamEvent): void => callback(payload)
    ipcRenderer.on(CHAT_STREAM_CHANNEL, listener)
    return () => ipcRenderer.removeListener(CHAT_STREAM_CHANNEL, listener)
  },
  /** 弹系统文件选择框，读取一个文本文件的内容（仅支持文本，512KB 以内） */
  pickTextFile: (): Promise<PickTextFileResult> => ipcRenderer.invoke('file:pickText'),
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  saveSession: (session: unknown) => ipcRenderer.invoke('sessions:save', session),
  deleteSession: (id: string) => ipcRenderer.invoke('sessions:delete', id),
  renameSession: (id: string, title: string) => ipcRenderer.invoke('sessions:rename', { id, title }),
  patchSession: (id: string, patch: { pinned?: boolean; projectId?: string; groupId?: string }) =>
    ipcRenderer.invoke('sessions:patch', { id, patch }),
  // 项目与分组
  listProjects: () => ipcRenderer.invoke('projects:list'),
  listGroups: () => ipcRenderer.invoke('groups:list'),
  saveProject: (project: unknown) => ipcRenderer.invoke('projects:save', project),
  saveGroup: (group: unknown) => ipcRenderer.invoke('groups:save', group),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  deleteGroup: (id: string) => ipcRenderer.invoke('groups:delete', id),
  renameGroup: (id: string, name: string) => ipcRenderer.invoke('groups:rename', { id, name }),
  patchGroup: (id: string, patch: Partial<Pick<Group, 'name' | 'color' | 'pinned'>>) =>
    ipcRenderer.invoke('groups:patch', { id, patch }),
  reorderGroups: (ids: string[]) => ipcRenderer.invoke('groups:reorder', ids),
  assignSession: (sessionId: string, patch: { projectId?: string; groupId?: string }) =>
    ipcRenderer.invoke('sessions:assign', { sessionId, ...patch }),
  /** 用户画像权威存储：主进程 data.json 读写（localStorage 只作渲染层缓存） */
  getUserProfile: (): Promise<PersistedUserProfile | null> => ipcRenderer.invoke('user:getProfile'),
  saveUserProfile: (profile: PersistedUserProfile): Promise<PersistedUserProfile> =>
    ipcRenderer.invoke('user:setProfile', profile),
  /** 任务（D6）：与任务页 + Agent 工具共用 data.json */
  listTasks: (): Promise<TaskItem[]> => ipcRenderer.invoke('tasks:list'),
  saveTask: (task: Partial<TaskItem> & { title: string }): Promise<TaskItem[]> =>
    ipcRenderer.invoke('tasks:save', task),
  patchTask: (id: string, patch: Partial<Pick<TaskItem, 'title' | 'note' | 'priority' | 'status' | 'dueAt' | 'tag'>>): Promise<TaskItem[]> =>
    ipcRenderer.invoke('tasks:patch', { id, patch }),
  deleteTask: (id: string): Promise<TaskItem[]> => ipcRenderer.invoke('tasks:delete', id),
  /** 任务有变更（agent 工具改过 / 主进程推送）时回调，任务页实时刷新 */
  onTasksChanged: (cb: () => void): (() => void) => {
    const h = (): void => cb()
    ipcRenderer.on('tasks:changed', h)
    return () => ipcRenderer.removeListener('tasks:changed', h)
  },
  /** 本地语音合成（D1）：把文本交给本机 GPT-SoVITS，返回 data URL 音频；force=true 跳过缓存强制重新合成 */
  /** 界面直连执行只读/打开类工具（自检/系统信息/打开路径/读文件等白名单） */
  toolsRun: (id: string, args?: Record<string, unknown>) => ipcRenderer.invoke('tools:run', { id, args }),
  ttsSpeak: (text: string, dayPart?: string, force?: boolean) => ipcRenderer.invoke('tts:speak', { text, dayPart, force }),
  ttsProbe: () => ipcRenderer.invoke('tts:probe'),
  /** 选参考音频并写回配置，返回最新配置 */
  ttsPickRef: () => ipcRenderer.invoke('tts:pickRef'),
  ttsCacheStats: () => ipcRenderer.invoke('tts:cacheStats'),
  ttsCacheClear: () => ipcRenderer.invoke('tts:cacheClear'),
  /** 删除与文本对应的语音缓存（重新生成前调用） */
  ttsCacheDeleteText: (text: string) => ipcRenderer.invoke('tts:cacheDeleteText', { text }),
  /** IndexTTS 本地引擎：就绪检测 */
  indexttsStatus: () => ipcRenderer.invoke('indextts:status'),
  /** IndexTTS STT（语音识别）：faster-whisper 模型目录检测 */
  indexttsSttStatus: (modelDir: string) => ipcRenderer.invoke('indextts:sttStatus', modelDir),
  /** 选 IndexTTS 参考音频并写回配置，返回最新配置 */
  indexttsPickRef: () => ipcRenderer.invoke('indextts:pickRef'),
  /** 导出文本到用户选择的位置（F6）：纯本地写盘 */
  saveTextFile: (payload: { defaultName: string; content: string; ext?: string }) =>
    ipcRenderer.invoke('file:saveText', payload),
  /**
   * E3 取拖入文件的真实路径。
   * 沙箱渲染层拿不到 File.path，必须用 Electron 的 webUtils；
   * 放在 preload 是因为渲染层不允许直接引 electron 模块。
   */
  pathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  /** E3 按路径读取文本文件（与「选择文件」同一套校验） */
  readTextByPath: (path: string) => ipcRenderer.invoke('file:readTextByPath', { path }),
  /** E1 工作区文件（只读） */
  workspaceRoot: () => ipcRenderer.invoke('workspace:root'),
  workspaceList: (rel?: string) => ipcRenderer.invoke('workspace:list', rel),
  workspaceRead: (rel: string) => ipcRenderer.invoke('workspace:read', rel),
  workspaceReveal: (rel: string) => ipcRenderer.invoke('workspace:reveal', rel),
  /** 记忆库（仅本地 userData/memory.json） */
  memoryList: () => ipcRenderer.invoke('memory:list'),
  memoryAdd: (text: string) => ipcRenderer.invoke('memory:add', text),
  memoryUpdate: (id: string, text: string) => ipcRenderer.invoke('memory:update', id, text),
  memoryDelete: (id: string) => ipcRenderer.invoke('memory:delete', id),
  /** RAG 资料库：上传文件入库（本地检索用，不再每次对话全量携带） */
  ragSaveDoc: (name: string, content: string) => ipcRenderer.invoke('rag:saveDoc', name, content),
  ragListDocs: () => ipcRenderer.invoke('rag:listDocs'),
  ragRemoveDoc: (name: string) => ipcRenderer.invoke('rag:removeDoc', name),
  /** E5 定时提醒（设置弹窗打开时会立即调用 remindersList，缺一个都会让设置崩掉） */
  remindersList: () => ipcRenderer.invoke('reminders:list'),
  remindersSave: (r: unknown) => ipcRenderer.invoke('reminders:save', r),
  remindersDelete: (id: string) => ipcRenderer.invoke('reminders:delete', id),
  remindersToggle: (id: string, enabled: boolean) => ipcRenderer.invoke('reminders:toggle', { id, enabled }),
  /** 订阅提醒触发；返回取消订阅函数 */
  onReminderFired: (cb: (r: unknown) => void) => {
    const h = (_e: unknown, r: unknown): void => cb(r)
    ipcRenderer.on('reminders:fired', h)
    return () => ipcRenderer.removeListener('reminders:fired', h)
  },
  /** F1 主动关怀（全本地判断，0 token） */
  proactiveDecide: (payload: unknown) => ipcRenderer.invoke('proactive:decide', payload),
  proactiveSaid: (reason: string) => ipcRenderer.invoke('proactive:said', reason),
  proactiveStatus: () => ipcRenderer.invoke('proactive:status'),
  proactiveSetEnabled: (enabled: boolean) => ipcRenderer.invoke('proactive:setEnabled', enabled),
  proactiveResetSession: () => ipcRenderer.invoke('proactive:resetSession'),
  /** F4/F5/F8 系统集成 */
  prefsTray: (enabled: boolean) => ipcRenderer.invoke('prefs:tray', enabled),
  prefsAutoLaunch: (enabled: boolean) => ipcRenderer.invoke('prefs:autoLaunch', enabled),
  /** 常规设置：关闭按钮行为（ask/tray/quit） */
  prefsCloseBehavior: (behavior: 'ask' | 'tray' | 'quit') => ipcRenderer.invoke('prefs:closeBehavior', behavior),
  /** 常规设置：不再显示关闭确认 */
  prefsSkipCloseConfirm: (enabled: boolean) => ipcRenderer.invoke('prefs:skipCloseConfirm', enabled),
  prefsConfirmDangerous: (enabled: boolean) => ipcRenderer.invoke('prefs:confirmDangerous', enabled),
  prefsShortcut: (payload: { enabled?: boolean; accelerator?: string }) =>
    ipcRenderer.invoke('prefs:shortcut', payload),
  prefsShortcutStatus: () => ipcRenderer.invoke('prefs:shortcutStatus'),
  /** 任务批量操作（一次 IPC 完成多条，避免循环调用） */
  tasksBulk: (ids: string[], action: string, priority?: string) =>
    ipcRenderer.invoke('tasks:bulk', { ids, action, priority }),
  /** 清理所有已完成任务（已取消的保留） */
  tasksClearCompleted: () => ipcRenderer.invoke('tasks:clearCompleted'),
  /** 拖拽排序：按给定 id 顺序写入 sortOrder */
  tasksReorder: (ids: string[]) => ipcRenderer.invoke('tasks:reorder', ids),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (cfg: unknown) => ipcRenderer.invoke('config:save', cfg),
  testConfig: (cfg: unknown) => ipcRenderer.invoke('config:test', cfg),
  listModels: (cfg: unknown) => ipcRenderer.invoke('config:listModels', cfg),
  // Token 用量统计（仅本地；返回全机累计与按模型明细）
  getUsage: () => ipcRenderer.invoke('usage:get'),
  resetUsage: () => ipcRenderer.invoke('usage:reset'),
  // 工具开关（参照 Shorekeeper window.settings 的 getTools/setToolModeOverride）
  getToolCatalog: () => ipcRenderer.invoke('tools:getCatalog'),
  getToolOverrides: () => ipcRenderer.invoke('tools:getOverrides'),
  setToolOverride: (toolId: string, mode: string, enabled: boolean) =>
    ipcRenderer.invoke('tools:setOverride', { toolId, mode, enabled }),
  setChatToolsEnabled: (enabled: boolean) => ipcRenderer.invoke('tools:setChatToolsEnabled', enabled),
  // ---------- 终端（规格 5 三） ----------
  /** 启动一条命令；输出通过 onTerminalData 流式回流 */
  terminalRun: (id: string, command: string, cwd?: string): Promise<TerminalRunResult> =>
    ipcRenderer.invoke('terminal:run', { id, command, cwd }),
  /** 终止指定命令的整棵进程树 */
  terminalKill: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('terminal:kill', id),
  /** 订阅终端输出分片。返回取消订阅函数（写法与 onToolEvent 一致） */
  onTerminalData: (callback: (event: TerminalDataEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: TerminalDataEvent): void => callback(payload)
    ipcRenderer.on(TERMINAL_DATA_CHANNEL, listener)
    return () => ipcRenderer.removeListener(TERMINAL_DATA_CHANNEL, listener)
  },
  /** 订阅终端结束事件。返回取消订阅函数 */
  onTerminalExit: (callback: (event: TerminalExitEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: TerminalExitEvent): void => callback(payload)
    ipcRenderer.on(TERMINAL_EXIT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(TERMINAL_EXIT_CHANNEL, listener)
  },
  // ---------- 内置浏览器 ↔ Agent 工具的绑定（规格 5 · 八） ----------
  /**
   * 把面板里 <webview> 的 guest id 登记给主进程。
   * 主进程据此用 webContents.fromId() 拿到同一个被控页面，
   * 于是 browser_* 工具操作的就是用户眼前这一个实例。
   */
  browserBind: (guestId: number): Promise<BrowserBindResult> => ipcRenderer.invoke('browser:bind', guestId),
  /** 面板卸载 / 切走时解除绑定 */
  browserUnbind: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('browser:unbind'),
  /** guest webContents 挂上时回调（此时 getWebContentsId 才有效） */
  onWebviewAttached: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(WEBVIEW_ATTACHED_EVENT, listener)
    return () => ipcRenderer.removeListener(WEBVIEW_ATTACHED_EVENT, listener)
  },
  /**
   * 主进程请求渲染层「把内置浏览器拉起来」：Agent 调 browser_open 时若还没有可操作实例，
   * 渲染层据此打开右侧面板 + 浏览器 tab，并建一个指向该网址的标签页。
   * 返回取消订阅函数。
   */
  onBrowserEnsure: (callback: (url: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { url?: string }): void =>
      callback(String(payload?.url ?? ''))
    ipcRenderer.on(BROWSER_ENSURE_EVENT, listener)
    return () => ipcRenderer.removeListener(BROWSER_ENSURE_EVENT, listener)
  },
  /** 右键链接选择「在新标签页打开」：回调收到链接地址 */
  onOpenTab: (callback: (url: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, url: string): void => callback(String(url ?? ''))
    ipcRenderer.on(BROWSER_OPEN_TAB_EVENT, listener)
    return () => ipcRenderer.removeListener(BROWSER_OPEN_TAB_EVENT, listener)
  },
  /** 右键链接「复制链接地址」已完成 */
  onLinkCopied: (callback: (url: string) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, url: string): void => callback(String(url ?? ''))
    ipcRenderer.on(BROWSER_LINK_COPIED_EVENT, listener)
    return () => ipcRenderer.removeListener(BROWSER_LINK_COPIED_EVENT, listener)
  },
  /** 背景音乐曲库：扫描 工程根/背景音乐 目录，返回曲目列表 */
  listMusic: (): Promise<MusicTrack[]> => ipcRenderer.invoke('music:list'),
  /** 订阅音乐全局快捷键（Ctrl+Shift+→ 下一首 / ← 上一首 / 空格 播放暂停）。返回取消订阅函数 */
  onMusicKey: (callback: (cmd: 'next' | 'prev' | 'toggle') => void): (() => void) => {
    const listener = (_e: unknown, cmd: string): void => callback(cmd as 'next' | 'prev' | 'toggle')
    ipcRenderer.on('sk:music-key', listener)
    return () => ipcRenderer.removeListener('sk:music-key', listener)
  },
  /** 关闭确认弹窗：主进程要求选择「最小化到托盘 / 直接退出 / 取消」时回调 */
  onCloseAsk: (callback: (payload: { canTray: boolean; roleName: string }) => void): (() => void) => {
    const listener = (_e: unknown, payload: { canTray: boolean; roleName: string }): void => callback(payload)
    ipcRenderer.on('app:close-ask', listener)
    return () => ipcRenderer.removeListener('app:close-ask', listener)
  },
  /** 关闭确认弹窗的选择：tray / quit / cancel */
  closeChoose: (action: 'tray' | 'quit' | 'cancel') => ipcRenderer.invoke('app:close-choose', action),
  assetsList: () => ipcRenderer.invoke('assets:list'),
  assetsImport: () => ipcRenderer.invoke('assets:import'),
  assetsPickCustom: () => ipcRenderer.invoke('assets:pickCustom'),
  assetsOpenDir: () => ipcRenderer.invoke('assets:openDir'),
  openMusicDir: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('music:openDir'),
  /** 导入歌曲：文件选择并复制进曲库目录 */
  importMusic: (): Promise<{ ok: boolean; canceled?: boolean; added?: string[]; error?: string }> =>
    ipcRenderer.invoke('music:import'),
  /** Agent 调用 browser_close 后回调：面板回到空态并解绑 */
  onBrowserAgentClosed: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(BROWSER_AGENT_CLOSED_EVENT, listener)
    return () => ipcRenderer.removeListener(BROWSER_AGENT_CLOSED_EVENT, listener)
  },
  /** Agent 操作了同一个 webview 后回调（面板显示一行反馈） */
  onBrowserAgentActivity: (callback: (event: BrowserAgentActivity) => void): (() => void) => {
    const listener = (_e: unknown, payload: BrowserAgentActivity): void => callback(payload)
    ipcRenderer.on(BROWSER_AGENT_ACTIVITY_EVENT, listener)
    return () => ipcRenderer.removeListener(BROWSER_AGENT_ACTIVITY_EVENT, listener)
  },
  // 窗口控制（自绘标题栏用；配合主进程 titleBarStyle: 'hidden'）
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowToggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  /**
   * 订阅工具调用实时事件。返回取消订阅函数。
   * 只透传事件对象本身，不把 ipcRenderer 暴露给渲染层。
   */
  onToolEvent: (callback: (event: ToolCallEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: ToolCallEvent): void => callback(payload)
    ipcRenderer.on(CHAT_TOOL_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(CHAT_TOOL_EVENT_CHANNEL, listener)
  },
  /** 订阅高危操作确认请求（agent 要执行危险动作，等待用户允许/拒绝） */
  onToolConfirm: (callback: (req: ToolConfirmRequest) => void): (() => void) => {
    const listener = (_e: unknown, payload: ToolConfirmRequest): void => callback(payload)
    ipcRenderer.on(CHAT_TOOL_CONFIRM_CHANNEL, listener)
    return () => ipcRenderer.removeListener(CHAT_TOOL_CONFIRM_CHANNEL, listener)
  },
  /** 回应高危操作确认：allow=true 允许执行，false 拒绝 */
  toolConfirmResolve: (id: string, allow: boolean) => ipcRenderer.invoke('chat:toolConfirmResolve', { id, allow }),
  /** 订阅 agent 提问请求（等待用户回答） */
  onToolAsk: (callback: (req: ToolAskRequest) => void): (() => void) => {
    const listener = (_e: unknown, payload: ToolAskRequest): void => callback(payload)
    ipcRenderer.on(CHAT_TOOL_ASK_CHANNEL, listener)
    return () => ipcRenderer.removeListener(CHAT_TOOL_ASK_CHANNEL, listener)
  },
  /** 回应 agent 提问：提交用户回答 */
  toolAskResolve: (id: string, answer: string) => ipcRenderer.invoke('chat:toolAskResolve', { id, answer })
}

contextBridge.exposeInMainWorld('shorekeeper', api)

export type ShorekeeperApi = typeof api
