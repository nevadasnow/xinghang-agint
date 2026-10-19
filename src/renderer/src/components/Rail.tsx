import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import ButterflyMark from './ButterflySymbol'
import RailMusic from './RailMusic'
import { getUserProfile } from '../utils/uiPrefs'
import { getAgentRole } from '../utils/agentRoles'

export type RailKey = 'home' | 'chat' | 'memory' | 'tasks' | 'agent' | 'docs' | 'skills' | 'panel'

interface RailProps {
  /** 当前高亮项：对话页默认 'chat'，首页传 'home' */
  active?: RailKey
  onHome: () => void
  /** 点「对话」进入对话界面；缺省时回落到 onHome */
  onChat?: () => void
  /** 切换右侧文档抽屉（对话页）；不传时该项不渲染 */
  onToggleDocs?: () => void
  /** 切换右侧记忆抽屉（对话页）；不传时该项不渲染 */
  onToggleMemory?: () => void
  /**
   * 打开右侧可调面板（工作区文件 / 终端 / 浏览器）。
   * 面板被「✕ 关闭」后，这里是唯一的重新入口，所以不接受缺省。
   */
  onToggleRightPanel?: () => void
  /** 右侧面板当前是否可见（用于高亮 + 提示文案） */
  rightPanelOpen?: boolean
  onSkills?: () => void
  onSettings: () => void
  /** 左栏左下角用户区选项卡「用户信息」：打开用户信息界面 */
  onOpenProfile?: () => void
  /** 点「Agent」打开 Agent 档案（App 层全局面板）；缺省回落到 onHome */
  onAgent?: () => void
  /** 会话计数徽章（对话页传 sessions.length） */
  chatCount?: number
  /** 任务计数徽章；不传则不显示徽章 */
  taskCount?: number
  /** 点「任务」进入任务管理页；缺省时回落到 onHome */
  onTasks?: () => void
  /** 左下角「命令」：打开命令面板；缺省时回落到 onSettings */
  onCommand?: () => void
}

interface NavItem {
  key: RailKey
  ic: ReactNode
  label: string
  onClick: () => void
  badge?: number
}

/**
 * 左侧栏（216px 带文字标签 + 可折叠分组的导航栏）。
 * 结构：蝴蝶 logo / 守岸人 · SHOREKEEPER / 收缩按钮
 *   ▾ 导航：首页 对话 记忆 任务 Agent
 *   ▾ 工作区：文档 技能
 *   ─── 底部：命令 / 设置
 *
 * 选中态：渐变底 + inset 描边 + 左侧 3px 光条（.rail-item.on::before，left:-12px）。
 * 窄窗口由 chat.css / home.css 的 @media 收窄或隐藏文字。
 * 左下角用户区：展开态向上弹出选项卡；收纳态（收缩/窄窗口）仅头像，
 * 单击通过 createPortal 向右上弹出完整卡片（同背景音乐弹窗模式，任何面板挡不住）。
 */
/** 角色 id → 英文名（左侧栏品牌副标题，随角色切换） */
function roleEnOf(id?: string): string {
  const map: Record<string, string> = { shorekeeper: 'SHOREKEEPER', mornye: 'MORNYE', kindmita: 'KIND MITA', silverwolf: 'SILVER WOLF' }
  return map[id ?? ''] ?? 'SHOREKEEPER'
}

