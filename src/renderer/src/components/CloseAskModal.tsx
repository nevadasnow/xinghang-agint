interface Props {
  /** 主进程要求确认关闭时传入；null 不显示 */
  payload: { canTray: boolean; roleName: string } | null
  /** 取消后清理状态 */
  onDismiss: () => void
}

/** 关闭确认弹窗（常规设置 → 关闭行为 = 每次询问时弹出）：主题风格，替代系统原生对话框 */
export default function CloseAskModal({ payload, onDismiss }: Props) {
  if (!payload) return null
  const choose = (action: 'tray' | 'quit' | 'cancel') => {
    void window.shorekeeper.closeChoose(action)
    if (action === 'cancel') onDismiss()
  }
  return (
    <div className="modal-mask close-ask-mask" onClick={() => choose('cancel')}>
      <div className="modal close-ask panel" onClick={(e) => e.stopPropagation()}>
        <div className="close-ask-title">关闭{payload.roleName}？</div>
        <p className="close-ask-sub">关闭窗口后要做什么？</p>
        <div className="close-ask-actions">
          {payload.canTray && (
            <button className="close-ask-btn tray" onClick={() => choose('tray')}>
              <span className="cak-ic" aria-hidden="true">▾</span>
              <span className="cak-main">
                最小化到托盘
                <em>继续在后台运行，随时可回来</em>
              </span>
            </button>
          )}
          <button className="close-ask-btn quit" onClick={() => choose('quit')}>
            <span className="cak-ic" aria-hidden="true">✕</span>
            <span className="cak-main">
              直接退出
              <em>结束本次运行</em>
            </span>
          </button>
          <button className="close-ask-btn cancel" onClick={() => choose('cancel')}>
            <span className="cak-ic" aria-hidden="true">↩</span>
            <span className="cak-main">
              取消
              <em>继续使用</em>
            </span>
          </button>
        </div>
        <p className="close-ask-hint">可在「设置 → 常规设置」中改为其他关闭行为，或勾选不再弹窗确认。</p>
      </div>
    </div>
  )
}
