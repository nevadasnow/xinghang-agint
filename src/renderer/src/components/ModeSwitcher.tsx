import { MODE_META, type AgentMode } from '../../../shared/types'

interface Props {
  mode: AgentMode
  onChange: (m: AgentMode) => void
}

export default function ModeSwitcher({ mode, onChange }: Props) {
  return (
    <div className="mode-switcher" role="tablist" aria-label="模式切换">
      {(Object.keys(MODE_META) as AgentMode[]).map((key) => (
        <button
          key={key}
          role="tab"
          aria-selected={mode === key}
          className={`mode-item ${mode === key ? 'active' : ''}`}
          onClick={() => onChange(key)}
        >
          <span className="mode-icon">{MODE_META[key].icon}</span>
          <span className="mode-label">{MODE_META[key].label}</span>
        </button>
      ))}
    </div>
  )
}
