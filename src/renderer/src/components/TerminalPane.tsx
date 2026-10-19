import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { onTerminalCommand } from '../utils/terminalBus'
import type { TerminalDataEvent, TerminalExitEvent } from '../../../shared/events'

/**
 * 终端 tab（规格 5 三）。
 *
 * 这里只负责「显示 + 输入」：真正执行命令的是主进程 `main/terminal.ts`
 * （`child_process.spawn`，Windows 走 `powershell.exe -NoLogo -NoProfile -Command`），
 * 输出通过 `terminal:data` 流式回流，所以长命令的进度也能实时看到。
 *
 * 渲染层职责：
 *   - 输出区等宽字体、可滚动、贴底时自动滚到底（用户手动上滚时不抢滚动条）
 *   - stdout / stderr 不同颜色（stderr 偏红）
 *   - 输入行 Enter 执行、上下键翻命令历史（localStorage）
 *   - ✕ 终止当前进程（主进程会 taskkill 整棵进程树）
 */

const HISTORY_KEY = 'sk-terminal-history'
const NOTICE_KEY = 'sk-terminal-notice-seen'
/** 输出行上限：超出后从头丢弃，避免长命令把 DOM 撑爆 */
const MAX_LINES = 1500
const HISTORY_MAX = 60

interface Line {
  key: number
  kind: 'cmd' | 'stdout' | 'stderr' | 'meta'
  text: string
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr: unknown = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((v): v is string => typeof v === 'string').slice(-HISTORY_MAX)
  } catch {
    return []
  }
}

function saveHistory(list: string[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(-HISTORY_MAX)))
  } catch {
    /* 隐私模式 / 配额满：历史不是关键功能，静默降级 */
  }
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
  }
}

