import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ToolCatalogEntry, ToolMode } from '../../../shared/types'

interface Props {
  open: boolean
  onClose: () => void
}

type TabKey = 'work' | 'code' | 'learn' | 'chat'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'work', label: '工作 Work' },
  { key: 'code', label: '代码 Code' },
  { key: 'learn', label: '学习 Learn' },
  { key: 'chat', label: '聊天 Chat' }
]

const RISK_LABEL: Record<string, string> = {
  safe: '安全',
  read: '读取',
  'fs-read': '读文件',
  'fs-write': '改文件',
  shell: '执行命令',
  network: '联网',
  'input-control': '控制输入',
  external_side_effect: '外部副作用'
}

/**
 * Agent 能力 · 工具开关（复刻 Shorekeeper ToolToggleSettingsPanel）：
 * - 模式 tab（Work/Code/Learn/Chat）+ 每模式工具开关
 * - override 语义：overrides[toolId][mode] 显式覆盖；未覆盖时按 modes 声明（空 modes=全模式）
 * - chat 模式：chatBuiltin 内建集 + chatToolsEnabled 总开关（开启后可选工具 opt-in）
 */
export default function ToolSettingsModal({ open, onClose }: Props) {
  const [catalog, setCatalog] = useState<ToolCatalogEntry[]>([])
  const [overrides, setOverrides] = useState<Record<string, Record<ToolMode, boolean>>>({})
  const [chatToolsEnabled, setChatToolsEnabled] = useState(false)
  const [tab, setTab] = useState<TabKey>('work')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!open) return
    setMsg('')
    setLoading(true)
    Promise.all([window.shorekeeper.getToolCatalog(), window.shorekeeper.getToolOverrides(), window.shorekeeper.getConfig()])
      .then(([tools, ov, cfg]) => {
        setCatalog(tools)
        setOverrides(ov)
        setChatToolsEnabled(cfg.chatToolsEnabled)
      })
      .catch((e) => setMsg('加载工具清单失败：' + (e as Error).message))
      .finally(() => setLoading(false))
  }, [open])

  /** 工具在某个模式下的默认可见性（未覆盖时按 modes 声明） */
  const isDefaultVisible = useCallback(
    (tool: ToolCatalogEntry, mode: TabKey): boolean => {
      if (mode === 'chat') return tool.chatBuiltin
      if (tool.modes === null) return true // 未声明 modes → 全模式可见
      return tool.modes.includes(mode)
    },
    []
  )

  /** 工具在某个模式下的当前开关状态（override 优先） */
  const isOn = useCallback(
    (tool: ToolCatalogEntry, mode: TabKey): boolean => {
      const ov = overrides[tool.id]
      if (ov && ov[mode] !== undefined) return ov[mode]
      return isDefaultVisible(tool, mode)
    },
    [overrides, isDefaultVisible]
  )

  async function toggle(tool: ToolCatalogEntry, mode: TabKey, on: boolean) {
    setSaving(true)
    setMsg('')
    try {
      setOverrides((prev) => ({ ...prev, [tool.id]: { ...(prev[tool.id] ?? {}), [mode]: on } }))
      const r = await window.shorekeeper.setToolOverride(tool.id, mode as ToolMode, on)
      if (!r.ok) setMsg(`保存失败：${r.error ?? '未知错误'}`)
    } catch (e) {
      setMsg('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleChatEnabled(on: boolean) {
    setSaving(true)
    setMsg('')
    try {
      setChatToolsEnabled(on)
      const r = await window.shorekeeper.setChatToolsEnabled(on)
      if (!r.ok) setMsg(`保存失败：${r.error ?? '未知错误'}`)
    } catch (e) {
      setMsg('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const visibleTools = useMemo(() => {
    if (tab === 'chat') {
      return catalog.filter((t) => !t.deprecated)
    }
    return catalog.filter((t) => !t.deprecated && isDefaultVisible(t, tab))
  }, [catalog, tab, isDefaultVisible])

  const enabledCount = useMemo(
    () => visibleTools.filter((t) => isOn(t, tab)).length,
    [visibleTools, isOn, tab]
  )

  if (!open) return null

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal modal-tools panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Agent 能力 · 工具开关</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <p className="tools-intro">
          参照 Shorekeeper 的 ToolToggleSettingsPanel 复刻：按模式（工作/代码/学习/聊天）管理守岸人可调用的工具。
          开关状态写入 <code>config.json</code> 的 <code>toolModeOverrides</code>，对话时按当前模式过滤并注入提示词。
        </p>

        <div className="tools-tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={'tools-tab' + (tab === t.key ? ' active' : '')}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'chat' && (
          <div className="chat-enhance-row">
            <div className="chat-enhance-info">
              <span className="chat-enhance-title">聊天增强（chatToolsEnabled）</span>
              <span className="chat-enhance-desc">
                开启后，除「内置」工具外，还可把任意工具按需加入聊天模式；关闭时仅保留内置工具集。
              </span>
            </div>
            <button
              className={'switch' + (chatToolsEnabled ? ' on' : '')}
              role="switch"
              aria-checked={chatToolsEnabled}
              onClick={() => toggleChatEnabled(!chatToolsEnabled)}
              disabled={saving}
            >
              <span className="switch-knob" />
            </button>
          </div>
        )}

        <div className="tools-list-head">
          <span>
            {tab === 'chat'
              ? chatToolsEnabled
                ? '已启用（内置 + 手动开启）'
                : '已启用（仅内置）'
              : '已启用'}
            ：{enabledCount} / {visibleTools.length} 个工具
          </span>
        </div>

        {loading ? (
          <p className="empty-hint">正在加载工具清单……</p>
        ) : visibleTools.length === 0 ? (
          <p className="empty-hint">该模式下没有可用工具。</p>
        ) : (
          <ul className="tools-list">
            {visibleTools.map((tool) => {
              const on = isOn(tool, tab)
              const overrideActive = overrides[tool.id]?.[tab] !== undefined
              return (
                <li key={tool.id} className={'tool-item' + (on ? ' on' : '')}>
                  <div className="tool-main">
                    <div className="tool-name-row">
                      <span className="tool-name">{tool.name}</span>
                      {tool.unavailable && <em className="tool-badge off">未接入</em>}
                      {tool.chatBuiltin && <em className="tool-badge builtin">内置</em>}
                      {overrideActive && <em className="tool-badge override">手动</em>}
                      <span className={'tool-risk risk-' + tool.risk}>{RISK_LABEL[tool.risk] ?? tool.risk}</span>
                    </div>
                    <p className="tool-desc">{tool.description}</p>
                  </div>
                  <button
                    className={'switch' + (on ? ' on' : '')}
                    role="switch"
                    aria-checked={on}
                    onClick={() => toggle(tool, tab, !on)}
                    disabled={saving}
                  >
                    <span className="switch-knob" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <p className="tools-footnote">
          「内置」= chat 模式自动可用（chatBuiltin）；「手动」= 你在此处显式覆盖了默认声明。
          未列出的 Shorekeeper 专属后端（音乐/朋友圈/知识库/浏览器/Obsidian/游戏代肝等）开关已全部保留，
          执行体在守岸人接入对应服务前返回占位说明。
        </p>

        {msg && <p className="modal-msg">{msg}</p>}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
