import type { ToolCallTrace } from './tool-trace'

export type { ToolCallTrace, ToolCallState } from './tool-trace'
export { CHAT_TOOL_EVENT_CHANNEL } from './events'
export type { ToolCallEvent } from './events'

export type AgentMode = 'chat' | 'code' | 'work'

/** 工具生效模式（与 Shorekeeper 枚举一致；learn 为学习模式，守岸人暂未开放对话入口，但保留开关与过滤语义） */
export type ToolMode = 'chat' | 'code' | 'work' | 'learn'

export interface ModeMeta {
  label: string
  icon: string
  desc: string
}

/* ---------- 用户画像与重要日期（C1 / C4） ---------- */

export interface ImportantDate {
  id: string
  /** 名称，如「生日」「纪念日」「项目截止」 */
  label: string
  /** M-D（每年重复）或 YYYY-M-D（一次性） */
  date: string
  /** 是否每年重复 */
  yearly: boolean
}

export interface UserProfile {
  /** 用户希望被怎么称呼；留空则不用称呼 */
  name: string
  /** 关于用户的事实，每条一句 */
  facts: string[]
  /** 重要日期 */
  dates: ImportantDate[]
  /** 是否启用画像注入（关掉就不进 prompt，省 token） */
  enabled: boolean
}

/**
 * 用户画像的持久化形态（权威存储在 data.json 的 userProfile 字段）。
 * 渲染层原本只放 localStorage，重启/清理后易丢；这里与会话同文件落盘，
 * localStorage 仅作启动缓存。avatar 为 dataURL，可能较大，仅本机保存。
 */
export interface PersistedUserProfile {
  name: string
  bio: string
  /** 自定义头像 dataURL；空串表示默认头像 */
  avatar: string
  /** 关于用户的事实，每条一句（C1）；为空时不占 token */
  facts: string[]
  /** 重要日期（C4） */
  dates: ImportantDate[]
  /** 是否把画像注入对话 */
  profileEnabled: boolean
}

/**
 * 渲染层随每条消息交给主进程的画像（C1/C4）。
 *
 * 权威来源是渲染层 localStorage 里的 UserProfile（含 name/bio/avatar），
 * 这里只带主进程渲染 prompt 需要的那几项——不带 avatar（dataURL 可能很大）。
 */
export interface ProfileFacts {
  name?: string
  /** 用户自述（来自 UserProfile.bio） */
  bio?: string
  facts?: string[]
  dates?: ImportantDate[]
  /** 关掉后不注入画像，省 token */
  enabled?: boolean
}

/* ---------- F1 主动关怀 ---------- */

export type ProactiveReason =
  | 'latenight'
  | 'long-absence'
  | 'long-session'
  | 'upcoming-date'
  | 'festival'

/**
 * 一条「她可以先开口」的建议。
 *
 * 注意：主动开口的内容**不写进 session 历史** —— 它是环境行为，不是对话内容。
 * 写进去会在下次回放时污染上下文。
 */
export interface ProactiveSuggestion {
  reason: ProactiveReason
  /** 给 UI 显示的触发原因（如「现在是深夜」「距上次对话 3 天」） */
  label: string
  /** 建议的开口文案；渲染层可直接展示，也可据此微调 */
  text: string
}

/* ---------- E5 定时提醒 ---------- */

export interface Reminder {
  id: string
  /** 提醒内容 */
  text: string
  /** 触发时间戳（毫秒）；repeat='daily' 时只取其中的「时刻」 */
  at: number
  /** once=只响一次；daily=每天同一时刻 */
  repeat: 'once' | 'daily'
  enabled: boolean
  /** 上次触发时间，用于避免重复触发 */
  lastFiredAt?: number
}

export interface ProfileFacts {
  name?: string
  /** 用户自述（来自 UserProfile.bio） */
  bio?: string
  facts?: string[]
  dates?: ImportantDate[]
  /** 关掉后不注入画像，省 token */
  enabled?: boolean
}

