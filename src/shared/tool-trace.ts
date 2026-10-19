/** 工具调用在 UI 里的呈现状态 */
export type ToolCallState = 'running' | 'done' | 'failed'

/** 单次工具调用的留痕（随会话持久化，刷新后仍可回看） */
export interface ToolCallTrace {
  /** 模型给出的调用 id（用于与 tool 角色消息配对） */
  id: string
  /** 工具 id（注册表 key） */
  name: string
  /** 面向用户的中文名，取不到时回落为 id */
  label?: string
  /** 模型给出的原始参数 JSON 文本（未解析，便于原样展示） */
  args: string
  /** 工具返回内容（已截断，避免长输出撑爆气泡） */
  result?: string
  state: ToolCallState
  durationMs?: number
}
