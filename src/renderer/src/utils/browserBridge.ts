/**
 * 渲染层的「Agent 拉起内置浏览器」请求总线。
 *
 * 背景：browser_open 依赖右侧面板里已挂载并完成 browser:bind 的 <webview>。
 * 若用户没先打开面板，主进程拿不到可操作实例。于是主进程会发 BROWSER_ENSURE_EVENT，
 * 由渲染层把「打开面板 → 切到浏览器 tab → 建标签页」这条链路走完。
 *
 * 为什么要单独一个模块：
 *   这条请求要跨三层组件传递（Chat 开面板 → RightPanel 切 tab → BrowserPane 建标签页），
 *   而三者挂载时机不同（面板可能 150ms 后才挂载、浏览器 pane 更是要点过 tab 才挂载）。
 *   用一份模块级 pending URL 兜住「事件先到、组件后到」的时序：
 *   后挂载的组件通过 consume/peek 也能补上，不会丢请求。
 */

let pendingUrl: string | null = null
const listeners = new Set<(url: string) => void>()

/** 记录待打开网址并通知已挂载的订阅者 */
export function requestBrowserOpen(url: string): void {
  const target = String(url ?? '').trim()
  if (!target) return
  pendingUrl = target
  for (const cb of [...listeners]) {
    try {
      cb(target)
    } catch {
      /* 单个订阅出错不影响其它订阅与主流程 */
    }
  }
}

/** 看一眼有没有待处理请求（不清空；供后挂载的组件决定是否切 tab） */
export function peekPendingBrowserUrl(): string | null {
  return pendingUrl
}

/** 取走待处理请求（同一网址只被消费一次） */
export function consumePendingBrowserUrl(): string | null {
  const url = pendingUrl
  pendingUrl = null
  return url
}

/** 订阅拉起请求，返回取消订阅函数 */
export function onBrowserOpenRequest(cb: (url: string) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