export const MODE_META: Record<AgentMode, ModeMeta> = {
  chat: { label: '聊天', icon: '◈', desc: '陪伴与对话' },
  code: { label: '代码', icon: '</>', desc: '编程助手' },
  work: { label: '工作', icon: '▤', desc: '办公助手' }
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  /** 模型返回的 tool_calls 原文（回放对话时必须原样带回，否则接口会拒绝） */
  tool_calls?: unknown
  /** tool 角色消息对应的调用 id */
  tool_call_id?: string
  /** 该条 assistant 消息期间发生过的工具调用（仅用于 UI 留痕，不参与回放） */
  toolCalls?: ToolCallTrace[]
  /** 思考过程（qwen3/DeepSeek-R1 等模型的 reasoning_content；仅展示，不回传模型） */
  reasoning?: string
  /** 用户消息附带的文件元数据（仅名称与大小；正文已拼进 content） */
  attachments?: Array<{ name: string; size?: number }>
  /** 消息发送时间（毫秒时间戳；历史消息可能缺失） */
  createdAt?: number
}

/** file:pickText 的返回：选中并读回文本 / 取消 / 失败 */
export type PickTextFileResult =
  | { ok: true; name: string; path: string; content: string; size: number }
  | { ok: false; canceled?: boolean; error?: string }

/* ---------- 任务（任务页 + Agent 联动共用） ---------- */

export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'active' | 'done' | 'cancelled'

export interface TaskItem {
  id: string
  title: string
  /** 补充说明（可选） */
  note?: string
  priority: TaskPriority
  status: TaskStatus
  /** 截止时间戳（毫秒；可选，没有则为无期限任务） */
  dueAt?: number
  /** 标签（可选，如「学习」「工作」） */
  tag?: string
  /** 来源：manual=用户在任务页创建；agent=由 agent 工具创建 */
  source: 'manual' | 'agent'
  createdAt: number
  updatedAt: number
  completedAt?: number
  /**
   * 手动排序位置（拖拽排序写入）。
   * 为 undefined 表示"没被手动排过"，前端回落到默认排序（截止时间 → 优先级）。
   */
  sortOrder?: number
}

export interface Session {
  id: string
  title: string
  mode: AgentMode
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  /** 所属项目 id；空表示「未分类项目」 */
  projectId?: string
  /** 所属分组 id；空表示未分组 */
  groupId?: string
  /** 置顶会话（显示在侧栏「置顶」区） */
  pinned?: boolean
  /** 创建该会话时的人设角色（守岸人 / 莫宁）。存档内的消息头像/名字固定用这个角色，
   *  用其它角色打开该存档时先拦截并提示分叉。无此字段 = 历史存档（不拦截）。 */
  agentRole?: string
  /** 当前对话的 Token 用量（轮数/步数/tokens/缓存/速度；仅本地，随会话保存） */
  tokenUsage?: SessionTokenUsage
}

/** 项目：会话的顶层归类 */
export interface Project {
  id: string
  name: string
  createdAt: number
}

/** 分组：项目内的二级归类（也可独立于项目使用） */
export interface Group {
  id: string
  name: string
  createdAt: number
  /** 分组色点（#RRGGBB；参照 Cyrene group.color） */
  color?: string
  /** 置顶分组（参照 Cyrene project.pinned，固定在侧栏最上方） */
  pinned?: boolean
}

/** 厂商预设（参照 Shorekeeper vendor-registry 的注册表结构） */
export interface VendorPreset {
  id: string
  name: string
  baseURL: string
  models: string[]
  defaultModel: string
  note: string
}

/** 已保存的模型配置档案（参照 Shorekeeper modelProfiles） */
export interface ModelProfile {
  id: string
  name: string
  provider: string
  baseURL: string
  apiKey: string
  model: string
  createdAt: number
}

