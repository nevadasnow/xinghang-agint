import { useSyncExternalStore } from 'react'
import type { MusicTrack } from '../../../shared/types'

/**
 * 全局音乐播放器（单例 Audio，首页播放器与左侧栏音乐区共享同一实例）。
 *
 * 曲库来源：主进程扫描「工程根/背景音乐」目录，经 skmusic:// 协议播放。
 * 状态：tracks / index / playing / vol / dur / cur，全部在此维护并对外暴露；
 * 组件用 useMusic() 订阅（useSyncExternalStore）。
 *
 * 注意：getSnapshot 必须返回「缓存引用」（state 变化时才重建），
 * 否则 React 认为快照永远在变，会无限重渲染导致白屏。
 */

export type PlayMode = 'order' | 'single' | 'shuffle'

export interface MusicSnapshot {
  tracks: MusicTrack[]
  index: number
  /** 当前曲目（无则 null） */
  track: MusicTrack | null
  playing: boolean
  vol: number
  dur: number
  cur: number
  /** 曲库是否已加载（首次扫描前为 false，用于占位提示） */
  loaded: boolean
  error: string
  /** 播放模式：order 顺序循环 / single 单曲循环 / shuffle 随机播放 */
  mode: PlayMode
}

class MusicStore {
  private tracks: MusicTrack[] = []
  private index = -1
  private playing = false
  private vol = 0.8
  private dur = 0
  private cur = 0
  private loaded = false
  private error = ''
  private mode: PlayMode = 'order'
  private readonly audio: HTMLAudioElement
  private readonly listeners = new Set<() => void>()
  private busy = false
  private lastCur = -1
  private snapshot: MusicSnapshot = {
    tracks: [],
    index: -1,
    track: null,
    playing: false,
    vol: 0.8,
    dur: 0,
    cur: 0,
    loaded: false,
    error: '',
    mode: 'order'
  }

  constructor() {
    this.audio = new Audio()
    this.audio.volume = this.vol
    this.audio.preload = 'metadata'
    this.audio.addEventListener('loadedmetadata', () => {
      this.dur = Number.isFinite(this.audio.duration) ? this.audio.duration : 0
      this.notify()
    })
    this.audio.addEventListener('timeupdate', () => {
      this.cur = this.audio.currentTime
      if (Math.abs(this.cur - this.lastCur) > 0.15) {
        this.lastCur = this.cur
        this.notify()
      }
    })
    this.audio.addEventListener('ended', () => {
      // 单曲循环：重播当前；否则按模式切下一首
      if (this.mode === 'single' && this.tracks[this.index]) {
        this.audio.currentTime = 0
        this.cur = 0
        void this.audio
          .play()
          .then(() => (this.playing = true))
          .catch(() => (this.playing = false))
        this.notify()
      } else {
        this.next(true)
      }
    })
    this.audio.addEventListener('error', () => {
      this.error = '这个音频格式当前无法解码，请换一个文件。'
      this.playing = false
      this.notify()
    })
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): MusicSnapshot => this.snapshot

  private buildSnapshot(): void {
    this.snapshot = {
      tracks: this.tracks,
      index: this.index,
      track: this.index >= 0 ? (this.tracks[this.index] ?? null) : null,
      playing: this.playing,
      vol: this.vol,
      dur: this.dur,
      cur: this.cur,
      loaded: this.loaded,
      error: this.error,
      mode: this.mode
    }
  }

  private notify(): void {
    this.buildSnapshot()
    this.listeners.forEach((fn) => fn())
  }

  /** 扫描曲库（幂等：已有曲目不重复扫描） */
  async loadTracks(force = false): Promise<void> {
    if (this.loaded && !force) return
    try {
      const list = await window.shorekeeper.listMusic()
      this.tracks = list
      this.loaded = true
      this.error = ''
      if (this.tracks.length > 0 && this.index < 0) {
        this.index = 0
        this.prepare(0, false)
      }
      this.notify()
    } catch (e) {
      this.error = `曲库扫描失败：${e instanceof Error ? e.message : String(e)}`
      this.notify()
    }
  }

