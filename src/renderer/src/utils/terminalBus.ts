/**
 * E2 终端命令建议 —— 跨组件投递通道
 *
 * 场景：AI 回复里带了 shell 命令，用户点「在终端运行」，
 * 命令要送到右侧面板的终端 tab 里。
 *
 * 为什么用事件而不是 props：
 *   TerminalPane 挂在 RightPanel 内，而按钮在消息气泡里，
 *   两者之间隔着 Chat → RightPanel → TerminalPane 三层。
 *   为此把回调一路透传下去会污染三个组件的接口，
 *   而这是一次性的、方向单一的投递，用轻量事件更合适。
 *
 * 约束：模块级单例 + 显式取消订阅，避免热重载或反复挂载导致监听器堆积。
 */

export interface TerminalCommandRequest {
  /** 要执行的命令 */
  command: string
  /** 是否直接执行；false 只填入输入框让用户确认 */
  autoRun: boolean
}

type Handler = (req: TerminalCommandRequest) => void

const handlers = new Set<Handler>()

/** 订阅（由 TerminalPane 在挂载时调用），返回取消订阅函数 */
export function onTerminalCommand(fn: Handler): () => void {
  handlers.add(fn)
  return () => {
    handlers.delete(fn)
  }
}

/**
 * 请求把一条命令送到终端。
 *
 * @returns 是否有接收方。没有任何终端面板挂着时返回 false，
 *          调用方据此提示用户「先打开右侧面板的终端」。
 */
export function requestTerminalCommand(command: string, autoRun = false): boolean {
  const cmd = (command ?? '').trim()
  if (!cmd || handlers.size === 0) return false
  for (const h of handlers) {
    try {
      h({ command: cmd, autoRun })
    } catch {
      /* 单个订阅者出错不应影响其它订阅者 */
    }
  }
  return true
}