export default function Rail({
  active = 'chat',
  onHome,
  onChat,
  onToggleDocs,
  onToggleMemory,
  onToggleRightPanel,
  rightPanelOpen,
  onAgent,
  onSkills,
  onSettings,
  onOpenProfile,
  chatCount,
  taskCount,
  onTasks,
  onCommand
}: RailProps) {
  /** 两个分组的开合状态，默认都展开 */
  const [navOpen, setNavOpen] = useState(true)
  const [wsOpen, setWsOpen] = useState(true)
  /** 收缩按钮：先只做视觉状态（窄窗口由 CSS 自动降级） */
  const [tight, setTight] = useState(false)
  /** 用户主动「展开」的覆盖标记：窗口再窄也强制恢复 216px 完整侧栏（见 CSS .rail.wide） */
  const [wide, setWide] = useState(false)
  /**
   * 当前角色。
   * 原先这里直接写 getAgentRole().name —— 只读一次，切换角色后左栏名字不会更新
   *（Home / Chat 都订阅了 sk:agent-role，唯独 Rail 没订阅）。
   */
  const [roleName, setRoleName] = useState(() => getAgentRole().name)
  /** 角色英文名：SHOREKEEPER / MORNYE，随角色切换同步（订阅同一事件） */
  const [roleEn, setRoleEn] = useState(() => roleEnOf(getAgentRole().id))
  useEffect(() => {
    const onRole = (): void => {
      const r = getAgentRole()
      setRoleName(r.name)
      setRoleEn(roleEnOf(r.id))
    }
    window.addEventListener('sk:agent-role', onRole)
    return () => window.removeEventListener('sk:agent-role', onRole)
  }, [])

  /** 左下角用户信息选项卡 */
  const [profileOpen, setProfileOpen] = useState(false)
  const [profile, setProfile] = useState(() => getUserProfile())
  /** 收纳态弹出卡片位置（视口坐标，fixed 定位） */
  const [popPos, setPopPos] = useState<{ left: number; top: number } | null>(null)
  /** 实际容器宽度：< 100px 视为收纳态（覆盖 tight prop 与 CSS 媒体查询两种收窄路径） */
  const [narrow, setNarrow] = useState(false)

  const profileRef = useRef<HTMLDivElement | null>(null)
  const userBtnRef = useRef<HTMLButtonElement | null>(null)
  const railRef = useRef<HTMLElement | null>(null)

  // 观察 rail 宽度，自动切换收纳态
  useEffect(() => {
    const el = railRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setNarrow(el.clientWidth < 100)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 窗口足够宽时取消「强制展开」覆盖（回到默认 216px 常态）
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1421px)')
    const on = (e: MediaQueryListEvent): void => {
      if (e.matches) setWide(false)
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  // 用户资料被保存后实时刷新（sk:user-profile-changed 由保存方 dispatch）
  useEffect(() => {
    function refresh(): void {
      setProfile(getUserProfile())
    }
    window.addEventListener('sk:user-profile-changed', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('sk:user-profile-changed', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  // 点选项卡以外的区域自动关闭（portal 弹出的卡片也算「内部」）
  useEffect(() => {
    if (!profileOpen) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      const inSelf = profileRef.current ? profileRef.current.contains(target) : false
      const inPop = document.querySelector('.rail-user-pop')?.contains(target) ?? false
      if (!inSelf && !inPop) setProfileOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [profileOpen])

  const iconOnly = tight || narrow

  /** 用户区点击：收纳态记录图标视口位置，向右上弹出（fixed，无视 rail 层级） */
  function toggleProfile(): void {
    if (iconOnly) {
      const r = userBtnRef.current?.getBoundingClientRect()
      if (r) setPopPos({ left: r.right + 10, top: r.bottom })
    }
    setProfileOpen((v) => !v)
  }

  function renderItem(item: NavItem) {
    return (
      <button
        key={item.key}
        type="button"
        className={'rail-item' + (active === item.key ? ' on' : '')}
        onClick={item.onClick}
        title={item.label}
      >
        <span className="ic" aria-hidden="true">
          {item.ic}
        </span>
        <span className="l">{item.label}</span>
        {typeof item.badge === 'number' && item.badge > 0 && (
          <span className="badge">{item.badge}</span>
        )}
      </button>
    )
  }

  const nav: NavItem[] = [
    { key: 'home', ic: '◈', label: '首页', onClick: onHome },
    {
      key: 'chat',
      ic: (
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
      ),
      label: '对话',
      onClick: onChat ?? onHome,
      badge: chatCount
    },
    {
      key: 'tasks',
      ic: (
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 11 12 14 22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
      ),
      label: '任务',
      onClick: onTasks ?? onHome,
      badge: taskCount
    },
    {
      key: 'agent',
      ic: (
        <svg width="1.15em" height="1.15em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
      ),
      label: 'Agent',
      onClick: onAgent ?? onHome
    }
  ]

  const workspace: NavItem[] = [
    {
      key: 'docs',
      ic: (
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
      ),
      label: '文档',
      onClick: onToggleDocs ?? onHome
    },
    {
      key: 'memory',
      ic: (
        <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" /><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" /></svg>
      ),
      label: '记忆库',
      onClick: onToggleMemory ?? onHome
    }
  ]

  return (
    <nav className={'rail' + (tight ? ' tight' : '') + (wide ? ' wide' : '')} ref={railRef} aria-label="主导航">
      <div className="rail-head">
        <button className="rail-logo" onClick={onHome} title="返回首页" aria-label="返回首页">
          <ButterflyMark width={27} className="" />
        </button>
        <div className="rail-brand">
          <div className="rail-name">{roleName}</div>
          <div className="rail-sub">{roleEn}</div>
        </div>
        <button
          type="button"
          className="rail-fold"
          onClick={() => {
            if (tight) {
              setTight(false)
              setWide(true) // 手动展开：窄窗口下也强制恢复完整侧栏
            } else {
              setTight(true)
              setWide(false)
            }
          }}
          title={tight ? '展开侧栏' : '收缩侧栏'}
          aria-label={tight ? '展开侧栏' : '收缩侧栏'}
        >
          {tight ? '▸' : '▾'}
        </button>
      </div>

      <div className={'fold' + (navOpen ? ' open' : '')}>
        <button type="button" className="fold-head" onClick={() => setNavOpen((v) => !v)}>
          <span className="cv">▸</span>
          导航
        </button>
        <div className="fold-body">{nav.map(renderItem)}</div>
      </div>

      <div className={'fold' + (wsOpen ? ' open' : '')}>
        <button type="button" className="fold-head" onClick={() => setWsOpen((v) => !v)}>
          <span className="cv">▸</span>
          工作区
        </button>
        <div className="fold-body">{workspace.map(renderItem)}</div>
      </div>

      <div className="rail-sp" />

      {/* 背景音乐区：命令上方（展开态完整控制；收纳态仅图标） */}
      <RailMusic tight={tight} />

      {/* 左下角用户信息区：头像 + 名称，单击向上/向右上展开选项卡 */}
      <div className="rail-user" ref={profileRef}>
        <button
          ref={userBtnRef}
          type="button"
          className={'rail-user-btn' + (profileOpen ? ' on' : '')}
          onClick={toggleProfile}
          title={profile.name}
        >
          <span className="rail-user-avatar">
            {profile.avatar ? <img src={profile.avatar} alt="用户头像" /> : <span className="rail-user-avatar-d">👤</span>}
          </span>
          <span className="rail-user-name">{profile.name}</span>
        </button>

        {!iconOnly && profileOpen && (
          <div className="profile-pop" onClick={(e) => e.stopPropagation()}>
            <div className="profile-pop-head">
              <span className="profile-pop-avatar">
                {profile.avatar ? <img src={profile.avatar} alt="用户头像" /> : <span className="rail-user-avatar-d">👤</span>}
              </span>
              <div className="profile-pop-meta">
                <div className="profile-pop-name">{profile.name}</div>
                <div className="profile-pop-sub">本机用户 · 数据仅保存在本地</div>
              </div>
            </div>
            <button
              type="button"
              className="profile-pop-item"
              onClick={() => {
                setProfileOpen(false)
                onOpenProfile?.()
              }}
            >
              <span className="profile-pop-ic" aria-hidden="true">◉</span>用户信息
            </button>
          </div>
        )}

        {iconOnly &&
          profileOpen &&
          popPos &&
          createPortal(
            <div className="rail-user-pop" style={{ left: popPos.left, top: popPos.top }}>
              <div className="rail-user-pop-head">
                <span className="rail-user-pop-avatar">
                  {profile.avatar ? <img src={profile.avatar} alt="用户头像" /> : <span className="rail-user-pop-d">👤</span>}
                </span>
                <div className="rail-user-pop-meta">
                  <div className="rail-user-pop-name">{profile.name}</div>
                  <div className="rail-user-pop-sub">本机用户 · 数据仅保存在本地</div>
                </div>
              </div>
              <button
                type="button"
                className="rail-user-pop-item"
                onClick={() => {
                  setProfileOpen(false)
                  onOpenProfile?.()
                }}
              >
                <span className="rail-user-pop-ic" aria-hidden="true">◉</span>用户信息
              </button>
            </div>,
            document.body
          )}
      </div>

      <div className="rail-foot">
        <button type="button" className="rail-item" onClick={onCommand ?? onSettings} title="命令">
          <span className="ic" aria-hidden="true">
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" /></svg>
          </span>
          <span className="l">命令</span>
        </button>
        <button type="button" className="rail-item" onClick={onSettings} title="设置">
          <span className="ic" aria-hidden="true">
            <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
          </span>
          <span className="l">设置</span>
        </button>
      </div>
    </nav>
  )
}
