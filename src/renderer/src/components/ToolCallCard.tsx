import { useState } from 'react'
import type { ToolCallTrace } from '../../../shared/types'

interface Props {
  call: ToolCallTrace
}

/** 工具名 → 风险色，沿用设置页的风险语义，让同一事务在界面里保持一致的视觉语言 */
const RISK_BY_PREFIX: Array<[RegExp, string]> = [
  [/^(run_|shell|execute)/, 'risk-shell'],
  [/^(write_|edit_|apply|str_replace|git_(commit|push|revert|init|switch))/, 'risk-fs-write'],
  [/^(read_|glob|grep|ls|list_|git_(status|diff|log))/, 'risk-read'],
  [/^(fetch_|web_|browser_|download_|search_|weather|translate)/, 'risk-network'],
  [/^(play_live2d|pop_quiz)/, 'risk-input']
]

function riskClass(name: string): string {
  for (const [re, cls] of RISK_BY_PREFIX) {
    if (re.test(name)) return cls
  }
  return 'risk-safe'
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return ''
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** 参数可能不是合法 JSON（模型偶尔给半截字符串），尽力美化，失败就原样展示 */
function prettyArgs(raw: string): string {
  if (!raw) return '（无参数）'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/**
 * 工具调用卡片。
 *
 * 设计意图：工具调用过去对用户完全不可见（只留下最终文本），
 * 现在每一次调用都有一张卡片，能看出「用了什么、参数是什么、返回什么、花了多久、是否失败」。
 * 默认折叠参数与结果，避免长输出淹没对话；运行中显示脉冲状态点。
 */
export default function ToolCallCard({ call }: Props) {
  const [open, setOpen] = useState(false)
  const running = call.state === 'running'
  const failed = call.state === 'failed'
  const stateClass = running ? 'running' : failed ? 'failed' : 'done'

  return (
    <div className={`tool-call ${stateClass} ${open ? 'open' : ''}`}>
      <button className="tool-call-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`tool-call-dot ${stateClass}`} aria-hidden="true" />
        <span className="tool-call-name" title={call.name}>
          {call.label ?? call.name}
        </span>
        <span className={`tool-call-risk ${riskClass(call.name)}`}>{call.name}</span>
        <span className="tool-call-meta">
          {running ? '执行中…' : failed ? '失败' : formatDuration(call.durationMs)}
        </span>
        <span className="tool-call-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <div className="tool-call-body">
          <div className="tool-call-section">
            <span className="tool-call-label">参数</span>
            <pre className="tool-call-pre">{prettyArgs(call.args)}</pre>
          </div>
          <div className="tool-call-section">
            <span className="tool-call-label">{running ? '结果（等待中）' : failed ? '结果（失败）' : '结果'}</span>
            <pre className="tool-call-pre">
              {running ? '…' : (call.result ?? '（无返回内容）')}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
