/**
 * 渲染进程与主进程共享的推送通道名（不 import electron / node 内置模块，两侧都能安全引用）。
 *
 * 注意：本文件同时被 tsconfig.web.json 收集（lib 为 DOM，无 @types/node），
 * 所以这里**不能出现** NodeJS.Timeout / Buffer / EventEmitter 之类的 Node 专有类型，
 * 定时器一律用 number 表达。
 */

import type { ToolCallTrace } from './tool-trace'
import type { TokenUsageRaw } from './types'

/** 主进程 → 渲染进程：工具调用过程的实时事件 */
export const CHAT_TOOL_EVENT_CHANNEL = 'chat:toolEvent'

/** 主进程 → 渲染进程：agent 请求执行高危操作，等待用户允许/拒绝 */
export const CHAT_TOOL_CONFIRM_CHANNEL = 'chat:toolConfirm'

/** 主进程 → 渲染进程：agent 向用户提出具体问题，等待用户回答 */
export const CHAT_TOOL_ASK_CHANNEL = 'chat:toolAsk'

/** 高危操作确认请求（渲染层在聊天输入框上方弹出） */
export interface ToolConfirmRequest {
  /** 本次确认的唯一 id，渲染层原样带回 */
  id: string
  toolId: string
  toolName: string
  /** 原始参数 JSON 文本 */
  args: string
  /** 可读的一行摘要（工具 + 关键参数），用于展示「目的」 */
  summary: string
}

/** agent 向用户提问的请求（渲染层在聊天输入框上方弹出） */
export interface ToolAskRequest {
  id: string
  question: string
  options?: string[]
}

/** 主进程 → 渲染进程：对话流式输出（思考 / 正文增量 / 结束 / 出错 / 被停止） */
export const CHAT_STREAM_CHANNEL = 'chat:stream'

/** 对话流式输出的事件（增量由渲染层自行累积拼接） */
export type ChatStreamEvent =
  | { type: 'reasoning'; round: number; text: string }
  | { type: 'delta'; round: number; text: string }
  | {
      /** 每次 API 调用完成后的用量（会话级 Token 统计条 / 持久化；被中止时可能缺失） */
      type: 'usage'
      round: number
      model: string
      usage: TokenUsageRaw
      /** 本次调用耗时（毫秒），用于计算 tok/s */
      durationMs: number
    }
  | {
      /** 本轮流式结束：携带最终完整文本、思考过程与工具留痕（stopped=true 表示用户手动停止） */
      type: 'done'
      round: number
      content: string
      reasoning?: string
      toolCalls: ToolCallTrace[]
      stopped: boolean
    }
  | { type: 'error'; round: number; message: string }

/** 主进程 → 渲染进程：终端输出的流式分片 */
export const TERMINAL_DATA_CHANNEL = 'terminal:data'

/** 终端输出流：stdout 与 stderr 分开，渲染层用不同颜色区分 */

/** 主进程 → 渲染进程：终端进程结束 */
export const TERMINAL_EXIT_CHANNEL = 'terminal:exit'

/**
 * 工具生命周期事件。
 *
 * 主进程每次 send 只送一条，渲染进程按 (id, round) 就地更新卡片状态。
 * - start：模型已决定调用，即将执行
 * - end：执行结束（state 区分 done / failed）
 */
export interface ToolCallEvent {
  /** 模型给出的调用 id，渲染层用它做「同一次调用」的身份 */
  id: string
  round: number
  phase: 'start' | 'end'
  name: string
  label?: string
  /** 原始参数 JSON 文本 */
  args: string
  /** 仅 end 阶段有值 */
  result?: string
  state?: 'done' | 'failed'
  durationMs?: number
}

/** 终端输出流：stdout 与 stderr 分开，渲染层用不同颜色区分 */
export type TerminalStream = 'stdout' | 'stderr'

/**
 * 一条终端输出分片。
 * 不做行缓冲：子进程怎么吐就怎么推，保证「流式」观感（长命令的进度条也能动）。
 */
export interface TerminalDataEvent {
  id: string
  stream: TerminalStream
  text: string
}

/** 终端进程结束事件。exitCode 为 null 表示被信号/终止按钮杀掉 */
export interface TerminalExitEvent {
  id: string
  exitCode: number | null
  signal: string | null
  /** 被 terminal:kill 主动终止 */
  killed: boolean
  /** 终止时 taskkill 是否成功带走整棵进程树（false = 只杀掉了直接子进程，可能有残留） */
  treeKillOk?: boolean
  /** taskkill 失败原因（用于界面提示，可读文案） */
  treeKillError?: string
  durationMs: number
}

/** terminal:run 的结构化返回 */
export interface TerminalRunResult {
  ok: boolean
  id?: string
  /** cwd 回显（供渲染层显示「在哪个目录执行」） */
  cwd?: string
  error?: string
}

/* ------------------------------------------------------------------
   内置浏览器 ↔ Agent（规格 5 · 八）
   ------------------------------------------------------------------ */

/** 主进程 → 渲染层：guest webContents 已挂上（渲染层此时才能取到 getWebContentsId） */
export const WEBVIEW_ATTACHED_EVENT = 'sk:webviewAttached'

/** 主进程 → 渲染层：Agent 调用了 browser_close，面板需要回到空态 */
export const BROWSER_AGENT_CLOSED_EVENT = 'browser:agentClosed'

/** 主进程 → 渲染层：Agent 刚操作了同一个 webview（面板给一行反馈，证明是同一实例） */
export const BROWSER_AGENT_ACTIVITY_EVENT = 'browser:agentActivity'

/** 主进程 → 渲染层：右键链接选择「在新标签页打开」 */
export const BROWSER_OPEN_TAB_EVENT = 'browser:openTab'

/** 主进程 → 渲染层：右键链接「复制链接地址」已完成（面板给一行反馈） */
export const BROWSER_LINK_COPIED_EVENT = 'browser:linkCopied'

/**
 * 主进程 → 渲染层：Agent 需要浏览器。
 * browser_open 时若主进程手里还没有可操作的 <webview>，就发这个事件请渲染层
 * 打开右侧面板 + 切到「浏览器」tab + 建一个指向该网址的标签页；
 * 等 guest 挂上并完成 browser:bind 后，抹平「Agent 必须先等用户手动开面板」的断层。
 */
export const BROWSER_ENSURE_EVENT = 'browser:ensure'

/** browser:bind 的结构化返回 */
export interface BrowserBindResult {
  ok: boolean
  /** 被控页面当前 URL */
  url?: string
  error?: string
}

/** Agent 对内置浏览器的操作留痕（面板据此显示「Agent 刚做了什么」） */
export interface BrowserAgentActivity {
  action: 'open' | 'snapshot' | 'click' | 'fill' | 'screenshot' | 'close'
  /** 一句话说明（可读的 detail，如 URL 或 index） */
  detail?: string
}
