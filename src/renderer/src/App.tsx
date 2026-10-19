import { useEffect, useState } from 'react'
import type { AgentMode, ConfigInfo } from '../../shared/types'
import Home from './pages/Home'
import Chat from './pages/Chat'
import Tasks from './pages/Tasks'
import AgentPage from './pages/AgentPage'
import DocsPage from './pages/DocsPage'
import MemoryPage from './pages/MemoryPage'
import TitleBar from './components/TitleBar'
import { OrgProvider } from './state/org'
import SettingsModal from './components/SettingsModal'
import CommandMenu from './components/CommandMenu'
import UserProfileModal from './components/UserProfileModal'
import { applyAvatarStyle, applyChatStyle, applyTheme, getTheme, initSystemThemeWatch } from './utils/uiPrefs'
import { initAgentRoleFromConfig } from './utils/agentRoles'
import { musicStore } from './state/musicStore'
import { AppBgLayer, SplashOverlay } from './components/AppBackground'
import CloseAskModal from './components/CloseAskModal'

type Page = 'home' | 'chat' | 'tasks' | 'agent' | 'docs' | 'memory'

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [mode, setMode] = useState<AgentMode>('chat')
  /** 模型配置提升到 App：标题栏胶囊与页面（首页/对话页）共用同一份，避免模型名显示不同步 */
  const [config, setConfig] = useState<ConfigInfo | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  /** 首页聊天框携带的初始消息：切到对话页后自动新建会话并发送 */
  const [bootPrompt, setBootPrompt] = useState<string | null>(null)
  /** 关闭确认弹窗（常规设置→关闭行为=每次询问）：主进程事件触发 */
  const [closeAsk, setCloseAsk] = useState<{ canTray: boolean; roleName: string } | null>(null)
  /** 命令面板（左下角「命令」按钮） */
  const [cmdOpen, setCmdOpen] = useState(false)
  /** 「新建对话」信号：命令面板点击后传给 Chat 触发 newSession */
  const [newSessionTick, setNewSessionTick] = useState(0)

  useEffect(() => {
    window.shorekeeper.getConfig().then((cfg) => {
      setConfig(cfg)
      // 关键：把主进程记着的角色同步回渲染层。
      // 角色有两个存储：主进程 config（持久、能跨重启）与渲染层 localStorage
      // （getAgentRole 实际读的那个）。原先只 setConfig，从不回写 localStorage，
      // 于是重启后 getAgentRole() 读不到值就回落「守岸人」——即使配置里是莫宁。
      initAgentRoleFromConfig(cfg?.agentRole)
    })
    // 启动时应用界面偏好：主题 + 头像位置/形状
    applyTheme(getTheme())
    applyAvatarStyle()
    applyChatStyle()
    initSystemThemeWatch()

    // 音乐全局快捷键：Ctrl+Shift+→ 下一首 / Ctrl+Shift+← 上一首 / Ctrl+Shift+Space 播放暂停
    // 与首页/左栏播放器按钮共用同一个 musicStore，任何界面下都生效。
    const offMusic = window.shorekeeper.onMusicKey((cmd) => {
      if (cmd === 'next') musicStore.next()
      else if (cmd === 'prev') musicStore.prev()
      else musicStore.toggle()
    })
    return () => offMusic()
  }, [])

  // 关闭确认弹窗订阅：主进程请求选择「最小化到托盘 / 直接退出 / 取消」
  useEffect(() => {
    const off = window.shorekeeper.onCloseAsk((payload) => setCloseAsk(payload))
    return () => off()
  }, [])

  function start(m: AgentMode) {
    setMode(m)
    setPage('chat')
  }

  /** 首页聊天框发送：带内容进入对话页并开始对话 */
  function ask(text: string) {
    setMode('chat')
    setPage('chat')
    setBootPrompt(text)
  }

  /** 左侧「任务」选项卡：进入任务管理页 */
  function openTasks() {
    setPage('tasks')
  }

  /** 命令面板跳转：newSession=true 时切到对话页并新建会话 */
  function runCommand(pg: Page, newSession = false) {
    setCmdOpen(false)
    if (newSession) setNewSessionTick((v) => v + 1)
    setPage(pg === 'chat' ? 'chat' : pg)
  }

  return (
    <OrgProvider>
    <div className="app-root">
      <div className="starfield" aria-hidden="true" />

      {/* 自定义界面背景（设置·外观）：盖住默认海面背景，正文在其上 */}
      <AppBgLayer />

      {/* 开屏动画（设置·外观）：启动全屏播放视频，播完/点击后进入主界面 */}
      <SplashOverlay />

      {/* 关闭确认弹窗（常规设置→关闭行为=每次询问） */}
      <CloseAskModal payload={closeAsk} onDismiss={() => setCloseAsk(null)} />

      {/* 自绘标题栏：主进程 titleBarStyle:'hidden' 后由它接管拖拽与窗口按钮 */}
      <TitleBar
        config={config}
        onConfigChange={setConfig}
        onOpenSettings={() => setShowSettings(true)}
        onMinimize={() => void window.shorekeeper.windowMinimize()}
        onToggleMaximize={() => void window.shorekeeper.windowToggleMaximize()}
        onClose={() => void window.shorekeeper.windowClose()}
      />

      <div className="app-body">
        {page === 'home' ? (
          <Home
            onStart={start}
            onAsk={ask}
            config={config}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProfile={() => setShowProfile(true)}
            onTasks={openTasks}
            onAgent={() => setPage('agent')}
            onDocs={() => setPage('docs')}
            onMemory={() => setPage('memory')}
            onCommand={() => setCmdOpen(true)}
          />
        ) : page === 'tasks' ? (
          <Tasks
            onHome={() => setPage('home')}
            onChat={() => start('chat')}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProfile={() => setShowProfile(true)}
            onAgent={() => setPage('agent')}
            onDocs={() => setPage('docs')}
            onMemory={() => setPage('memory')}
            onCommand={() => setCmdOpen(true)}
          />
        ) : page === 'agent' ? (
          <AgentPage
            onHome={() => setPage('home')}
            onChat={() => start('chat')}
            onTasks={openTasks}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProfile={() => setShowProfile(true)}
            onDocs={() => setPage('docs')}
            onMemory={() => setPage('memory')}
            onCommand={() => setCmdOpen(true)}
          />
        ) : page === 'docs' ? (
          <DocsPage
            onHome={() => setPage('home')}
            onChat={() => start('chat')}
            onTasks={openTasks}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProfile={() => setShowProfile(true)}
            onAgent={() => setPage('agent')}
            onMemory={() => setPage('memory')}
            onCommand={() => setCmdOpen(true)}
          />
        ) : page === 'memory' ? (
          <MemoryPage
            onHome={() => setPage('home')}
            onChat={() => start('chat')}
            onTasks={openTasks}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProfile={() => setShowProfile(true)}
            onAgent={() => setPage('agent')}
            onDocs={() => setPage('docs')}
            onCommand={() => setCmdOpen(true)}
          />
        ) : (
          <Chat
            mode={mode}
            onChangeMode={setMode}
            onHome={() => setPage('home')}
            config={config}
            onOpenSettings={() => setShowSettings(true)}
            onOpenProfile={() => setShowProfile(true)}
            bootPrompt={bootPrompt ?? undefined}
            onBootPromptConsumed={() => setBootPrompt(null)}
            onTasks={openTasks}
            onAgent={() => setPage('agent')}
            onDocs={() => setPage('docs')}
            onMemory={() => setPage('memory')}
            onCommand={() => setCmdOpen(true)}
            newSessionSignal={newSessionTick}
          />
        )}
      </div>

      {/* 设置弹窗提到 App：标题栏「打开模型设置」与页面内入口共用同一个实例 */}
      <UserProfileModal open={showProfile} onClose={() => setShowProfile(false)} />
      <SettingsModal
        open={showSettings}
        current={config}
        onClose={() => setShowSettings(false)}
        onSaved={setConfig}
      />
      <CommandMenu
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={runCommand}
        onOpenSettings={() => {
          setCmdOpen(false)
          setShowSettings(true)
        }}
      />
    </div>
    </OrgProvider>
  )
}
