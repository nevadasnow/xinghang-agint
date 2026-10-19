import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 语音输入（D3）—— 浏览器内置语音识别（Web Speech API）
 *
 * 为什么用 Web Speech 而不是本地 Whisper：
 *   1) **零依赖**（用户定的硬约束），不需要下载模型权重
 *   2) Electron 里 `webkitSpeechRecognition` 可用（底层走系统/Google 识别）
 *   3) 本地 Whisper 要装 python 侧依赖并常驻进程，成本远高于收益
 *
 * 已知限制（如实告知用户，不假装能用）：
 *   - **需要联网**：Chromium 的语音识别多数组件在云端完成，不是纯离线
 *   - **可能不可用**：无麦克风、系统未授权、或构建里未编译语音组件时，
 *     构造 `SpeechRecognition` 会失败 → 这里返回 `supported: false`，UI 应隐藏按钮
 *   - 中文识别质量取决于服务端，专业术语容易错
 */

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((e: SpeechResultEventLike) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
}

interface SpeechResultEventLike {
  resultIndex: number
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >
}

type Ctor = new () => SpeechRecognitionLike

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: Ctor
    webkitSpeechRecognition?: Ctor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function useVoiceInput(onText: (text: string) => void): {
  supported: boolean
  listening: boolean
  error: string
  toggle: () => void
  stop: () => void
} {
  const [supported] = useState(() => getCtor() !== null)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  /** 已提交的最终文本；中间结果单独接，避免重复拼接 */
  const finalRef = useRef('')
  const onTextRef = useRef(onText)
  onTextRef.current = onText

  const stop = useCallback(() => {
    const r = recRef.current
    if (r) {
      try {
        r.stop()
      } catch {
        /* 已经停了 */
      }
    }
    setListening(false)
  }, [])

  useEffect(
    () => () => {
      const r = recRef.current
      if (r) {
        try {
          r.abort()
        } catch {
          /* ignore */
        }
      }
    },
    []
  )

  const toggle = useCallback(() => {
    if (listening) {
      stop()
      return
    }
    const Ctor = getCtor()
    if (!Ctor) {
      setError('当前环境不支持语音输入。')
      return
    }
    setError('')
    finalRef.current = ''
    let rec: SpeechRecognitionLike
    try {
      rec = new Ctor()
    } catch {
      setError('无法启动语音识别（可能缺少麦克风或语音组件）。')
      return
    }
    rec.lang = 'zh-CN'
    rec.continuous = true
    // 取中间结果：说话时就能看到字，体验好很多
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const txt = r[0]?.transcript ?? ''
        if (r.isFinal) finalRef.current += txt
        else interim += txt
      }
      // 把「已确定 + 正在识别」一起给上层，上层整体替换而不是追加，
      // 这样中间结果滚动时不会堆积重复文字
      onTextRef.current((finalRef.current + interim).trim())
    }
    rec.onerror = (ev) => {
      const code = ev?.error ?? 'unknown'
      const msg =
        code === 'not-allowed' || code === 'service-not-allowed'
          ? '麦克风权限被拒绝，请在系统设置里允许后再试。'
          : code === 'no-speech'
            ? '没有听到声音，再说一次试试。'
            : code === 'network'
              ? '语音识别需要联网，当前网络不可用。'
              : `语音识别出错（${code}）。`
      setError(msg)
      setListening(false)
    }
    rec.onend = () => setListening(false)

    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setError('无法启动语音识别。')
      setListening(false)
    }
  }, [listening, stop])

  return { supported, listening, error, toggle, stop }
}