export default function TerminalPane() {
  const [lines, setLines] = useState<Line[]>([])
  const [running, setRunning] = useState(false)
  const [cwd, setCwd] = useState('')
  const [input, setInput] = useState('')
  /** 首次使用提示是否已确认（懒初始化，不在 effect 里 setState） */
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(NOTICE_KEY) === '1'
    } catch {
      return false
    }
  })

  /** 当前子进程 id（同时只会有一个前台命令，和真终端一致） */
  const currentId = useRef<string | null>(null)
  const lineKey = useRef(0)
  const history = useRef<string[]>(loadHistory())
  const histIdx = useRef<number>(-1)
  const draft = useRef('')
  /** 输出容器：用于贴底自动滚动与「用户是否在上滚」判定 */
  const outRef = useRef<HTMLDivElement>(null)
  const stickBottom = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)

  /**
   * E2：接收来自消息气泡的「在终端运行」请求。
   * autoRun 时把命令**作为参数**传给 exec，而不是先 setInput —— 后者是异步的，
   * 依赖它会导致执行到上一次的输入内容。
   */
  useEffect(
    () =>
      onTerminalCommand((req) => {
        if (req.autoRun) {
          void exec(req.command)
        } else {
          setInput(req.command)
          inputRef.current?.focus()
        }
      }),
    // exec 每次渲染都是新函数，但它读的是最新闭包；用 ref 兜住避免反复订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const append = useCallback((kind: Line['kind'], text: string) => {
    setLines((prev) => {
      const next = [...prev, { key: lineKey.current++, kind, text }]
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next
    })
  }, [])

  // 流式输出：每个 chunk 追加到自己那一行（保留换行，等宽下就是原样终端观感）
  useEffect(() => {
    return window.shorekeeper.onTerminalData((ev: TerminalDataEvent) => {
      if (ev.id !== currentId.current) return
      append(ev.stream === 'stderr' ? 'stderr' : 'stdout', ev.text)
    })
  }, [append])

  useEffect(() => {
    return window.shorekeeper.onTerminalExit((ev: TerminalExitEvent) => {
      if (ev.id !== currentId.current) return
      currentId.current = null
      setRunning(false)
      const secs = (ev.durationMs / 1000).toFixed(2)
      if (ev.killed) {
        append('meta', `— 已终止（${secs}s）—`)
        if (ev.treeKillOk === false) {
          append(
            'meta',
            `注意：未能终止整棵进程树（${ev.treeKillError || 'taskkill 不可用'}），只结束了直接子进程，可能有残留。`
          )
        }
      } else {
        append('meta', `— 进程结束，退出码 ${ev.exitCode ?? 'null'}（${secs}s）—`)
      }
    })
  }, [append])

  // 自动滚底：只在用户本来就贴着底部时跟随，避免读历史输出时被拉走
  useEffect(() => {
    const el = outRef.current
    if (!el || !stickBottom.current) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  function onScroll(): void {
    const el = outRef.current
    if (!el) return
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  /**
   * 执行命令。
   *
   * @param explicit 显式命令。**必须支持这个参数**：E2 的「在终端运行」
   *   需要立刻执行一条命令，而 `setInput(cmd)` 是异步的——
   *   若依赖 input 状态，这一步会执行到上一次的内容。
   */
  async function exec(explicit?: string): Promise<void> {
    const cmd = (explicit ?? input).trim()
    if (!cmd || running) return
    setInput('')
    histIdx.current = -1
    draft.current = ''
    history.current = [...history.current.filter((h) => h !== cmd), cmd].slice(-HISTORY_MAX)
    saveHistory(history.current)

    append('cmd', `PS> ${cmd}`)
    stickBottom.current = true

    const id = newId()
    currentId.current = id
    setRunning(true)
    try {
      const res = await window.shorekeeper.terminalRun(id, cmd)
      if (!res.ok) {
        currentId.current = null
        setRunning(false)
        append('stderr', `[无法执行] ${res.error ?? '未知错误'}\n`)
        return
      }
      setCwd(res.cwd ?? '')
    } catch (e) {
      currentId.current = null
      setRunning(false)
      append('stderr', `[无法执行] ${(e as Error).message}\n`)
    } finally {
      inputRef.current?.focus()
    }
  }

  async function stop(): Promise<void> {
    const id = currentId.current
    if (!id) return
    append('meta', '— 正在终止进程树…… —')
    try {
      await window.shorekeeper.terminalKill(id)
    } catch {
      /* 进程可能刚好自己结束了 */
    }
  }

  /** 上下键翻历史（真终端语义：下到最后回到当前草稿） */
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void exec()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const h = history.current
      if (h.length === 0) return
      if (histIdx.current === -1) {
        draft.current = input
        histIdx.current = h.length - 1
      } else if (histIdx.current > 0) {
        histIdx.current -= 1
      }
      setInput(h[histIdx.current] ?? '')
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const h = history.current
      if (histIdx.current === -1) return
      if (histIdx.current < h.length - 1) {
        histIdx.current += 1
        setInput(h[histIdx.current] ?? '')
      } else {
        histIdx.current = -1
        setInput(draft.current)
      }
    }
  }

  const cwdLabel = useMemo(() => cwd || '（默认：应用工作目录）', [cwd])

  return (
    <div className="rp-term">
      {!seen && (
        <div className="rp-term-notice">
          <span className="rp-term-notice-ic" aria-hidden="true">
            ⚠
          </span>
          <span>命令在本机真实执行，请自行确认内容后再回车。</span>
          <button
            type="button"
            className="rp-term-notice-x"
            title="知道了"
            onClick={() => {
              setSeen(true)
              try {
                localStorage.setItem(NOTICE_KEY, '1')
              } catch {
                /* ignore */
              }
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div className="rp-term-out" ref={outRef} onScroll={onScroll}>
        {lines.length === 0 ? (
          <div className="rp-term-hint">
            <p className="rp-term-hint-t">终端已就绪</p>
            <p className="rp-term-hint-d">
              命令由主进程 <code>child_process.spawn</code> 执行（Windows 走{' '}
              <code>powershell.exe -NoProfile</code>），输出实时回流。
            </p>
            <p className="rp-term-hint-d">
              试试 <code>echo hello</code> · <code>Get-Location</code> · <code>node -v</code>
              <br />
              上/下方向键翻历史命令。
            </p>
          </div>
        ) : (
          lines.map((l) => (
            <div key={l.key} className={`rp-term-line ${l.kind}`}>
              {l.text}
            </div>
          ))
        )}
      </div>

      <div className="rp-term-bar">
        <span className="rp-term-cwd" title={cwdLabel}>
          {cwdLabel}
        </span>
        {running && (
          <button type="button" className="rp-term-stop" title="终止当前进程树" onClick={() => void stop()}>
            ✕ 终止
          </button>
        )}
        {running && <span className="rp-term-run">运行中…</span>}
      </div>

      <div className="rp-term-in">
        <span className="rp-term-ps" aria-hidden="true">
          PS&gt;
        </span>
        <input
          ref={inputRef}
          value={input}
          spellCheck={false}
          autoComplete="off"
          placeholder={running ? '等待当前命令结束，或点「终止」……' : '输入命令后回车……'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="rp-term-send"
          disabled={running || !input.trim()}
          onClick={() => void exec()}
          title="执行（Enter）"
        >
          执行
        </button>
      </div>
    </div>
  )
}
