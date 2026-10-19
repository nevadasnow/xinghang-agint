/**
 * 终端执行（真执行，不是占位）。
 *
 * 设计要点：
 * - 零新依赖：只用 node 内置的 child_process.spawn。
 * - Windows 用 `powershell.exe -NoLogo -NoProfile -Command <cmd>`（规格要求），
 *   其它平台用 `$SHELL -c`。
 * - 输出**流式**推给发起请求的渲染进程：terminal:data（chunk = {id, stream, text}），
 *   不缓冲成整行，长任务的进度输出也能实时看到。
 * - 每次 run 一个独立进程，用 id 索引；kill(id) 终止**整棵进程树**
 *   （Windows 用 taskkill /T /F，否则 npm/vite 这类会留下孤儿进程）。
 * - 所有推送都带 isDestroyed() 守卫：窗口关掉后回调仍可能触发。
 */

import { spawn, spawnSync } from 'child_process'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import type { WebContents } from 'electron'
import { TERMINAL_DATA_CHANNEL, TERMINAL_EXIT_CHANNEL } from '../shared/events'
import type { TerminalDataEvent, TerminalExitEvent, TerminalRunResult } from '../shared/events'

/** 单个进程的上限保护：超过 20 万字符就丢弃（防止 `dir /s C:\` 打爆渲染层） */
const MAX_BUFFER = 200_000

interface ProcState {
  proc: ChildProcessWithoutNullStreams
  wc: WebContents
  sender: WebContents
  killed: boolean
  settled: boolean
  bytes: number
  startedAt: number
  killTimer?: number
  /** taskkill 是否成功带走整棵进程树（失败时只杀得掉直接子进程，退出事件里如实报告） */
  treeKillOk?: boolean
  treeKillError?: string
}

const procs = new Map<string, ProcState>()

/**
 * 让子进程按 UTF-8 解码输出。
 *
 * 中文 Windows 的控制台代码页默认是 936(GBK)，但 Node 在 `-Command` 模式下按 UTF-8
 * 解码管道，直接执行会得到乱码。这里在**子进程自己的作用域**里把输出编码设成 UTF-8
 * （同时覆盖 CHCP），不污染父进程环境（不调 chcp 也不改全局 code page）。
 */
const UTF8_PREFIX = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; '

/** cwd：优先用渲染层传来的路径，其次 process.cwd()；不存在则回落到 process.cwd() */
function resolveCwd(raw?: string): string {
  if (raw && raw.trim() && existsSync(raw)) return raw
  return process.cwd()
}

/**
 * 杀掉整棵进程树。
 *
 * Windows 首选 `taskkill /T /F`（能带走 npm/vite 这类子进程）；
 * 若 taskkill 不可用或没有权限（受限环境里会返回 "Access denied"），
 * 退化为 `proc.kill()`——至少把直接子进程收掉，并在退出事件里
 * 用 treeKillOk=false 如实告知渲染层「可能有残留子进程」。
 */
function killTree(state: ProcState): void {
  const { proc } = state
  const pid = proc.pid
  if (!pid || proc.exitCode !== null || proc.signalCode !== null) return
  state.killed = true

  if (process.platform === 'win32') {
    let ok = false
    let msg = ''
    try {
      const r = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        encoding: 'utf8'
      })
      ok = r.status === 0
      if (!ok) {
        // 受限环境里 taskkill 可能直接起不来（r.error：EPERM/ENOENT）或返回 Access denied（stderr）
        const errText = r.error ? `${r.error.name}/${(r.error as NodeJS.ErrnoException).code ?? ''}` : ''
        msg = [errText, String(r.stderr || '').trim(), r.status === null ? '' : `exit=${r.status}`]
          .filter(Boolean)
          .join(' ')
          .slice(0, 200)
      }
    } catch (e) {
      msg = (e as Error).message
    }
    state.treeKillOk = ok
    state.treeKillError = ok ? undefined : msg
    if (!ok) {
      // 退化：只杀直接子进程（taskkill 不可用时的唯一办法）
      try {
        proc.kill('SIGKILL')
      } catch {
        /* 已经退出了，忽略 */
      }
    }
    return
  }

  // detached: true 时子进程自成进程组，负 pid 可以整组带走
  try {
    process.kill(-pid, 'SIGTERM')
    state.treeKillOk = true
  } catch {
    try {
      proc.kill('SIGTERM')
      state.treeKillOk = false
    } catch {
      /* ignore */
    }
  }
  state.killTimer = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* ignore */
    }
  }, 2000) as unknown as number
}