export interface LlmConfig {
  baseURL: string
  apiKey: string
  model: string
  provider: string
  displayName: string
  profiles: ModelProfile[]
  defaultProfileId: string
  timeoutSec: number
  maxRetries: number
  contextWindowTokens: number
  schemaVersion: number
  /** 工具按模式显式开关：toolModeOverrides[toolId][mode] = true|false（参照 Shorekeeper 的 override 语义） */
  toolModeOverrides: Record<string, Record<ToolMode, boolean>>
  /** chat 模式总开关：开启后启用 chat 内置工具集（参照 Shorekeeper chatToolsEnabled） */
  chatToolsEnabled: boolean
  /** 技能按模式显式开关（Shorekeeper 同款字段，守岸人预留） */
  skillModeOverrides: Record<string, Record<ToolMode, boolean>>
  /** 自动朗读开关（标题栏胶囊切换并持久化） */
  autoRead: boolean
  /** TTS 接口地址（GPT-SoVITS api_v2 默认 http://127.0.0.1:9880） */
  ttsURL: string
  /** 参考音频路径（GPT-SoVITS 必填：音色来自这段音频） */
  ttsRefAudio: string
  /** 参考音频对应文本（prompt_text，建议填；填错会明显影响音质） */
  ttsPromptText: string
  /** 语音合成引擎：local=本地 GPT-SoVITS；mimo=小米 MiMo 云端 TTS */
  ttsProvider: 'local' | 'mimo' | 'indextts'
  /** 小米 MiMo API Key（enc 加密存储） */
  mimoTTSKey: string
  /** 小米 MiMo 模型：mimo-v2.5-tts（预置音色）/ mimo-v2.5-tts-voiceclone（音色克隆） */
  mimoTTSModel: string
  /** 小米 MiMo 预置音色 ID（mimo-v2.5-tts 用） */
  mimoTTSVoice: string
  /** 小米 MiMo API 地址 */
  mimoTTSBaseURL: string
  /** 小米 MiMo 语气描述（风格指令，作为 user 消息传给 MiMo） */
  mimoStylePrompt: string
  /** IndexTTS 本地引擎：参考音频路径（决定克隆音色） */
  indexttsRefAudio: string
  /** IndexTTS：true=使用角色参考音频（切换角色自动应用）；false=使用下方自定义参考音频 */
  indexttsUseRoleRef: boolean
  /** IndexTTS 运行设备：cuda=NVIDIA GPU（推荐）；cpu=CPU（速度很慢） */
  indexttsDevice: 'cuda' | 'cpu'
  /** IndexTTS 细节调整：语速（0.5–2.0x，默认 1.0） */
  indexttsSpeed: number
  /** IndexTTS 细节调整：音调（-50–50，默认 0；引擎 1.5 暂以播放层处理） */
  indexttsPitch: number
  /** IndexTTS 细节调整：音量（0–100，默认 100） */
  indexttsVolume: number
  /** STT 语音识别：启用麦克风输入 */
  indexttsSTTEnabled: boolean
  /** STT：faster-whisper 本地模型目录 */
  indexttsSTTModelDir: string

  /** F4：关闭窗口时隐藏到托盘而不退出 */
  trayEnabled: boolean
  /** 常规设置：点关闭按钮的行为（ask=每次询问 / tray=最小化到托盘 / quit=直接退出） */
  closeBehavior: 'ask' | 'tray' | 'quit'
  /** 常规设置：勾选后不再弹关闭确认框，直接按 closeBehavior 执行 */
  skipCloseConfirm: boolean
  /** 常规设置：agent 执行高危操作（命令/控制输入/外部副作用等）前，在聊天输入框上方请求用户确认 */
  confirmDangerousTools: boolean
  /** F8：开机自启 */
  autoLaunch: boolean
  /** F5：全局快捷键唤起窗口 */
  globalShortcutEnabled: boolean
  /** F5：全局快捷键唤起窗口 */
  globalShortcut: string
  /** 当前 Agent 角色：shorekeeper=守岸人 / mornye=莫宁 / kindmita=善良米塔 / silverwolf=银狼（决定主进程人设 soul） */
  agentRole: 'shorekeeper' | 'mornye' | 'kindmita' | 'silverwolf'
}

