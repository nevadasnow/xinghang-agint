import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'

/**
 * F3 对话内搜索
 *
 * 本地全文匹配，**不调用任何模型、不产生 token 消耗**。
 *
 * 设计取舍：
 *   1) 高亮在**渲染层**做，不改消息数据：搜索是临时视图状态，
 *      若把 `<mark>` 注入内容里，会把界面标记混进要落盘/回放的消息（这是必须避免的）。
 *   2) 只在 `user` / `assistant` 正文里搜：`system` / `tool` 是内部协议，搜出来没有意义。
 *   3) 命中位置用于跳转：序号 + 滚动，而不是把匹配项过滤成一个新列表——
 *      对话的上下文对理解很关键，过滤掉会失去前后文。
 */

export interface SearchHit {
  /** 消息在 messages 数组里的下标 */
  index: number
  /** 该消息内的命中次数 */
  count: number
}

export interface UseChatSearchResult {
  query: string
  setQuery: (q: string) => void
  hits: SearchHit[]
  /** 当前聚焦第几个命中（0 基），-1 表示没有 */
  cursor: number
  totalMatches: number
  jump: (delta: 1 | -1) => void
  clear: () => void
  /** 某条消息是否命中、是否当前聚焦 */
  stateOf: (index: number) => { matched: boolean; focused: boolean; count: number }
  /** 把当前命中滚动到视野 */
  scrollTo: (index: number) => void
  registerRef: (index: number, el: HTMLElement | null) => void
}

/** 大小写不敏感的子串计数（不做正则，避免用户输入的特殊字符引发异常） */
export function countMatches(text: string, query: string): number {
  if (!query) return 0
  const hay = text.toLowerCase()
  const needle = query.toLowerCase()
  let n = 0
  let from = 0
  for (;;) {
    const i = hay.indexOf(needle, from)
    if (i < 0) break
    n++
    from = i + needle.length
    if (n > 999) break // 防御：避免极端输入下卡住
  }
  return n
}

export function useChatSearch(messages: ChatMessage[]): UseChatSearchResult {
  const [query, setQueryRaw] = useState('')
  const [cursor, setCursor] = useState(0)
  const refs = useRef<Map<number, HTMLElement>>(new Map())

  const hits = useMemo<SearchHit[]>(() => {
    const q = query.trim()
    if (!q) return []
    const out: SearchHit[] = []
    messages.forEach((m, i) => {
      if (m.role !== 'user' && m.role !== 'assistant') return
      const text = typeof m.content === 'string' ? m.content : ''
      const count = countMatches(text, q)
      if (count > 0) out.push({ index: i, count })
    })
    return out
  }, [messages, query])

  const totalMatches = useMemo(() => hits.reduce((s, h) => s + h.count, 0), [hits])

  // 查询变化时把焦点复位到第一个命中
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q)
    setCursor(0)
  }, [])

  const scrollTo = useCallback((index: number) => {
    const el = refs.current.get(index)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const jump = useCallback(
    (delta: 1 | -1) => {
      if (hits.length === 0) return
      const next = (cursor + delta + hits.length) % hits.length
      setCursor(next)
      scrollTo(hits[next].index)
    },
    [cursor, hits, scrollTo]
  )

  const clear = useCallback(() => {
    setQueryRaw('')
    setCursor(0)
  }, [])

  const stateOf = useCallback(
    (index: number) => {
      const idx = hits.findIndex((h) => h.index === index)
      return { matched: idx >= 0, focused: idx === cursor, count: idx >= 0 ? hits[idx].count : 0 }
    },
    [hits, cursor]
  )

  const registerRef = useCallback((index: number, el: HTMLElement | null) => {
    if (el) refs.current.set(index, el)
    else refs.current.delete(index)
  }, [])

  return { query, setQuery, hits, cursor, totalMatches, jump, clear, stateOf, scrollTo, registerRef }
}
