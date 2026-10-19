import { useEffect, useState } from 'react'
import { AGENT_ROLES, AGENT_ROLE_LIST, getAgentRole, setAgentRole, type AgentRoleId } from '../utils/agentRoles'
import { getTheme } from '../utils/uiPrefs'

/** 当前 agent 已真实接入的能力清单（对照 tools.ts 工具目录与主进程实现） */
const CAPABILITIES: Array<{ ic: string; name: string; desc: string }> = [
  { ic: '◈', name: '对话与陪伴', desc: '聊天 / Agent 双模式，多轮记忆上下文延续' },
  { ic: '⚙', name: '工具调用', desc: '内置浏览器、终端与工作区文件，agent 可实际执行' },
  { ic: '▤', name: '任务管理', desc: '创建任务、执行进度、截止提醒，与对话联动' },
  { ic: '♒', name: '记忆库', desc: '你手写的记忆条目，会在对话时自动注入给 agent' },
  { ic: '◗', name: '语音朗读', desc: 'IndexTTS 克隆音色，逐字回复 + 语音同步' },
  { ic: '♫', name: '音乐陪伴', desc: '全局播放器与快捷键，歌单随机 / 单曲循环' },
  { ic: '☀', name: '主动关怀', desc: '本地规则判断，不说空话的问候与提醒' }
]

interface AgentPanelProps {
  open: boolean
  onClose: () => void
}

/** Agent 档案：当前角色人设卡 + 角色切换 + 能力清单（左侧栏 ⚉ Agent 入口） */
export default function AgentPanel({ open, onClose }: AgentPanelProps) {
  const [roleId, setRoleId] = useState<AgentRoleId>(() => getAgentRole().id)
  const [, setTick] = useState(0)

  useEffect(() => {
    const onRole = (): void => {
      setRoleId(getAgentRole().id)
      setTick((n) => n + 1)
    }
    window.addEventListener('sk:agent-role', onRole)
    return () => window.removeEventListener('sk:agent-role', onRole)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const current = AGENT_ROLES[roleId]
  const themeNow = getTheme()

  return (
    <div className="modal-mask agent-panel-mask" onClick={onClose}>
      <div className="modal panel agent-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Agent 档案</span>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="agent-panel-body">
          {/* 当前角色大卡 */}
          <div className="agent-hero">
            <div className="agent-hero-avatar">
              <img src={current.avatar} alt={current.name} />
            </div>
            <div className="agent-hero-meta">
              <div className="agent-hero-name">{current.name}</div>
              <div className="agent-hero-en">{roleId === 'kindmita' ? 'KIND MITA' : roleId === 'mornye' ? 'MORNYE' : roleId === 'silverwolf' ? 'SILVER WOLF' : 'SHOREKEEPER'}</div>
              <div className="agent-hero-tags">
                <span className="agent-tag">📍 {current.location}</span>
                <span className="agent-tag">🎨 主题 {current.defaultTheme === 'sky' ? '守岸蓝' : current.defaultTheme === 'mita' ? '米塔紫' : current.defaultTheme === 'silverwolf' ? '银狼紫' : '星炬紫'}</span>
                {themeNow === current.defaultTheme && <span className="agent-tag current">当前使用中</span>}
              </div>
            </div>
          </div>

          {/* 角色切换 */}
          <div className="agent-switch-title">选择陪伴你的角色</div>
          <div className="agent-switch-grid">
            {AGENT_ROLE_LIST.map((r) => {
              const active = r.id === roleId
              return (
                <button
                  key={r.id}
                  type="button"
                  className={'agent-switch-card' + (active ? ' on' : '')}
                  onClick={() => {
                    if (!active) setAgentRole(r.id as AgentRoleId)
                  }}
                >
                  <img className="agent-switch-avatar" src={r.avatar} alt={r.name} />
                  <div className="agent-switch-info">
                    <div className="agent-switch-name">{r.name}</div>
                    <div className="agent-switch-loc">{r.location}</div>
                  </div>
                  {active && <span className="agent-switch-check">✓</span>}
                </button>
              )
            })}
          </div>

          {/* 能力清单 */}
          <div className="agent-caps-title">当前已接入的能力</div>
          <div className="agent-caps">
            {CAPABILITIES.map((c) => (
              <div key={c.name} className="agent-cap">
                <span className="agent-cap-ic" aria-hidden="true">
                  {c.ic}
                </span>
                <div className="agent-cap-text">
                  <div className="agent-cap-name">{c.name}</div>
                  <div className="agent-cap-desc">{c.desc}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="agent-footnote">
            切换角色后：名字 / 头像 / 主题 / 招呼词 / 语音参考音频都会同步切换；对话存档保持各自角色不变。
          </p>
        </div>
      </div>
    </div>
  )
}
