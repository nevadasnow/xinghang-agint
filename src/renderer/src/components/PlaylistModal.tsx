import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { musicStore, useMusic } from '../state/musicStore'

/**
 * 歌单弹窗（音乐模块）：
 * - 分析曲库所在文件夹（工程根/背景音乐），列出全部歌曲
 * - 每行显示：歌名 / 导入日期（文件修改时间）/ 歌曲时长（读取音频元数据）
 * - 上下滚动；点击某首歌即播放（与首页播放器同一实例）
 * - 标题栏可拖拽移动；右上角图标：打开文件夹 / 收纳·展开 / 关闭
 * - 点「收纳」后折叠成只剩标题栏（歌单 + 打开文件夹 + 收纳/展开 + 关闭）
 */

/** —— 歌单弹窗尺寸（想调整大小，改下面两个数字即可）——
 * PL_W：展开宽度（px，默认 680）
 * PL_H：展开最大高度（px，默认 620，超出会自动滚动）
 * 例如：PL_W = 760 会更宽；PL_H = 480 会更矮。
 */
const PL_W = 680
const PL_H = 620

interface Row {
  name: string
  url: string
  mtime: number
  /** 时长（秒），读取失败为 null */
  duration: number | null
}

function fmtDur(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtDate(ms: number): string {
  if (!ms) return '未知'
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 打开文件夹图标（currentColor 跟随主题） */
function FolderIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/** 收纳 / 展开图标（▾ 收起 / ▴ 展开） */
function ChevronIcon({ folded }: { folded: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {folded ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  )
}

export default function PlaylistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tracks, index, playing } = useMusic()
  const [rows, setRows] = useState<Row[]>([])
  const [ready, setReady] = useState(false)
  /** 拖拽后的面板位置（视口坐标）；null = 自动居中 */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  /** 同步 ref，供测量 effect 判断是否已被拖动过 */
  const posRef = useRef<{ left: number; top: number } | null>(null)

  /** 统一更新位置：state + ref 同步 */
  function applyPos(next: { left: number; top: number } | null): void {
    posRef.current = next
    setPos(next)
  }

  // 打开后按实际内容高度垂直居中（未拖动过时），避免歌单只有一两首时面板悬在偏上位置
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      const el = panelRef.current
      if (!el || posRef.current) return
      const rh = el.offsetHeight
      const top = Math.round((window.innerHeight - rh) / 2)
      const left = Math.round((window.innerWidth - PL_W) / 2)
      applyPos({ left, top })
    }, 80)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  /** 收纳：折叠成只剩标题栏 / 展开完整列表 */
  const [folded, setFolded] = useState(false)
  /** 底部提示：ok=成功（蓝/亮），err=失败（红） */
  const [info, setInfo] = useState<{ text: string; ok: boolean } | null>(null)
  /** 扫描定时器与取消标记（刷新/导入时先清理旧的） */
  const timersRef = useRef<number[]>([])
  const cancelRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  /** 拖拽起始记录 */
  const dragRef = useRef<{ sx: number; sy: number; left: number; top: number } | null>(null)

  /** 以曲库为底扫描列表：逐首读取时长（刷新/导入后重新调用即可看到最新曲库） */
  function scan(): void {
    cancelRef.current = false
    timersRef.current.forEach((t) => window.clearTimeout(t))
    timersRef.current = []
    const cur = musicStore.getSnapshot().tracks
    setReady(false)
    setInfo(null)
    setRows(cur.map((t) => ({ name: t.name, url: t.url, mtime: t.mtime, duration: null })))
    cur.forEach((t, i) => {
      // 每首错开一点，避免同时发起过多请求
      const timer = window.setTimeout(() => {
        if (cancelRef.current) return
        const a = new Audio()
        a.preload = 'metadata'
        let done = false
        const finish = (d: number | null): void => {
          if (done || cancelRef.current) return
          done = true
          setRows((prev) => {
            const next = prev.slice()
            next[i] = { ...next[i], duration: d }
            return next
          })
          a.src = ''
        }
        a.addEventListener('loadedmetadata', () => finish(Number.isFinite(a.duration) ? a.duration : null))
        a.addEventListener('error', () => finish(null))
        a.src = t.url
        // 6s 兜底
        const fail = window.setTimeout(() => finish(null), 6000)
        timersRef.current.push(fail)
      }, i * 180)
      timersRef.current.push(timer)
    })
    // 全部尝试完成（含失败）后标记就绪
    const check = window.setInterval(() => {
      if (cancelRef.current) return
      setRows((prev) => {
        if (prev.every((r) => r.duration !== null)) {
          window.clearInterval(check)
          setReady(true)
          return prev
        }
        return prev
      })
    }, 300)
    timersRef.current.push(check as unknown as number)
  }

  // 打开时扫描一次；关闭时清理定时器
  useEffect(() => {
    if (!open) return
    applyPos(null)
    setFolded(false)
    scan()
    return () => {
      cancelRef.current = true
      timersRef.current.forEach((t) => window.clearTimeout(t))
      timersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** 导入歌曲：系统文件选择 → 复制进曲库 → 刷新列表 */
  async function onImport(): Promise<void> {
    setInfo(null)
    const r = await window.shorekeeper.importMusic()
    if (!r.ok) {
      setInfo({ text: r.error || '导入失败', ok: false })
      return
    }
    if (r.canceled) return
    await musicStore.loadTracks(true)
    scan()
    setInfo(
      r.added && r.added.length > 0
        ? { text: `已导入 ${r.added.length} 首${r.added.length <= 3 ? '：' + r.added.join('、') : ''}`, ok: true }
        : { text: '没有可导入的音频文件', ok: false }
    )
  }

  /** 刷新歌单：重新扫描曲库目录 */
  async function onRefresh(): Promise<void> {
    setInfo(null)
    await musicStore.loadTracks(true)
    scan()
    setInfo({ text: '歌单已刷新', ok: true })
  }

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 标题栏拖拽：window 级 pointer 事件
  useEffect(() => {
    if (!open) return
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      const left = Math.min(Math.max(8, d.left + e.clientX - d.sx), window.innerWidth - 140)
      const top = Math.min(Math.max(8, d.top + e.clientY - d.sy), window.innerHeight - 80)
      applyPos({ left, top })
    }
    const onUp = (): void => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [open])

  function onHeadPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    dragRef.current = { sx: e.clientX, sy: e.clientY, left: rect.left, top: rect.top }
  }

  /** 收纳 / 展开：折叠时记录当前位置保持原位，展开时若底部超界则上移 */
  function toggleFold(): void {
    setFolded((v) => {
      const nv = !v
      if (nv) {
        const r = panelRef.current?.getBoundingClientRect()
        if (r) applyPos({ left: r.left, top: r.top })
      } else if (pos && pos.top + PL_H > window.innerHeight - 12) {
        applyPos({ left: pos.left, top: Math.max(8, window.innerHeight - PL_H - 12) })
      }
      return nv
    })
  }

  function openFolder(): void {
    setInfo(null)
    window.shorekeeper
      .openMusicDir()
      .then((r) => {
        if (!r.ok) setInfo({ text: r.error || '打开文件夹失败', ok: false })
      })
      .catch((e) => setInfo({ text: (e as Error).message, ok: false }))
  }

  if (!open) return null

  const w = PL_W
  const h = Math.min(PL_H, window.innerHeight - 120)
  const style = pos
    ? { left: pos.left, top: pos.top }
    : {
        left: Math.round((window.innerWidth - w) / 2),
        top: Math.round((window.innerHeight - h) / 2)
      }

  return createPortal(
    // 浮动窗口：背景透明、不拦截鼠标（不影响操作背后的主界面），Esc / ✕ 关闭
    <div className="pl-modal">
      <div ref={panelRef} className={'pl-panel' + (folded ? ' folded' : '')} style={style}>
        <div className="pl-head" onPointerDown={onHeadPointerDown}>
          <span className="pl-title">♪ 歌单</span>
          <span className="pl-dir">来源：D:\Shorekeeper-Agent-Dev\背景音乐</span>
          <span className="pl-head-ops">
            <button
              type="button"
              className="pl-icon-btn"
              onClick={onImport}
              data-tip="导入歌曲"
              aria-label="导入歌曲"
            >
              ＋
            </button>
            <button
              type="button"
              className="pl-icon-btn"
              onClick={onRefresh}
              data-tip="刷新歌单"
              aria-label="刷新歌单"
            >
              ⟳
            </button>
            <button
              type="button"
              className="pl-icon-btn"
              onClick={openFolder}
              data-tip="打开文件夹"
              aria-label="打开曲库文件夹"
            >
              <FolderIcon />
            </button>
            <button
              type="button"
              className="pl-icon-btn"
              onClick={toggleFold}
              data-tip={folded ? '展开' : '收起'}
              aria-label={folded ? '展开' : '收起'}
            >
              <ChevronIcon folded={folded} />
            </button>
            <button type="button" className="pl-close" onClick={onClose} data-tip="关闭" aria-label="关闭">
              ✕
            </button>
          </span>
        </div>
        {!folded && (
          <div className="pl-list">
            {rows.length === 0 ? (
              <p className="pl-empty">曲库为空：把 mp3 / wav / m4a 等文件放进「背景音乐」目录即可。</p>
            ) : (
              rows.map((r, i) => (
                <button
                  key={r.url}
                  type="button"
                  className={'pl-row' + (i === index ? ' on' : '')}
                  onClick={() => musicStore.playAt(i)}
                >
                  <span className="pl-ic" aria-hidden="true">
                    {i === index && playing ? '▶' : i === index ? '❚❚' : '♪'}
                  </span>
                  <span className="pl-name">{r.name}</span>
                  <span className="pl-date">{fmtDate(r.mtime)}</span>
                  <span className="pl-dur">{r.duration != null ? fmtDur(r.duration) : ready ? '--:--' : '读取中…'}</span>
                </button>
              ))
            )}
          </div>
        )}
        {!folded && (
          <div className="pl-foot">
            <span>共 {rows.length} 首 · 点击歌曲即播放</span>
            {info && <span className={info.ok ? 'pl-ok' : 'pl-err'}>{info.text}</span>}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
