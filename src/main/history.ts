import type { ChatMessage } from '../shared/types'

/**
 * 历史消息预算控制（C2 · 长期记忆摘要的第一层）
 *
 * 背景：原先 `runChatStream` 把 payload.messages **全量**送回模型，
 * 没有任何长度控制。上下文窗口配到 131072，长对话最终会撞上限、
 * 由供应商返回 400 报错，对话直接断掉。
 *
 * 这里做的是**确定性裁剪**：按字符预算保留最近的消息，丢弃更早的，
 * 并在最前面插入一条说明，让模型知道自己看到的不是全部历史。
 *
 * 为什么先做"裁剪"而不是"摘要"：
 *   裁剪零成本、零额外模型调用、行为可预测；摘要准确但要多一次请求。
 *   先把"会报错"这个问题按确定性手段解决，摘要留作后续增强。
 *
 * 注意：裁剪点必须避开 tool 消息的配对关系——`assistant(tool_calls)` 与其
 * 后续 `tool` 结果是一条链，从中间切断会让部分供应商报 400。
 */

/** 粗略 token 估算：中文约 1.6 字符/token，英文约 4 字符/token，取保守的 2.2 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 2.2)
}

function messageSize(m: ChatMessage): number {
  let n = approxTokens(typeof m.content === 'string' ? m.content : '')
  if (m.tool_calls) n += approxTokens(JSON.stringify(m.tool_calls))
  return n + 8 // 角色/分隔等固定开销
}

export interface TrimResult {
  messages: ChatMessage[]
  /** 被丢弃的消息条数（0 表示未裁剪） */
  dropped: number
  /** 裁剪后的估算 tokens */
  tokens: number
  /** 裁剪前的估算 tokens */
  originalTokens: number
}

/**
 * 按 token 预算裁剪历史。
 *
 * @param messages 完整历史（已剥掉 UI 留痕字段）
 * @param contextWindowTokens 配置的上下文窗口
 * @param reserveForOutput 给模型回复预留的 token（默认取窗口的 1/4，上限 8192）
 * @param systemTokens system prompt 占用的 token（要从预算里扣掉）
 */
export function trimHistory(
  messages: ChatMessage[],
  contextWindowTokens: number,
  systemTokens: number,
  reserveForOutput?: number
): TrimResult {
  const originalTokens = messages.reduce((s, m) => s + messageSize(m), 0)
  const empty: TrimResult = { messages, dropped: 0, tokens: originalTokens, originalTokens }
  if (messages.length === 0) return empty

  const reserve = reserveForOutput ?? Math.min(8192, Math.max(1024, Math.floor(contextWindowTokens / 4)))
  // 预算 = 窗口 - system - 预留输出，再留 10% 安全边际
  const budget = Math.floor((contextWindowTokens - systemTokens - reserve) * 0.9)
  if (budget <= 0) {
    // 窗口配得过小：至少保留最后一轮，避免完全空发
    const lastUser = [...messages].reverse().findIndex((m) => m.role === 'user')
    const keep = lastUser >= 0 ? messages.slice(messages.length - lastUser - 1) : messages.slice(-2)
    return { messages: keep, dropped: messages.length - keep.length, tokens: keep.reduce((s, m) => s + messageSize(m), 0), originalTokens }
  }
  if (originalTokens <= budget) return empty

  // 从尾部往前累加，直到接近预算；用 token 而非条数，长短消息都能自适应
  const kept: ChatMessage[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const size = messageSize(m)
    if (used + size > budget && kept.length > 0) break
    kept.unshift(m)
    used += size
  }

  // 修正裁剪点：不能以 tool 消息开头（它的 assistant(tool_calls) 已被丢掉）
  while (kept.length > 0 && kept[0].role === 'tool') kept.shift()

  const dropped = messages.length - kept.length
  if (dropped <= 0) return empty

  const note: ChatMessage = {
    role: 'system',
    content:
      `[会话早期内容已省略：为控制上下文长度，本轮的更早记录（约 ${dropped} 条）未提供。` +
      `如需回顾更早的细节，请如实说明你只能看到较近的部分，不要凭猜测补全。]`
  }
  const out = [note, ...kept]
  return {
    messages: out,
    dropped,
    tokens: out.reduce((s, m) => s + messageSize(m), 0),
    originalTokens
  }
}

/**
 * 把消息时间戳转成相对时间的简短中文标注（如「今天 14:30」「昨天 22:10」「3 天前」），
 * 用于回放历史消息时让模型分清先后与新旧，避免把前几天聊的当成"刚刚/今晚发生"。
 */
export function relTimeLabel(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `今天 ${hm}`
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  const isYesterday = d.getFullYear() === y.getFullYear() && d.getMonth() === y.getMonth() && d.getDate() === y.getDate()
  if (isYesterday) return `昨天 ${hm}`
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((dayStart - msgDay) / 86400000)
  if (days >= 1 && days < 7) return `${days} 天前`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}
