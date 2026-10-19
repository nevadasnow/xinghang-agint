import { useEffect, useState } from 'react'
import {
  getChatAgentSize,
  getChatFontSize,
  getChatSpacing,
  getChatUserSize,
  setChatAgentSize,
  setChatFontSize,
  setChatSpacing,
  setChatUserSize
} from '../utils/uiPrefs'

interface Props {
  open: boolean
  onClose: () => void
  /** 侧栏会话区处于收纳窄条时：面板改为向右弹出（正常宽度），不再挤在窄条内向上展开 */
  folded?: boolean
}

/** 对话显示设置：侧栏内向上弹出的无遮罩面板，便于边调边看对话实时变化（与「设置 → 外观」同步） */
export default function ChatDisplaySettingsModal({ open, onClose, folded = false }: Props) {
  const [agentSize, setAgentSize] = useState(28)
  const [userSize, setUserSize] = useState(38)
  const [fontSize, setFontSize] = useState(13.5)
  const [spacing, setSpacing] = useState(0)

  useEffect(() => {
    if (!open) return
    setAgentSize(getChatAgentSize())
    setUserSize(getChatUserSize())
    setFontSize(getChatFontSize())
    setSpacing(getChatSpacing())
  }, [open])

  if (!open) return null

  return (
    <div className={'display-popover panel' + (folded ? ' dp-from-rail' : '')}>
      <div className="dp-head">
        <span className="dp-title">对话显示设置</span>
        <button className="modal-close dp-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      <label className="field range-field">
        <span>Agent 头像大小：{agentSize}px</span>
        <input
          type="range"
          min={14}
          max={56}
          step={1}
          value={agentSize}
          onChange={(e) => {
            const n = Number(e.target.value)
            setAgentSize(n)
            setChatAgentSize(n)
          }}
        />
      </label>

      <label className="field range-field">
        <span>你的头像大小：{userSize}px</span>
        <input
          type="range"
          min={14}
          max={56}
          step={1}
          value={userSize}
          onChange={(e) => {
            const n = Number(e.target.value)
            setUserSize(n)
            setChatUserSize(n)
          }}
        />
      </label>

      <label className="field range-field">
        <span>字体大小：{fontSize}px</span>
        <input
          type="range"
          min={11}
          max={22}
          step={0.5}
          value={fontSize}
          onChange={(e) => {
            const n = Number(e.target.value)
            setFontSize(n)
            setChatFontSize(n)
          }}
        />
      </label>

      <label className="field range-field">
        <span>字间距：{spacing}px</span>
        <input
          type="range"
          min={0}
          max={4}
          step={0.5}
          value={spacing}
          onChange={(e) => {
            const n = Number(e.target.value)
            setSpacing(n)
            setChatSpacing(n)
          }}
        />
      </label>

      <p className="appearance-hint">即时生效并自动保存，与「设置 → 外观 → 对话界面」同步。</p>
    </div>
  )
}
