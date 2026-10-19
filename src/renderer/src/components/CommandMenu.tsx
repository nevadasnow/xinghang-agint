import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { AGENT_ROLE_LIST, getAgentRole, setAgentRole } from '../utils/agentRoles'
import { getEffectiveAgentAvatar } from '../utils/agentRoles'
import { musicStore } from '../state/musicStore'
import { useToast } from './Toast'

type CmdPage = 'home' | 'chat' | 'tasks' | 'agent' | 'docs' | 'memory'

interface CommandMenuProps {
  open: boolean
  onClose: () => void
  /** 页面跳转；newSession=true 表示切到对话页后新建会话 */
  onNavigate: (page: CmdPage, newSession?: boolean) => void
  onOpenSettings: () => void
}

/** 线条图标（治愈简约，随主题色） */
function Ic({ d }: { d: string }) {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  task: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6',
  db: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z M21 12c0 1.66-4 3-9 3s-9-1.34-9-3 M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  broom: 'M19 5L5 19 M13 3l8 8 M5 13l6 6 M7 21l14-14',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  music: 'M9 18V5l12-2v13 M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'
}

export default function CommandMenu({ open, onClose, onNavigate, onOpenSettings }: CommandMenuProps) {
  const toast = useToast()
  const snap = musicStore.getSnapshot()
  const currentRole = getAgentRole().id

  // Esc 关闭
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const go = (page: CmdPage, newSession = false) => {
    onNavigate(page, newSession)
  }

  const navItems: Array<{ key: string; label: string; ic: string; run: () => void }> = [
    { key: 'new', label: '新建对话', ic: 'chat', run: () => go('chat', true) },
    { key: 'home', label: '返回首页', ic: 'home', run: () => go('home') },
    { key: 'settings', label: '打开设置', ic: 'gear', run: onOpenSettings },
    { key: 'tasks', label: '打开任务', ic: 'task', run: () => go('tasks') },
    { key: 'docs', label: '打开文档', ic: 'file', run: () => go('docs') },
    { key: 'memory', label: '打开记忆库', ic: 'db', run: () => go('memory') },
    { key: 'agent', label: '打开 Agent 档案', ic: 'user', run: () => go('agent') }
  ]

  const toolItems: Array<{ key: string; label: string; ic: string; run: () => void }> = [
    {
      key: 'music',
      label: snap.playing ? '暂停音乐' : '播放音乐',
      ic: 'music',
      run: () => {
        musicStore.toggle()
        onClose()
      }
    },
    {
      key: 'library',
      label: '打开素材库文件夹',
      ic: 'folder',
      run: () => {
        void window.shorekeeper.assetsOpenDir().catch(() => toast.err('打开素材库失败'))
        toast.info('正在打开素材库文件夹')
        onClose()
      }
    },
    {
      key: 'cache',
      label: '清理语音合成缓存',
      ic: 'broom',
      run: () => {
        void window.shorekeeper
          .ttsCacheClear()
          .then(() => toast.ok('语音缓存已清理'))
          .catch(() => toast.err('清理失败'))
        onClose()
      }
    }
  ]

  return createPortal(
    <>
      {toast.view}
      <div className="command-menu" role="dialog" aria-label="命令面板" onClick={onClose}>
        <div className="command-menu-card" onClick={(e) => e.stopPropagation()}>
          <div className="command-menu-head">
            <span className="command-menu-title">命令</span>
            <button type="button" className="command-menu-x" onClick={onClose} aria-label="关闭命令面板" title="关闭（Esc）">
              ✕
            </button>
          </div>

          <div className="command-group">
            <div className="command-group-t">常用</div>
            <div className="command-grid">
              {navItems.map((it) => (
                <button key={it.key} type="button" className="command-item" onClick={it.run}>
                  <span className="command-ic" aria-hidden="true">
                    <Ic d={ICONS[it.ic as keyof typeof ICONS]} />
                  </span>
                  <span className="command-label">{it.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="command-group">
            <div className="command-group-t">角色</div>
            <div className="command-list">
              {AGENT_ROLE_LIST.map((r) => {
                const active = r.id === currentRole
                return (
                  <button
                    key={r.id}
                    type="button"
                    className={'command-role' + (active ? ' on' : '')}
                    onClick={() => {
                      if (!active) setAgentRole(r.id)
                      onClose()
                    }}
                  >
                    <img className="command-role-avatar" src={getEffectiveAgentAvatar(r.id)} alt="" />
                    <span className="command-role-name">{r.name}</span>
                    {active && <span className="command-role-check" aria-hidden="true">✓ 使用中</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="command-group">
            <div className="command-group-t">工具</div>
            <div className="command-list">
              {toolItems.map((it) => (
                <button key={it.key} type="button" className="command-item line" onClick={it.run}>
                  <span className="command-ic" aria-hidden="true">
                    <Ic d={ICONS[it.ic as keyof typeof ICONS]} />
                  </span>
                  <span className="command-label">{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>,
    document.body
  )
}
