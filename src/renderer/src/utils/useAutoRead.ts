import { useCallback, useEffect, useRef, useState } from 'react'
import { currentDayPart } from './uiPrefs'

/**
 * 自动朗读播放（D1）
 *
 * 职责边界刻意做窄：这里只负责"把一段文本变成声音并播放"，
 * 不做文本处理（清理在主进程 tts.ts 的 cleanForSpeech 里，
 * 保证送进 TTS 的和界面显示的可以不一致，而界面不受影响）。
 *
 * 行为约束（避免聊天时被朗读淹没）：
 *   - 同一时刻只播一段：新的朗读会打断上一段
 *   - 代码块/标记清理后为空则跳过，不报错
 *   - 失败只记一次错误供 UI 显示，不弹窗、不阻断对话
 */
export interface AutoReadPlayback {
  /** 语速（playbackRate，IndexTTS 细节调整） */
  rate?: number
  /** 音量（0–1，IndexTTS 细节调整） */
  volume?: number
}

export function useAutoRead(): {
  speak: (text: string, playback?: AutoReadPlayback) => void
  stop: () => void
  speaking: boolean
  error: string
  clearError: () => void
} {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState('')
  /** 每次朗读递增；异步返回时若已过期就丢弃，避免连点导致串音 */
  const seqRef = useRef(0)

  const stop = useCallback(() => {
    seqRef.current++
    const a = audioRef.current
    if (a) {
      a.pause()
      audioRef.current = null
    }
    setSpeaking(false)
  }, [])

  useEffect(() => () => stop(), [stop])

  const speak = useCallback(
    (text: string, playback?: AutoReadPlayback) => {
      const raw = (text ?? '').trim()
      if (!raw) return
      const seq = ++seqRef.current
      // 打断上一段
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      setError('')
      setSpeaking(true)

      void window.shorekeeper
        .ttsSpeak(raw, currentDayPart())
        .then((res) => {
          if (seq !== seqRef.current) return // 已被新的朗读取代
          if (!res?.ok || !res.dataUrl) {
            setSpeaking(false)
            setError(res?.error || '语音合成失败')
            return
          }
          const audio = new Audio(res.dataUrl)
          if (playback?.rate && playback.rate > 0) audio.playbackRate = Math.min(2, Math.max(0.5, playback.rate))
          if (playback?.volume !== undefined) audio.volume = Math.min(1, Math.max(0, playback.volume))
          audioRef.current = audio
          audio.onended = () => {
            if (seq === seqRef.current) setSpeaking(false)
          }
          audio.onerror = () => {
            if (seq === seqRef.current) {
              setSpeaking(false)
              setError('音频播放失败')
            }
          }
          void audio.play().catch(() => {
            if (seq === seqRef.current) {
              setSpeaking(false)
              setError('浏览器拒绝了自动播放，请再点一次。')
            }
          })
        })
        .catch((e: unknown) => {
          if (seq !== seqRef.current) return
          setSpeaking(false)
          setError((e as Error)?.message || '语音合成失败')
        })
    },
    []
  )

  return { speak, stop, speaking, error, clearError: () => setError('') }
}
