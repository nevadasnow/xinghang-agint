import { useEffect, useRef, useState } from 'react'
import { getAgentRole } from '../utils/agentRoles'
import { consumePendingBrowserUrl, onBrowserOpenRequest } from '../utils/browserBridge'

/**
 * 浏览器（多标签页 · 真·`<webview>` 内嵌）。
 *
 * 结构与行为：
 *   1) 多标签页：每个标签一个 <webview>，非活动标签 display:none（不销毁，切回保留状态）。
 *      地址栏导航更新当前标签；右键链接「在新标签页打开」由主进程 context-menu 推事件，
 *      这里新增标签；target=_blank 链接也默认新标签页打开。
 *   2) Agent 共用同一实例：挂载后把活动 webview 的 `getWebContentsId()` 交给主进程登记
 *      （browser:bind），browser_open / snapshot / click / fill / screenshot / close
 *      操作的就是眼前这一页；did-navigate 会同步地址栏与标签标题。
 *
 * 安全：
 *   1) `partition="persist:sk-browser"`：独立持久分区，cookie/登录态与主界面隔离
 *   2) `allowpopups` 开启（否则 target=_blank / window.open 会被静默丢弃、事件都不触发）；
 *      配合渲染层 preventDefault + 主进程 guest.setWindowOpenHandler deny，
 *      弹窗不会真正创建，只在本面板内导航 / 新开标签
 *   3) http/https 白名单：地址栏（normalizeUrl）与主进程（will-attach-webview / will-navigate）
 *      以及 Agent 工具入参（browser-bridge.normalizeHttpUrl）三处都校验
 *   4) `webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"`：guest 无 Node 权限
 */

/** <webview> 上我们要用到的方法（Electron 没导出 WebviewTag，这里只声明用到的部分） */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  reload(): void
  stop(): void
  isLoading(): boolean
  /** 网页缩放：只影响页面内容，不影响外壳 UI */
  setZoomFactor(factor: number): void
  getZoomFactor(): number
  /** guest 的 webContents id：交给主进程做 browser:bind，Agent 工具据此操作同一实例 */
  getWebContentsId(): number
}

/** 只放行 http / https；其它（file:、data:、javascript:……）一律拒绝 */
function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * 把用户输入变成合法 URL：
 *   - 已带 http(s) 前缀 → 原样
 *   - 含其它协议（file: / javascript: / data:…）→ null（拒绝）
 *   - 看着像域名（含 . 且无空格）→ 补 https://
 *   - 其余 → 走 Bing 搜索
 */
export function normalizeUrl(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null
  if (!/\s/.test(s) && /^[^\s/]+\.[^\s/]{2,}/.test(s)) return `https://${s}`
  return `https://www.bing.com/search?q=${encodeURIComponent(s)}`
}

/** guest 事件都带 url / errorCode 等字段，Electron 没给 TS 类型，这里按需取 */
type GuestEvent = Event & {
  url?: string
  errorCode?: number
  errorDescription?: string
  title?: string
  isMainFrame?: boolean
  validatedURL?: string
}

interface BrowserTab {
  id: string
  url: string
  title: string
}

interface BrowserPaneProps {
  /** 是否处于「浏览器铺满内容区（保留左侧栏）」的全屏态 */
  fullscreen?: boolean
  /** 切换全屏；由 Chat 控制，这样全屏范围能避开左侧栏 */
  onToggleFullscreen?: () => void
}

/** 缩放档位：按住按钮或滚轮滚动都在这条阶梯上走 */
const ZOOM_LADDER = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