function emit(state: ProcState, event: TerminalDataEvent | TerminalExitEvent): void {
  const channel = 'text' in event ? TERMINAL_DATA_CHANNEL : TERMINAL_EXIT_CHANNEL
  try {
    if (!state.sender.isDestroyed()) state.sender.send(channel, event)
  } catch {
    /* 渲染进程正在销毁，丢弃即可 */
  }
}

/** 启动一条命令。resolve 的 Promise 只表示「已拉起」，输出走事件通道 */
export function run(id: string, command: string, cwdRaw?: string, sender?: WebContents): Promise<TerminalRunResult> {
  const cmd = String(command ?? '').trim()
  if (!cmd) return Promise.resolve({ ok: false, error: '命令为空' })
  if (!sender || sender.isDestroyed()) return Promise.resolve({ ok: false, error: '渲染进程不可用' })

  const existing = procs.get(id)
  if (existing) {
    // 同一个 id 重复 run：先把旧进程收干净，避免两份输出串台
    killTree(existing)
    procs.delete(id)
  }

  const cwd = resolveCwd(cwdRaw)
  const isWin = process.platform === 'win32'

  return new Promise<TerminalRunResult>((resolve) => {
    let proc: ChildProcessWithoutNullStreams
    try {
      proc = isWin
        ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', UTF8_PREFIX + cmd], {
            cwd,
            windowsHide: true,
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
          })
        : spawn(process.env.SHELL || '/bin/sh', ['-c', cmd], { cwd, detached: true })
    } catch (e) {
      resolve({ ok: false, error: (e as Error).message })
      return
    }

    const state: ProcState = {
      proc,
      wc: sender,
      sender,
      killed: false,
      settled: false,
      bytes: 0,
      startedAt: Date.now()
    }
    procs.set(id, state)

    const push = (stream: 'stdout' | 'stderr', text: string): void => {
      if (!text) return
      if (state.bytes >= MAX_BUFFER) return
      state.bytes += text.length
      emit(state, { id, stream, text })
    }

    proc.stdout.setEncoding('utf8')
    proc.stderr.setEncoding('utf8')

    proc.stdout.on('data', (chunk: string) => push('stdout', chunk))
    proc.stderr.on('data', (chunk: string) => push('stderr', chunk))

    proc.on('error', (err: Error) => {
      push('stderr', `\n[启动失败] ${err.message}\n`)
    })

    const settle = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (state.settled) return
      state.settled = true
      if (state.killTimer !== undefined) clearTimeout(state.killTimer)
      procs.delete(id)
      emit(state, {
        id,
        exitCode,
        signal: signal ?? null,
        killed: state.killed,
        treeKillOk: state.treeKillOk,
        treeKillError: state.treeKillError,
        durationMs: Date.now() - state.startedAt
      })
    }

    proc.on('exit', (code, signal) => settle(code, signal))
    // 'exit' 之后 stdout 可能还有尾部数据；用 close 兜底（settle 有幂等保护）
    proc.on('close', (code, signal) => settle(code, signal))

    resolve({ ok: true, id, cwd })
  })
}

/** 终止指定 id 的进程树。返回是否真的找到了在跑的进程 */
export function kill(id: string): { ok: boolean } {
  const state = procs.get(id)
  if (!state) return { ok: false }
  killTree(state)
  return { ok: true }
}

/** 窗口关闭 / 应用退出时清场，避免留下孤儿进程 */
export function killAll(): void {
  for (const [id, state] of procs) {
    killTree(state)
    procs.delete(id)
  }
}
