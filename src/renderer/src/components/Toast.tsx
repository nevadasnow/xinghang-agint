import { useCallback, useState } from 'react'

type ToastKind = 'info' | 'ok' | 'err'

interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

/**
 * 极简 toast：给「复制成功 / 调用失败 / 设置已保存」这类瞬时反馈一个统一出口。
 *
 * 刻意不做全局单例 store —— 由使用方持有状态，避免在项目里塞进一个隐形的全局总线。
 * 用法：const toast = useToast()  → toast.ok('已保存')
 */
export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([])

  const push = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now() + Math.random()
    setItems((prev) => [...prev, { id, kind, text }])
    window.setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600)
  }, [])

  const api = {
    info: (text: string) => push('info', text),
    ok: (text: string) => push('ok', text),
    err: (text: string) => push('err', text)
  }

  const view = (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  )

  return { ...api, view }
}
