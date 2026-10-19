import { useEffect, useState } from 'react'
import { musicStore, useMusic } from '../state/musicStore'
import PlaylistModal from './PlaylistModal'

/**
 * 首页音乐模块（曲库播放器）。
 *
 * 曲库来自「工程根/背景音乐」目录（主进程扫描，mp3 / wav / m4a / flac / ogg 等），
 * 经 skmusic:// 协议播放；播放状态由全局 musicStore 维护，
 * 与左侧栏音乐区共享同一 Audio 实例——切到任何界面音乐都不中断。
 */

function fmt(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function MusicCard() {
  const { tracks, index, track, playing, vol, dur, cur, loaded, error, mode } = useMusic()
  const [showPlaylist, setShowPlaylist] = useState(false)

  useEffect(() => {
    void musicStore.loadTracks()
  }, [])

  const pct = dur > 0 ? (cur / dur) * 100 : 0

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

  return (
    <section className="card music-card">
      <div className="card-h">
        <span className="card-t">音乐</span>
        <span className="card-x">
          {track ? fmt(cur) + ' / ' + fmt(dur) : loaded ? '曲库为空' : '扫描曲库…'}
        </span>
      </div>

      <div className="music-body">
        <div className={'music-art' + (playing ? ' on' : '')} aria-hidden="true">
          {playing ? '♫' : '♪'}
        </div>
        <div className="music-meta">
          <div className="music-title">{track ? track.name : loaded ? '还没有音乐文件' : '正在扫描背景音乐…'}</div>
          <div className="music-sub">
            {track
              ? playing
                ? '正在播放'
                : '已暂停 · 点击播放'
              : loaded
                ? '把 mp3 / wav / m4a 文件放进「背景音乐」目录即可播放'
                : '正在读取本地曲库…'}
          </div>
        </div>
      </div>

      {/* 曲目列表：点击即播放 */}
      <div className="music-list">
        {tracks.length === 0 ? (
          <p className="music-hint">
            {loaded
              ? '曲库为空：请在「D:\\Shorekeeper-Agent-Dev\\背景音乐」目录放入音频文件（支持 mp3 / wav / m4a / flac / ogg）。'
              : '正在读取本地曲库…'}
          </p>
        ) : (
          tracks.map((t, i) => (
            <button
              key={t.url}
              type="button"
              className={'music-track' + (i === index ? ' on' : '')}
              onClick={() => musicStore.playAt(i)}
              title={t.name}
            >
              <span className="mt-ic">{i === index && playing ? '▶' : i === index ? '❚❚' : '♪'}</span>
              <span className="mt-name">{t.name}</span>
            </button>
          ))
        )}
      </div>

      <div
        className="music-seek"
        onPointerDown={onSeekDown}
        onPointerMove={onSeekMove}
        onPointerUp={onSeekUp}
        onPointerCancel={onSeekUp}
        role="presentation"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="music-seek-time">
        {track ? fmt(cur) + ' / ' + fmt(dur) : ''}
      </div>

      <div className="music-ops">
        <button className="music-btn" type="button" onClick={() => musicStore.prev()} disabled={tracks.length < 2} data-tip="上一首">
          ⏮
        </button>
        <button
          className="music-btn primary"
          type="button"
          onClick={() => musicStore.toggle()}
          disabled={!track}
          data-tip={playing ? '暂停' : '播放'}
        >
          {playing ? '⏸' : '▶'}
        </button>
        <button className="music-btn" type="button" onClick={() => musicStore.next()} disabled={tracks.length < 2} data-tip="下一首">
          ⏭
        </button>
        <button
          className={'music-btn mode' + (mode !== 'order' ? ' on' : '')}
          type="button"
          onClick={() => musicStore.cycleMode()}
          title="播放模式：顺序 / 单曲循环 / 随机，点击切换"
          data-tip={mode === 'order' ? '顺序播放（点击切换）' : mode === 'single' ? '单曲循环（点击切换）' : '随机播放（点击切换）'}
        >
          {mode === 'order' ? '顺序' : mode === 'single' ? '单曲' : '随机'}
        </button>
        <button className="music-btn" type="button" onClick={() => setShowPlaylist(true)} disabled={!loaded} data-tip="歌单">
          ▤
        </button>
      </div>

      <PlaylistModal open={showPlaylist} onClose={() => setShowPlaylist(false)} />

      <div className="music-vol">
        <span className="vol-label" data-tip="音量">♪</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={vol}
          onChange={(e) => musicStore.setVol(Number(e.target.value))}
          aria-label="音量"
        />
        <span>{Math.round(vol * 100)}%</span>
      </div>

      {error && <p className="music-hint" style={{ color: 'var(--danger)' }}>{error}</p>}
      <p className="music-hint">
        支持 mp3 / wav / m4a / flac / ogg 等浏览器可解码格式；文件只在本机播放，不会上传。
      </p>
    </section>
  )
}