export interface ConfigInfo {
  configured: boolean
  baseURL: string
  apiKey: string
  model: string
  provider: string
  displayName: string
  profiles: ModelProfile[]
  defaultProfileId: string
  timeoutSec: number
  maxRetries: number
  contextWindowTokens: number
  toolModeOverrides: Record<string, Record<ToolMode, boolean>>
  chatToolsEnabled: boolean
  skillModeOverrides: Record<string, Record<ToolMode, boolean>>
  /** 自动朗读开关（与 LlmConfig.autoRead 同源，由主进程 toConfigInfo 透出） */
  autoRead: boolean
  /** 当前 Agent 角色（与 LlmConfig.agentRole 同源） */
  agentRole: 'shorekeeper' | 'mornye' | 'kindmita' | 'silverwolf'
  /** TTS 接口地址（GPT-SoVITS api_v2） */
  ttsURL: string
  /** 参考音频路径 */
  ttsRefAudio: string
  /** 参考音频对应文本 */
  ttsPromptText: string
  /** 语音合成引擎：local=本地 GPT-SoVITS；mimo=小米 MiMo 云端 TTS */
  ttsProvider: 'local' | 'mimo' | 'indextts'
  /** 小米 MiMo API Key（渲染层只拿掩码） */
  mimoTTSKey: string
  /** 小米 MiMo 模型 */
  mimoTTSModel: string
  /** 小米 MiMo 预置音色 ID */
  mimoTTSVoice: string
  /** 小米 MiMo API 地址 */
  mimoTTSBaseURL: string
  /** 小米 MiMo 语气描述（风格指令，作为 user 消息传给 MiMo） */
  mimoStylePrompt: string
  /** IndexTTS 本地引擎：参考音频路径（决定克隆音色） */
  indexttsRefAudio: string
  /** IndexTTS：true=使用角色参考音频（切换角色自动应用）；false=使用下方自定义参考音频 */
  indexttsUseRoleRef: boolean
  /** IndexTTS 运行设备：cuda=NVIDIA GPU（推荐）；cpu=CPU（速度很慢） */
  indexttsDevice: 'cuda' | 'cpu'
  /** IndexTTS 细节调整：语速（0.5–2.0x，默认 1.0） */
  indexttsSpeed: number
  /** IndexTTS 细节调整：音调（-50–50，默认 0；引擎 1.5 暂以播放层处理） */
  indexttsPitch: number
  /** IndexTTS 细节调整：音量（0–100，默认 100） */
  indexttsVolume: number
  /** STT 语音识别：启用麦克风输入 */
  indexttsSTTEnabled: boolean
  /** STT：faster-whisper 本地模型目录 */
  indexttsSTTModelDir: string

  /** F4：关闭窗口时隐藏到托盘而不退出 */
  trayEnabled: boolean
  /** 常规设置：点关闭按钮的行为 */
  closeBehavior: 'ask' | 'tray' | 'quit'
  /** 常规设置：勾选后不再弹关闭确认框 */
  skipCloseConfirm: boolean
  /** 常规设置：agent 执行高危操作前请求用户确认 */
  confirmDangerousTools: boolean
  /** F8：开机自启 */
  autoLaunch: boolean
  /** F5：全局快捷键开关 */
  globalShortcutEnabled: boolean
  /** F5：快捷键组合 */
  globalShortcut: string
}

