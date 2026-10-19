import { useEffect, useRef, useState } from 'react'
import BrowserPane from './BrowserPane'
import TerminalPane from './TerminalPane'
import WorkspaceFilesPane from './WorkspaceFilesPane'
import { onBrowserOpenRequest, peekPendingBrowserUrl } from '../utils/browserBridge'

/**
 * 右侧可调面板（规格 5 一）：三个 tab —— 工作区文件 / 终端 / 浏览器。
 *
 * 形态：
 *   - 默认 380px，拖左边缘调宽（280 ~ 1280px，可超过屏幕一半；
 *     受「对话区至少留 260px」约束；上限在 RP_MAX，见下方）
 *   - 可折叠成 44px 竖条（只留图标）
 *   - 可关闭（关闭后由 Chat.tsx 不再渲染，右侧完全不占位）
 *   - 宽度 / 折叠 / 选中 tab 记忆到 localStorage（键 sk-right-panel）
 *   - 窄窗口（<=1080px）自动改浮层覆盖 + 半透明遮罩，**不会整体消失**
 */

/** localStorage 键（规格建议的键名） */
const STORE_KEY = 'sk-right-panel'
export const RP_MIN = 280
/** 可拖到接近全屏（超过屏幕一半）；实际还受 effectiveWidth 的「对话区至少留 260px」限制 */
export const RP_MAX = 1100
export const RP_DEFAULT = 380
/** 折叠后的竖条宽度（与 chat.css 的 .rp-collapsed 保持一致） */
const RP_COLLAPSED = 44

export type RightPanelTab = 'files' | 'terminal' | 'browser'

interface Persisted {
  width: number
  tab: RightPanelTab
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v)))
}

function readStore(): Persisted {
  const fallback: Persisted = { width: RP_DEFAULT, tab: 'files' }
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return fallback
    const obj = JSON.parse(raw) as Partial<Persisted>
    const tab: RightPanelTab =
      obj.tab === 'terminal' || obj.tab === 'browser' || obj.tab === 'files' ? obj.tab : fallback.tab
    const width = typeof obj.width === 'number' && Number.isFinite(obj.width) ? clamp(obj.width, RP_MIN, RP_MAX) : RP_DEFAULT
    return { width, tab }
  } catch {
    return fallback
  }
}

interface Props {
  /** 窄窗口：改为浮层（贴右 + 遮罩），不挤压对话区 */
  overlay: boolean
  /** 关闭面板（关闭后右侧不占位；由左侧栏的「面板」按钮重新打开） */
  onClose: () => void
  /** 初始 tab（首次挂载时若 localStorage 没有记录则用它） */
  initialTab?: RightPanelTab
  /** 浏览器全屏时避开左侧栏用的左偏移（由 Chat 注入左栏实际宽度） */
  leftOffset?: string
}

