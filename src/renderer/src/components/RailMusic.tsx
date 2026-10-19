import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { musicStore, useMusic } from '../state/musicStore'
import PlaylistModal from './PlaylistModal'

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * 左侧栏背景音乐区（命令上方）：
 * - 展开态：当前歌曲名横向滚动循环字幕 + 上/下一首 + 播放/暂停 + 音量滑条
 * - 收纳态（rail 收窄——组件 tight 或 CSS 媒体查询压窄）：仅图标（播放中 CSS 旋转动画），
 *   单击通过 createPortal 弹出完整调节窗口（向右上、无视 rail 层级，任何面板都挡不住）
 * 与首页音乐卡共享全局 musicStore（同一 Audio 实例，切界面不中断）。
 */
export default function RailMusic({ tight }: { tight: boolean }) {
  const { track, playing, vol, tracks, error, loaded, cur, dur, mode } = useMusic()
  const [menuOpen, setMenuOpen] = useState(false)
  const [showPlaylist, setShowPlaylist] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const icRef = useRef<HTMLButtonElement>(null)
  const marqueeRef = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(false)
  /** 实际容器宽度：< 100px 视为收纳态（覆盖 tight prop 与 CSS 媒体查询两种收窄路径） */
  const [narrow, setNarrow] = useState(false)
  /** 弹出窗口位置（视口坐标，fixed 定位） */
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    void musicStore.loadTracks()
  }, [])

  // 观察容器宽度，自动切换图标态/展开态
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setNarrow(el.clientWidth < 100)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 点外部关闭弹窗（pop 为 portal，需同时视为「内部」，否则点 pop 内按钮会被误关）
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent): void => {
      const target = e.target as Node
      const inMenu = menuRef.current ? menuRef.current.contains(target) : false
      const inPop = document.querySelector('.rail-music-pop')?.contains(target) ?? false
      if (!inMenu && !inPop) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  // 曲名是否溢出（决定是否滚动字幕）
  useEffect(() => {
    const el = marqueeRef.current
    if (!el) return
    const check = (): void => {
      const parent = el.parentElement
      setOverflow(parent ? el.scrollWidth > parent.clientWidth : false)
    }
    check()
    const t = window.setTimeout(check, 350)
    const ro = new ResizeObserver(check)
    if (el.parentElement) ro.observe(el.parentElement)
    return () => {
      window.clearTimeout(t)
      ro.disconnect()
    }
  }, [track])

  /** 进度跳转（点击 / 拖动共用） */
  function seekTo(e: { clientX: number }, el: HTMLDivElement): void {
    if (!dur) return
    const r = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    musicStore.seek(ratio * dur)
  }
  function onSeekDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (!dur) return
    e.currentTarget.setPointerCapture(e.pointerId)
    e.currentTarget.classList.add('dragging')
    seekTo(e, e.currentTarget)
  }
  function onSeekMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.buttons !== 1) return
    seekTo(e, e.currentTarget)
  }
  function onSeekUp(e: React.PointerEvent<HTMLDivElement>): void {
    e.currentTarget.classList.remove('dragging')
  }

  /** 收纳态点击：记录图标视口位置，向右上弹出（fixed，无视 rail 层级） */
  function openPopup(): void {
    const r = icRef.current?.getBoundingClientRect()
    if (r) {
      // 左缘 = 图标右缘 + 10px；顶部 = 图标底部（CSS translateY(-100%) 使窗口底部对齐图标底部、向上展开）
      setPopPos({ left: r.right + 10, top: r.bottom })
    }
    setMenuOpen((v) => !v)
  }

  const iconOnly = narrow || tight

  // 收纳态：仅图标 + 单击弹出完整调节窗口（portal 到 body，任何面板挡不住）
  if (iconOnly) {
    const mqDur = track ? Math.max(6, track.name.length * 0.35) : 8
    return (
      <div className="rail-music tight" ref={menuRef}>
        <button
          ref={icRef}
          type="button"
          className={'rail-music-ic' + (playing ? ' spin' : '')}
          title="背景音乐"
          aria-label="背景音乐"
          onClick={openPopup}
        >
          {playing ? '♫' : '♪'}
        </button>
        {menuOpen &&
          popPos &&
          createPortal(
            <div className="rail-music-pop" style={{ left: popPos.left, top: popPos.top }}>
              <div className="rail-music-head">
                <span className={'rail-music-ic' + (playing ? ' spin' : '')} aria-hidden="true">
                  {playing ? '♫' : '♪'}
                </span>
                <div className="rail-music-marquee">
                  <span
                    ref={marqueeRef}
                    className={'marquee-inner' + (overflow ? ' ovf' : '')}
                    style={{ ['--mq-dur' as string]: `${mqDur}s` }}
                  >
                    {track ? track.name : '背景音乐'}
                  </span>
                </div>
              </div>
              <div className="rail-seek" onPointerDown={onSeekDown} onPointerMove={onSeekMove} onPointerUp={onSeekUp} onPointerCancel={onSeekUp} role="presentation">
                <i style={{ width: `${dur > 0 ? (cur / dur) * 100 : 0}%` }} />
              </div>
              <div className="rail-seek-time">
                {fmt(cur)} / {fmt(dur)}
              </div>
              <div className="rail-music-ops">
                <button type="button" onClick={() => musicStore.prev()} disabled={tracks.length < 2} data-tip="上一首">
                  ⏮
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => musicStore.toggle()}
                  disabled={!track}
                  data-tip={playing ? '暂停' : '播放'}
                >
                  {playing ? '⏸' : '▶'}
                </button>
                <button type="button" onClick={() => musicStore.next()} disabled={tracks.length < 2} data-tip="下一首">
                  ⏭
                </button>
                <button
                  type="button"
                  className={'mode' + (mode !== 'order' ? ' on' : '')}
                  onClick={() => musicStore.cycleMode()}
                  title="播放模式：顺序 / 单曲循环 / 随机，点击切换"
                  data-tip={mode === 'order' ? '顺序播放（点击切换）' : mode === 'single' ? '单曲循环（点击切换）' : '随机播放（点击切换）'}
                >
                  {mode === 'order' ? '顺序' : mode === 'single' ? '单曲' : '随机'}
                </button>
              </div>
              <div className="rail-music-vol">
                <span className="vol-ic" aria-hidden="true">
                  ♪
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={vol}
                  onChange={(e) => musicStore.setVol(Number(e.target.value))}
                  aria-label="音量"
                />
              </div>
              <button type="button" className="rail-music-playlist" onClick={() => setShowPlaylist(true)} disabled={!loaded}>
                ♪ 歌单
              </button>
              {error && <div className="pop-err">{error}</div>}
            </div>,
            document.body
          )}
        <PlaylistModal open={showPlaylist} onClose={() => setShowPlaylist(false)} />
      </div>
    )
  }

  // 展开态：字幕 + 控制 + 音量
  const mqDur = track ? Math.max(6, track.name.length * 0.35) : 8
  return (
    <div className="rail-music" ref={menuRef}>
      <div className="rail-music-head">
        <span className={'rail-music-ic' + (playing ? ' spin' : '')} aria-hidden="true">
          {playing ? '♫' : '♪'}
        </span>
        <div className="rail-music-marquee">
          <span
            ref={marqueeRef}
            className={'marquee-inner' + (overflow ? ' ovf' : '')}
            style={{ ['--mq-dur' as string]: `${mqDur}s` }}
          >
            {track ? track.name : '背景音乐'}
          </span>
        </div>
      </div>
      <div className="rail-seek" onPointerDown={onSeekDown} onPointerMove={onSeekMove} onPointerUp={onSeekUp} onPointerCancel={onSeekUp} role="presentation">
        <i style={{ width: `${dur > 0 ? (cur / dur) * 100 : 0}%` }} />
      </div>
      <div className="rail-seek-time">
        {fmt(cur)} / {fmt(dur)}
      </div>
      <div className="rail-music-ops">
        <button type="button" onClick={() => musicStore.prev()} disabled={tracks.length < 2} title="上一首">
          ⏮
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => musicStore.toggle()}
          disabled={!track}
          title={playing ? '暂停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button type="button" onClick={() => musicStore.next()} disabled={tracks.length < 2} title="下一首">
          ⏭
        </button>
        <button
          type="button"
          className={'mode' + (mode !== 'order' ? ' on' : '')}
          onClick={() => musicStore.cycleMode()}
          title="播放模式：顺序 / 单曲循环 / 随机，点击切换"
          data-tip={mode === 'order' ? '顺序播放（点击切换）' : mode === 'single' ? '单曲循环（点击切换）' : '随机播放（点击切换）'}
        >
          {mode === 'order' ? '顺序' : mode === 'single' ? '单曲' : '随机'}
        </button>
      </div>
      <div className="rail-music-vol">
        <span className="vol-ic" aria-hidden="true">
          ♪
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vol}
          onChange={(e) => musicStore.setVol(Number(e.target.value))}
          aria-label="音量"
        />
      </div>
      <button type="button" className="rail-music-playlist" onClick={() => setShowPlaylist(true)} disabled={!loaded}>
        ♪ 歌单
      </button>
      <PlaylistModal open={showPlaylist} onClose={() => setShowPlaylist(false)} />
    </div>
  )
}