/** 工具定义（参照 Shorekeeper tool-registry 的注册字段） */
export interface ToolDefinition {
  id: string
  name: string
  description: string
  enabled: boolean
  modes: ToolMode[]
  /** chat 模式内置工具：开启 chatToolsEnabled 后自动可用 */
  chatBuiltin?: boolean
  /** 需要文件附件（Shorekeeper 语义，守岸人暂按普通开关处理） */
  requiresFileAttachments?: boolean
  effectKind: 'read' | 'mutation' | 'verification' | 'external_side_effect' | 'unknown'
  risk: 'safe' | 'read' | 'fs-read' | 'fs-write' | 'shell' | 'network' | 'input-control' | 'external_side_effect'
  verificationPolicy?: 'none' | 'artifact' | 'bypass'
  deprecated?: boolean
  /** 占位能力：宿主未接入对应后端，不注册给模型（仅在设置里可见，标为未接入） */
  unavailable?: boolean
  /** 工具参数 JSON Schema（function calling 时传给模型；缺省用宽松 schema） */
  parameters?: Record<string, unknown>
  /** 工具执行体：守岸人可独立实现的直接可用；Shorekeeper 专属后端的返回占位说明 */
  execute: (args: Record<string, unknown>, ctx?: ToolExecContext) => Promise<string>
}

export interface ToolExecContext {
  config?: LlmConfig
  mode?: AgentMode
}

/** 工具目录条目（渲染层设置面板所需字段，参照 Shorekeeper SCHEDULER_GET_TOOLS/TOOL_GET_CATALOG） */
export interface ToolCatalogEntry {
  id: string
  name: string
  description: string
  enabled: boolean
  modes: ToolMode[] | null
  chatBuiltin: boolean
  deprecated: boolean
  /** 宿主未接入后端：设置里标「未接入」，且不会注册给模型 */
  unavailable?: boolean
  risk: string
}

export interface TestConnectionResult {
  ok: boolean
  latencyMs?: number
  error?: string
  model?: string
  provider?: string
}

export interface ModelListResult {
  ok: boolean
  latencyMs?: number
  error?: string
  models?: string[]
  count?: number
}

/** 背景音乐曲目（主进程扫描 工程根/背景音乐 目录） */
export interface MusicTrack {
  name: string
  url: string
  size: number
  /** 文件修改时间（毫秒时间戳，作为导入日期） */
  mtime: number
}

/* ============================================================
   Token 用量统计（仅本地保存）
   ============================================================ */

/** 模型 API 响应里的 usage 原始字段（兼容 OpenRouter / DashScope / DeepSeek 官方等常见命名） */
export interface TokenUsageRaw {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** 命中 prompt 缓存的 tokens（DeepSeek 官方 / OpenRouter 等渠道返回） */
  prompt_cache_hit_tokens?: number
  /** 未命中缓存的 tokens */
  prompt_cache_miss_tokens?: number
  /** OpenAI 新格式的缓存拆分（部分接口只返回 cached_tokens） */
  prompt_tokens_details?: {
    cached_tokens?: number
  }
}

/** 单个模型累计用量 */
export interface ModelUsageEntry {
  calls: number
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  lastAt: number
}

/** 单日用量（按本地日期 YYYY-MM-DD 分组，供每日/每周/每月/趋势聚合） */
export interface DailyUsage {
  calls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  byModel: Record<string, ModelUsageEntry>
}

/** 全机 Token 用量统计（数据仅保存在本地 userData/token-usage.json） */
export interface UsageStats {
  totalCalls: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  updatedAt: number
  byModel: Record<string, ModelUsageEntry>
  /** 按日明细（键为 YYYY-MM-DD）；旧版本数据可能缺失，读取时兜底 {} */
  daily?: Record<string, DailyUsage>
}

/** 单个会话的 Token 用量（随 Session 持久化，仅本地） */
export interface SessionTokenUsage {
  /** 轮数（用户每次发送算一轮） */
  rounds: number
  /** 步数（累计 LLM 调用次数，含工具循环里的多次调用） */
  steps: number
  /** 当前对话累计总 tokens（输入 + 输出） */
  totalTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  /** 最近一次调用输出速度（tokens/秒） */
  lastTokensPerSec: number
  /** 最近一次调用的输入 tokens（用于计算上下文占用） */
  lastPromptTokens: number
  /** 最近一次使用的时间 */
  lastAt: number
  byModel?: Record<string, { calls: number; tokens: number }>
}