  /** 加载第 i 首并播放 */
  playAt(i: number): void {
    if (i < 0 || i >= this.tracks.length) return
    this.index = i
    this.prepare(i, true)
  }

  private prepare(i: number, autoplay: boolean): void {
    const t = this.tracks[i]
    if (!t) return
    this.busy = true
    this.error = ''
    this.dur = 0
    this.cur = 0
    this.lastCur = -1
    this.audio.src = t.url
    this.audio.load()
    const doPlay = (): void => {
      void this.audio
        .play()
        .then(() => {
          this.playing = true
        })
        .catch((e: unknown) => {
          this.playing = false
          if (e instanceof Error && e.name === 'NotAllowedError') {
            this.error = '浏览器未允许自动播放，点一下播放按钮即可。'
          }
        })
        .finally(() => {
          this.busy = false
          this.notify()
        })
    }
    if (autoplay) {
      const once = (): void => {
        this.audio.removeEventListener('canplay', once)
        doPlay()
      }
      this.audio.addEventListener('canplay', once)
      window.setTimeout(() => {
        this.audio.removeEventListener('canplay', once)
        if (!this.playing && !this.busy && this.index === i) doPlay()
      }, 3000)
    }
    this.notify()
  }

  toggle(): void {
    const t = this.tracks[this.index]
    if (!t) return
    if (this.playing) {
      this.audio.pause()
      this.playing = false
    } else {
      if (this.audio.src && this.audio.currentTime > 0 && this.audio.readyState > 0) {
        void this.audio
          .play()
          .then(() => (this.playing = true))
          .catch(() => (this.playing = false))
      } else {
        this.prepare(this.index, true)
        return
      }
    }
    this.notify()
  }

  /** 停止（暂停并回到开头） */
  stop(): void {
    if (!this.tracks[this.index]) return
    this.audio.pause()
    this.audio.currentTime = 0
    this.playing = false
    this.cur = 0
    this.notify()
  }

  /** 上一首 / 下一首；autoNext 供 ended 事件循环使用 */
  next(autoNext = false): void {
    if (this.tracks.length === 0) return
    if (this.mode === 'single') {
      // 单曲循环：手动点下一首也重播当前（与 ended 行为一致）
      this.prepare(this.index, true)
      if (autoNext) this.notify()
      return
    }
    let n: number
    if (this.mode === 'shuffle') {
      if (this.tracks.length === 1) {
        n = this.index
      } else {
        do {
          n = Math.floor(Math.random() * this.tracks.length)
        } while (n === this.index)
      }
    } else {
      n = (this.index + 1) % this.tracks.length
    }
    this.index = n
    this.prepare(n, true)
    if (autoNext) this.notify()
  }

  prev(): void {
    if (this.tracks.length === 0) return
    if (this.cur > 3) {
      this.audio.currentTime = 0
      this.cur = 0
      this.notify()
      return
    }
    let n: number
    if (this.mode === 'shuffle' && this.tracks.length > 1) {
      do {
        n = Math.floor(Math.random() * this.tracks.length)
      } while (n === this.index)
    } else if (this.mode === 'single') {
      n = this.index
    } else {
      n = (this.index - 1 + this.tracks.length) % this.tracks.length
    }
    this.index = n
    this.prepare(n, true)
  }

  /** 切换播放模式：order → single → shuffle → order 循环 */
  cycleMode(): void {
    this.mode = this.mode === 'order' ? 'single' : this.mode === 'single' ? 'shuffle' : 'order'
    this.notify()
  }

  /** 直接设置播放模式 */
  setMode(m: PlayMode): void {
    if (m !== this.mode) {
      this.mode = m
      this.notify()
    }
  }

  setVol(v: number): void {
    this.vol = Math.min(1, Math.max(0, v))
    this.audio.volume = this.vol
    this.notify()
  }

  seek(t: number): void {
    if (!this.tracks[this.index]) return
    this.audio.currentTime = t
    this.cur = t
    this.notify()
  }
}

export const musicStore = new MusicStore()

/** 组件订阅入口：返回当前快照（引用稳定，仅状态变化时更新） */
export function useMusic(): MusicSnapshot {
  return useSyncExternalStore(musicStore.subscribe, musicStore.getSnapshot)
}