export default function RightPanel({ overlay, onClose, initialTab = 'files', leftOffset = '216px' }: Props) {
  /** 首次挂载只读一次 localStorage（两处用同一个来源，不会读两遍） */
  const storeRef = useRef<Persisted | null>(null)
  if (storeRef.current === null) storeRef.current = readStore()

  const [tab, setTab] = useState<RightPanelTab>(() => {
    const saved = storeRef.current
    if (!saved) return initialTab
    // localStorage 里没有记录时 readStore 会回落 'files'，此处按 initialTab 覆盖
    try {
      return localStorage.getItem(STORE_KEY) ? saved.tab : initialTab
    } catch {
      return initialTab
    }
  })
  const [collapsed, setCollapsed] = useState(false)
  /**
   * 已访问过的 pane。只有访问过的才挂载，且挂载后不再卸载——
   * 这是避免「每次进对话页都重建 <webview>、重新 spawn Chromium guest 进程」
   * 造成首帧卡顿的关键。初始值用当前 tab，保证首屏那个 pane 立即可见。
   */
  const [visited, setVisited] = useState<Record<RightPanelTab, boolean>>(() => ({
    files: tab === 'files',
    terminal: tab === 'terminal',
    browser: tab === 'browser'
  }))
  useEffect(() => {
    setVisited((v) => (v[tab] ? v : { ...v, [tab]: true }))
  }, [tab])

  /**
   * Agent 请求拉起内置浏览器时切到「浏览器」tab。
   * 面板可能是刚被 Chat 打开才挂载的（请求先于挂载到达），
   * 所以挂载时先 peek 一次 pending，再订阅后续请求。
   */
  useEffect(() => {
    if (peekPendingBrowserUrl()) setTab('browser')
    return onBrowserOpenRequest(() => setTab('browser'))
  }, [])
  const [width, setWidth] = useState(() => storeRef.current?.width ?? RP_DEFAULT)
  const [dragging, setDragging] = useState(false)
  /** 拖拽开始时的 (指针 x, 面板宽)；用 ref 以免闭包拿到旧值 */
  const dragRef = useRef({ x: 0, w: 0 })

  /**
   * 实际生效宽度：既夹在 280~720，也保证对话区至少留 360px
   * （否则小窗口拖到 720 会把聊天区挤没）。
   */
  function effectiveWidth(w: number): number {
    const vw = typeof window === 'undefined' ? 1440 : window.innerWidth
    // 对话区至少留 260px（原来 360）：允许面板拖到屏幕一半以上，
    // 上限由 RP_MAX（1280）夹住；小窗口下也不至于把聊天区挤没。
    return clamp(Math.min(w, Math.max(RP_MIN, vw - 260)), RP_MIN, RP_MAX)
  }

  // 宽度 / tab 变更即记忆。拖拽期间 dragging=true，effect 先跳过；
  // 松手（dragging 回到 false）时再落盘一次，避免每帧 JSON.stringify。
  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ width, tab }))
    } catch {
      /* 配额/隐私模式：记忆不是关键功能，静默降级 */
    }
  }, [width, tab, dragging])

  // 窗口尺寸变化后重新夹一次，防止拖宽后面板把对话区压没
  useEffect(() => {
    const onResize = (): void => setWidth((w) => effectiveWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  /**
   * 浏览器全屏：铺满内容区但避开左侧栏。
   * 注意：所有 useState / useEffect 必须在「折叠态提前 return」之前声明——
   * 否则折叠时渲染的 Hooks 数量减少，React 会报错并整个应用白屏。
   */
  const [browserFs, setBrowserFs] = useState(false)
  // 切走浏览器 tab 时退出全屏，避免全屏态留在别的 tab 上
  useEffect(() => {
    if (tab !== 'browser' && browserFs) setBrowserFs(false)
  }, [tab, browserFs])

  /** 左边缘拖拽：用 pointer 事件 + setPointerCapture，鼠标移出窗口也能跟手 */
  function onHandleDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = { x: e.clientX, w: width }
    setDragging(true)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 老内核兜底：没有 capture 也能拖，只是移出窗口会断 */
    }
  }

  function onHandleMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    const delta = dragRef.current.x - e.clientX // 往左拖 = 变宽
    setWidth(effectiveWidth(dragRef.current.w + delta))
  }

  function onHandleUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dragging) return
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const TABS: Array<{ key: RightPanelTab; ic: string; label: string; title: string }> = [
    { key: 'files', ic: '▢', label: '工作区文件', title: '工作区文件（未接入）' },
    { key: 'terminal', ic: '▸_', label: '终端', title: '终端：本机真实执行命令' },
    { key: 'browser', ic: '⊕', label: '浏览器', title: '内置浏览器：真·webview 内嵌' }
  ]

  // ---------- 折叠态：44px 竖条，只留图标 ----------
  if (collapsed) {
    return (
      <aside className="rp rp-collapsed" aria-label="右侧面板（已折叠）">
        <button
          type="button"
          className="rp-icon-btn"
          title="展开面板"
          aria-label="展开面板"
          onClick={() => setCollapsed(false)}
        >
          ⊞
        </button>
        <div className="rp-collapsed-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={'rp-icon-btn' + (tab === t.key ? ' on' : '')}
              title={t.title}
              aria-label={t.label}
              onClick={() => {
                setTab(t.key)
                setCollapsed(false)
              }}
            >
              <span className="rp-ic" aria-hidden="true">
                {t.ic}
              </span>
            </button>
          ))}
        </div>
        <div className="rp-collapsed-sp" />
        <button type="button" className="rp-icon-btn" title="关闭面板" aria-label="关闭面板" onClick={onClose}>
          ✕
        </button>
      </aside>
    )
  }

  return (
    <>
      {overlay && <div className="rp-scrim" onClick={onClose} />}
      <aside
        className={
          'rp' +
          (overlay ? ' rp-overlay' : '') +
          (dragging ? ' rp-dragging' : '') +
          (browserFs ? ' rp-fs' : '')
        }
        style={
          browserFs
            ? ({ '--rp-fs-left': leftOffset } as React.CSSProperties)
            : { width: effectiveWidth(width) }
        }
        aria-label="右侧面板"
      >
        {/* 左边缘 8px 拖拽热区（视觉上是 1px 分隔线 + hover 变蓝） */}
        <div
          className="rp-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整面板宽度"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onDoubleClick={() => setWidth(RP_DEFAULT)}
          title="拖动调整宽度（双击恢复默认 380px）"
        />

        <div className="rp-tabbar">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={'rp-tab' + (tab === t.key ? ' on' : '')}
              title={t.title}
              onClick={() => setTab(t.key)}
            >
              <span className="rp-ic" aria-hidden="true">
                {t.ic}
              </span>
              <span className="rp-tab-label">{t.label}</span>
            </button>
          ))}
          <div className="rp-tabbar-sp" />
          <button
            type="button"
            className="rp-tab-btn"
            title="折叠面板（Ctrl+B）"
            aria-label="折叠面板"
            onClick={() => setCollapsed(true)}
          >
            ⊟
          </button>
          <button type="button" className="rp-tab-btn" title="关闭面板" aria-label="关闭面板" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="rp-body">
          {/* 访问过的 pane 常驻，用 CSS 隐藏未选中的那个。
              原因：<webview> 一旦卸载就会销毁 guest 进程，下次切回要重新 spawn
              一整个 Chromium 渲染进程（进入对话页"卡一下"的主因），
              同时页面状态/登录态也会丢。常驻后只在首次访问时创建一次。 */}
          {visited.files && (
            <div className={'rp-pane' + (tab === 'files' ? '' : ' rp-pane-off')}>
              <WorkspaceFilesPane />
            </div>
          )}
          {visited.terminal && (
            <div className={'rp-pane' + (tab === 'terminal' ? '' : ' rp-pane-off')}>
              <TerminalPane />
            </div>
          )}
          {visited.browser && (
            <div className={'rp-pane' + (tab === 'browser' ? '' : ' rp-pane-off')}>
              <BrowserPane fullscreen={browserFs} onToggleFullscreen={() => setBrowserFs((v) => !v)} />
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