export default function BrowserPane({ fullscreen = false, onToggleFullscreen }: BrowserPaneProps = {}) {
  /** 网页缩放（作用在活动 <webview> 上，只影响页面内容，不影响外壳 UI） */
  const [zoom, setZoom] = useState(1)
  /** 标签页列表 */
  const [tabs, setTabs] = useState<BrowserTab[]>([])
  /** 当前活动标签 id（null = 空态起始页） */
  const [activeId, setActiveId] = useState<string | null>(null)
  /** 地址栏里正在编辑的文本 */
  const [addr, setAddr] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [canBack, setCanBack] = useState(false)
  const [canFwd, setCanFwd] = useState(false)
  /** Agent 刚操作过页面时给一行反馈，让「面板与 Agent 共享同一实例」看得见 */
  const [agentNote, setAgentNote] = useState('')
  const hostRef = useRef<HTMLDivElement>(null)

  /** 已登记给主进程的 guest id（避免重复 bind） */
  const boundIdRef = useRef<number | null>(null)

  /** 订阅回调只注册一次，用 ref 读最新的 tabs / activeId，避免闭包拿到旧值 */
  const tabsRef = useRef<BrowserTab[]>([])
  const activeIdRef = useRef<string | null>(null)
  tabsRef.current = tabs
  activeIdRef.current = activeId

  const activeTab = tabs.find((t) => t.id === activeId) ?? null
  const activeUrl = activeTab?.url ?? ''
  const title = activeTab?.title ?? ''

  const wv = (): WebviewElement | null =>
    (hostRef.current?.querySelector('.rp-browser-tabpane.active webview') as WebviewElement | null) ?? null

  /** 按 id 更新一个标签的字段 */
  function updateTab(id: string, patch: Partial<BrowserTab>): void {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  /** 新增标签并切到它 */
  function addTab(url: string): void {
    const id = crypto.randomUUID()
    setTabs((prev) => [...prev, { id, url, title: '' }])
    setActiveId(id)
    setAddr(url)
    setErr('')
    setLoading(false)
  }

  /** 右键「在新标签页打开」 / target=_blank 弹窗统一入口 */
  function openInNewTab(url: string): void {
    if (!isHttpUrl(url)) return
    addTab(url)
  }

  /**
   * Agent 请求打开的网址：已有活动标签就复用它（Agent 与用户共用同一页），否则新建标签。
   * 用 ref 读最新状态，避免只注册一次的订阅回调闭包过期。
   */
  function openAgentUrl(raw: string): void {
    const url = normalizeUrl(raw)
    if (!url) return
    const id = activeIdRef.current
    if (id && tabsRef.current.some((t) => t.id === id)) {
      updateTab(id, { url })
      setAddr(url)
      setErr('')
      setLoading(false)
    } else {
      addTab(url)
    }
  }

  function switchTab(id: string): void {
    const t = tabs.find((x) => x.id === id)
    if (!t) return
    setActiveId(id)
    setAddr(t.url)
  }

  function closeTab(id: string): void {
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    setTabs(next)
    if (id === activeId) {
      if (next.length === 0) {
        setActiveId(null)
        setAddr('')
        setErr('')
      } else {
        const fallback = next[Math.max(0, idx - 1)]
        setActiveId(fallback.id)
        setAddr(fallback.url)
      }
    }
  }

  /** 把当前活动 <webview> 的 webContents 登记给主进程（browser_* 工具据此操作同一实例） */
  function bindGuest(): void {
    const el = wv()
    if (!el) return
    try {
      const id = el.getWebContentsId()
      if (!id || boundIdRef.current === id) return
      boundIdRef.current = id
      void window.shorekeeper.browserBind(id).then((r) => {
        if (!r?.ok) {
          // 绑定失败常是 guest 还没完全挂上：清掉占位，让下一次 dom-ready / attached 重试
          boundIdRef.current = null
          setAgentNote(r?.error ? `绑定内置浏览器失败：${r.error}` : '')
        }
      })
    } catch (e) {
      setAgentNote(`绑定内置浏览器失败：${(e as Error).message}`)
    }
  }

  // 主进程在 guest 挂上时会推一次 sk:webviewAttached（避免「先挂载后监听」的竞态）
  useEffect(() => window.shorekeeper.onWebviewAttached(bindGuest), [])

  /**
   * Agent 请求拉起内置浏览器：面板可能是刚挂载的，先把 pending 消费掉；
   * 之后继续保持订阅，Agent 再次 browser_open 时复用/新建标签页。
   */
  useEffect(() => {
    const pending = consumePendingBrowserUrl()
    if (pending) openAgentUrl(pending)
    return onBrowserOpenRequest((url) => {
      openAgentUrl(consumePendingBrowserUrl() ?? url)
    })
    // openAgentUrl 只读 ref 与稳定的 setState，无需重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 右键「在新标签页打开」（主进程 context-menu 推过来的链接）
  useEffect(
    () =>
      window.shorekeeper.onOpenTab((url) => {
        openInNewTab(url)
      }),
    []
  )

  // 右键「复制链接地址」完成反馈
  useEffect(
    () =>
      window.shorekeeper.onLinkCopied(() => {
        setAgentNote('已复制链接地址')
      }),
    []
  )

  // Agent 调 browser_close → 面板回空态 + 解绑
  useEffect(
    () =>
      window.shorekeeper.onBrowserAgentClosed(() => {
        boundIdRef.current = null
        void window.shorekeeper.browserUnbind()
        setTabs([])
        setActiveId(null)
        setAddr('')
        setErr('')
        setLoading(false)
        setAgentNote('Agent 已关闭内置浏览器页面')
      }),
    []
  )

  // Agent 操作同一个 webview 时的反馈（证明面板与 Agent 是同一实例）
  useEffect(
    () =>
      window.shorekeeper.onBrowserAgentActivity((ev) => {
        const label: Record<string, string> = {
          open: '打开网址',
          snapshot: '读取页面结构',
          click: '点击元素',
          fill: '填写表单',
          screenshot: '截图',
          close: '关闭页面'
        }
        setAgentNote(`Agent 通过内置浏览器${label[ev.action] ?? ev.action}${ev.detail ? `：${ev.detail}` : ''}`)
      }),
    []
  )

  // 卸载（切走 tab / 关面板）时解绑，避免主进程留着一个已经没了的 webview
  useEffect(
    () => () => {
      if (boundIdRef.current !== null) {
        boundIdRef.current = null
        void window.shorekeeper.browserUnbind()
      }
    },
    []
  )

  // <webview> 是原生元素，React 只负责挂载；事件要在 DOM 上手动接。
  // 活动标签的 url / id 变化（重建或切换）都会重新接线。
  useEffect(() => {
    const el = wv()
    if (!el) return

    const syncNav = (): void => setCanBack(el.canGoBack())
    const syncNavFwd = (): void => setCanFwd(el.canGoForward())
    const onStart = (): void => {
      setLoading(true)
      setErr('')
    }
    const onStop = (): void => {
      setLoading(false)
      syncNav()
      syncNavFwd()
      // 用户点站内链接触发的跳转：把地址栏拉回真实 URL
      const cur = el.getURL()
      if (cur) {
        setAddr(cur)
        updateTab(String(el.dataset.tab || ''), { url: cur })
      }
      const t = el.getTitle()
      if (t) updateTab(String(el.dataset.tab || ''), { title: t })
    }
    const onTitle = (e: Event): void => {
      const t = (e as GuestEvent).title ?? ''
      updateTab(String(el.dataset.tab || ''), { title: t })
    }
    const onDomReady = (): void => {
      bindGuest()
      // 页面换掉后旧的元素引用已经失效（Agent 的 index 映射随之作废）
      setAgentNote((n) => (n === 'Agent 已关闭内置浏览器页面' ? n : ''))
    }
    const onNavigate = (e: Event): void => {
      const url = (e as GuestEvent).url ?? el.getURL()
      if (url && isHttpUrl(url)) {
        setAddr(url)
        updateTab(String(el.dataset.tab || ''), { url })
      }
      syncNav()
      syncNavFwd()
    }
    const onFail = (e: Event): void => {
      const ev = e as GuestEvent
      // -3 = ERR_ABORTED：点了别的链接/主动停止，属于正常现象，不当错误展示
      if (ev.errorCode === -3 || ev.isMainFrame === false) return
      setLoading(false)
      setErr(`${ev.errorDescription || '加载失败'}（${ev.errorCode ?? '?'}）`)
    }
    // 渲染层侧的协议闸门：webview 内部跳转到非 http(s) 时拦下
    const onWillNavigate = (e: Event): void => {
      const url = (e as GuestEvent).url ?? ''
      if (!isHttpUrl(url)) {
        e.preventDefault()
        setErr(`已拦截非 http/https 跳转：${url.slice(0, 60)}`)
      }
    }
    // 弹窗（target=_blank / window.open）：新标签页打开（主进程 handler 兜底为当前页导航）
    const onNewWindow = (e: Event): void => {
      const url = (e as GuestEvent).url ?? ''
      e.preventDefault()
      openInNewTab(url)
    }

    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('did-fail-load', onFail)
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('did-navigate', onNavigate)
    el.addEventListener('did-navigate-in-page', onNavigate)
    el.addEventListener('will-navigate', onWillNavigate)
    el.addEventListener('new-window', onNewWindow)
    // guest 刚挂上时 getWebContentsId() 可能还拿不到，挂上后再绑一次（幂等）
    el.addEventListener('dom-ready', onDomReady)
    bindGuest()
    return () => {
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('did-fail-load', onFail)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('did-navigate', onNavigate)
      el.removeEventListener('did-navigate-in-page', onNavigate)
      el.removeEventListener('will-navigate', onWillNavigate)
      el.removeEventListener('new-window', onNewWindow)
      el.removeEventListener('dom-ready', onDomReady)
    }
    // 活动标签 url / id 变化都会导致活动 webview 元素变化，需要重新接线与重新绑定
  }, [activeId, activeUrl])

  function go(raw: string): void {
    const url = normalizeUrl(raw)
    if (!url) {
      setErr('只允许 http / https 地址')
      return
    }
    setErr('')
    setAddr(url)
    if (activeTab) {
      if (activeTab.url === url) wv()?.loadURL(url)
      else updateTab(activeTab.id, { url })
    } else {
      addTab(url)
    }
  }

  function back(): void {
    const el = wv()
    if (el?.canGoBack()) el.goBack()
  }

  function forward(): void {
    const el = wv()
    if (el?.canGoForward()) el.goForward()
  }

  function reload(): void {
    const el = wv()
    if (!el) return
    if (el.isLoading()) el.stop()
    else el.reload()
  }

  /** 把缩放作用到活动 <webview> 上（Electron 会自行缩放页面内容并保持居中） */
  function applyZoom(next: number): void {
    const clamped = Math.min(2, Math.max(0.5, Number(next.toFixed(2))))
    setZoom(clamped)
    const el = wv()
    if (el) el.setZoomFactor(clamped)
  }

  /** 在缩放阶梯上前后走一格 */
  function stepZoom(dir: 1 | -1): void {
    const cur = ZOOM_LADDER.reduce((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best), ZOOM_LADDER[0])
    const i = ZOOM_LADDER.indexOf(cur)
    const next = ZOOM_LADDER[Math.min(ZOOM_LADDER.length - 1, Math.max(0, i + dir))]
    applyZoom(next)
  }

  // Ctrl/⌘ + 滚轮缩放（符合浏览器习惯）；普通滚轮不动，交给页面自己滚
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      stepZoom(e.deltaY < 0 ? 1 : -1)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
    // stepZoom 依赖 zoom，zoom 变化时重新绑定即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, activeUrl])

  // 新页面载入后把当前缩放重新应用一次（url 变化会重建 <webview>，缩放会丢）
  useEffect(() => {
    const el = wv()
    if (el && zoom !== 1) el.setZoomFactor(zoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUrl])

  return (
    <div className="rp-browser">
      {/* 标签页栏 */}
      {tabs.length > 0 && (
        <div className="rp-tabs">
          {tabs.map((t) => (
            <div
              key={t.id}
              className={'rp-btab' + (t.id === activeId ? ' active' : '')}
              title={t.title || t.url}
              onClick={() => switchTab(t.id)}
            >
              <span className="rp-btab-title">{t.title || t.url || '新标签页'}</span>
              <button
                type="button"
                className="rp-btab-close"
                title="关闭标签页"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="rp-browser-bar">
        <button type="button" className="rp-nav" title="后退" disabled={!canBack} onClick={back}>
          ◀
        </button>
        <button type="button" className="rp-nav" title="前进" disabled={!canFwd} onClick={forward}>
          ▶
        </button>
        <button type="button" className={'rp-nav' + (loading ? ' busy' : '')} title="刷新 / 停止" onClick={reload}>
          ⟳
        </button>
        <input
          className="rp-addr"
          value={addr}
          spellCheck={false}
          placeholder="输入网址或搜索词，回车访问"
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              go(addr)
            }
          }}
        />
        <button type="button" className="rp-go" onClick={() => go(addr)}>
          前往
        </button>

        {/* 网页缩放：只作用于页面内容，不影响外壳 UI */}
        <button type="button" className="rp-nav rp-zoom" title="缩小（Ctrl + 滚轮）" onClick={() => stepZoom(-1)}>
          −
        </button>
        <button
          type="button"
          className="rp-zoom-val"
          title="点击恢复 100%"
          onClick={() => applyZoom(1)}
        >
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="rp-nav rp-zoom" title="放大（Ctrl + 滚轮）" onClick={() => stepZoom(1)}>
          ＋
        </button>

        {/* 全屏：铺满内容区但保留左侧栏 */}
        {onToggleFullscreen && (
          <button
            type="button"
            className={'rp-nav' + (fullscreen ? ' on' : '')}
            title={fullscreen ? '退出全屏' : '全屏浏览（保留左侧栏）'}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? '⤡' : '⤢'}
          </button>
        )}
      </div>

      {title && (
        <div className="rp-browser-title" title={title}>
          {loading ? <span className="rp-browser-dot" aria-hidden="true" /> : null}
          {title}
        </div>
      )}

      {err && <div className="rp-browser-err">{err}</div>}
      {agentNote && <div className="rp-browser-note">{agentNote}</div>}

      <div className="rp-browser-view" ref={hostRef}>
        {tabs.length === 0 ? (
          <div className="rp-browser-empty">
            <div className="rp-browser-glyph" aria-hidden="true">
              ⊕
            </div>
            <p className="rp-browser-empty-title">内置浏览器</p>
            <p className="rp-browser-empty-desc">
              真实内嵌页面（<code>&lt;webview&gt;</code>）：可以点击、滚动、登录，不是截图预览。
            </p>
            <p className="rp-browser-empty-desc">
              支持<b>多标签页</b>：右键链接「在新标签页打开」/「复制链接地址」；{' '}
              <code>target=_blank</code> 链接也会自动开新标签。
            </p>
            <p className="rp-browser-empty-desc">
              同一个页面也能让<b>{getAgentRole().name}操作</b>：<code>browser_open</code> / <code>browser_snapshot</code> /{' '}
              <code>browser_click</code> / <code>browser_fill</code> / <code>browser_screenshot</code> /{' '}
              <code>browser_close</code>（工作模式）。
            </p>
            <p className="rp-browser-empty-desc">
              只放行 <code>http</code> / <code>https</code>；独立分区 <code>persist:sk-browser</code>，
              与主界面 cookie 隔离。
            </p>
            <div className="rp-browser-links">
              {[
                ['https://www.bing.com', 'Bing'],
                ['https://developer.mozilla.org', 'MDN'],
                ['https://www.electronjs.org/docs/latest/api/webview-tag', 'Electron webview']
              ].map(([u, label]) => (
                <button key={u} type="button" className="rp-browser-link" onClick={() => go(u)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          tabs.map((t) => (
            <div
              key={t.id}
              className={'rp-browser-tabpane' + (t.id === activeId ? ' active' : '')}
              data-tab={t.id}
            >
              {t.url ? (
                <webview
                  key={t.id + ':' + t.url}
                  src={t.url}
                  data-tab={t.id}
                  partition="persist:sk-browser"
                  allowpopups={"true" as unknown as boolean}
                  webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
                  className="rp-webview"
                />
              ) : null}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
