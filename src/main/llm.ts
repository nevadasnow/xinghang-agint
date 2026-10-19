import type { AgentMode, ChatMessage, LlmConfig, ModelListResult, TestConnectionResult } from '../shared/types'
import type { ToolCallEvent } from '../shared/events'
import type { TokenUsageRaw } from '../shared/types'
import type { ToolCallTrace } from '../shared/tool-trace'

/**
 * 调用 OpenAI 兼容的国内大模型接口（DeepSeek / 豆包 / 通义 / GLM / MiniMax / Kimi 等）。
 * 未配置 apiKey 时返回演示模式的守岸人口吻回复，保证界面可完整跑通。
 */

export interface ChatToolSpec {
  name: string
  description: string
  parameters?: Record<string, unknown>
}

export interface ChatCompletionOptions {
  /** 可选：传给模型的 tools 参数（function calling） */
  tools?: ChatToolSpec[]
  /** 可选：工具目录文本（仅当带 tools 请求时拼进 system prompt；降级纯文本时移除，避免模型文本模拟调用） */
  toolCatalogText?: string
  /** 可选：执行工具调用的回调（主进程注册表 execute） */
  toolExecutor?: (name: string, args: Record<string, unknown>, mode: AgentMode) => Promise<string>
  /** 工具调用最大轮数（默认 4） */
  maxToolRounds?: number
  /**
   * 可选：工具调用过程的实时事件回调。
   * 主进程接上后即可把「正在调用 / 调用完成」推给渲染层，让工具调用对用户可见。
   */
  onToolEvent?: (event: ToolCallEvent) => void
  /** 可选：把工具 id 翻成面向用户的中文名（取不到则回落为 id） */
  toolLabel?: (id: string) => string | undefined
}

/** 工具结果进事件 / 留痕前截断，避免长输出撑爆卡片 */
const TOOL_RESULT_LIMIT = 4000

function clipToolResult(text: string): string {
  if (text.length <= TOOL_RESULT_LIMIT) return text
  return `${text.slice(0, TOOL_RESULT_LIMIT)}\n…（已截断，共 ${text.length} 字符）`
}

/** chatCompletion 的结构化返回：文本 + 本轮工具调用留痕 */
export interface ChatCompletionResult {
  content: string
  toolCalls: ToolCallTrace[]
}

interface ToolCall {
  id?: string
  /** 流式分片的槽位序号（SSE delta.tool_calls 每项自带 index，用于按位拼接 arguments） */
  index?: number
  function?: { name?: string; arguments?: string }
}

export function detectProvider(cfg: LlmConfig): string {
  if (cfg.provider) return cfg.provider
  const url = cfg.baseURL || ''
  if (url.includes('deepseek')) return 'DeepSeek（深度求索）'
  if (url.includes('volces') || url.includes('ark')) return '豆包（火山方舟）'
  if (url.includes('dashscope') || url.includes('aliyun')) return '通义千问（DashScope）'
  if (url.includes('bigmodel')) return '智谱 GLM'
  if (url.includes('minimax')) return 'MiniMax（稀宇科技）'
  if (url.includes('moonshot')) return 'Kimi（月之暗面）'
  if (url.includes('openai')) return 'OpenAI 兼容'
  return url ? '自定义' : '未配置'
}

export function isConfigured(cfg: LlmConfig): boolean {
  return Boolean(cfg.apiKey && cfg.baseURL && cfg.model)
}

function mockReply(messages: ChatMessage[], mode: string): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const snippet = lastUser.length > 60 ? lastUser.slice(0, 60) + '……' : lastUser
  if (mode === 'code') {
    return `（演示模式）收到你的代码问题：\n\n「${snippet}」\n\n在演示模式下我无法真正分析代码。请到「设置」里配置大模型接口（支持 DeepSeek / 豆包 / 通义等 OpenAI 兼容 API），之后我就能帮你写代码、查问题了。`
  }
  if (mode === 'work') {
    return `（演示模式）收到你的办公需求：\n\n「${snippet}」\n\n在演示模式下我只能展示界面流程。配置大模型接口后，我就能帮你撰写、整理和分析。设置入口在左下角。`
  }
  return `嗯，我听到了。你说的是——「${snippet}」\n\n现在还是演示模式，我的回答由本地示例生成。在左下角设置里填入你的大模型接口（DeepSeek / 豆包 / 通义均可），我就能真正陪你聊下去、帮你做事了。`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 解析聊天接口 URL 候选列表。
 * 阿里云 MaaS 网关的 /api/v1（DashScope 原生）不支持 /chat/completions，
 * 需使用同 host 的 /compatible-mode/v1（OpenAI 兼容）。主 URL 404 时自动回退。
 */
function chatURLs(baseURL: string): string[] {
  const primary = `${baseURL}/chat/completions`
  const isMaaSDash = /maas\.aliyuncs\.com/i.test(baseURL) && /\/api\/v1$/i.test(baseURL)
  if (!isMaaSDash) return [primary]
  const alt = baseURL.replace(/\/api\/v1$/i, '/compatible-mode/v1') + '/chat/completions'
  return [primary, alt]
}

export async function chatCompletion(
  cfg: LlmConfig,
  messages: ChatMessage[],
  mode: AgentMode,
  options?: ChatCompletionOptions
): Promise<ChatCompletionResult> {
  if (!isConfigured(cfg)) {
    await sleep(600)
    return { content: mockReply(messages, mode), toolCalls: [] }
  }

  const baseURL = cfg.baseURL.replace(/\/+$/, '')
  const urls = chatURLs(baseURL)
  const timeoutSec = cfg.timeoutSec > 0 ? cfg.timeoutSec : 120
  const maxRetries = cfg.maxRetries >= 0 ? cfg.maxRetries : 3
  const maxToolRounds = Math.max(0, Math.min(8, options?.maxToolRounds ?? 4))
  const hasTools = Boolean(options?.tools && options.tools.length > 0 && options.toolExecutor)

  /** 单次请求（带可选的 tools 参数），返回 message 或抛错 */
  async function requestOnce(
    msgs: ChatMessage[],
    useTools: boolean,
    allowRetry: boolean
  ): Promise<{ content?: string; toolCalls?: ToolCall[] }> {
    let lastError: Error | null = null
    let urlIdx = 0
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)
      try {
        const body: Record<string, unknown> = {
          model: cfg.model.trim(),
          messages: msgs,
          stream: false,
          temperature: 0.7
        }
        if (useTools && options?.tools) {
          body.tools = options.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters ?? { type: 'object', properties: {} } }
          }))
        }
        const res = await fetch(urls[urlIdx], {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey.trim()}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })

        // 404 且还有备用地址（MaaS /api/v1 → /compatible-mode/v1）：切换地址，不消耗重试次数
        if (res.status === 404 && urlIdx < urls.length - 1) {
          urlIdx++
          attempt--
          continue
        }

        // 可重试的瞬时错误：限流与 5xx
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          lastError = new Error(`HTTP ${res.status}`)
          await sleep(500 * (attempt + 1))
          continue
        }

        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`接口返回 ${res.status}: ${errText.slice(0, 300)}`)
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>
        }
        const msg = data.choices?.[0]?.message
        if (!msg) throw new Error('接口返回为空')
        return { content: msg.content, toolCalls: msg.tool_calls }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        const aborted = lastError.name === 'AbortError'
        // 超时/网络错误在还有重试次数时重试
        if (attempt < maxRetries && allowRetry && (aborted || lastError.message.includes('fetch failed'))) {
          await sleep(500 * (attempt + 1))
          continue
        }
        throw lastError
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new Error('请求失败')
  }

  const working = [...messages]
  let lastContent = ''
  /** 本轮所有工具调用留痕：随 assistant 消息一起返回，供 UI 与持久化使用 */
  const trace: ToolCallTrace[] = []

  /** 按本轮是否带 tools 组装 system prompt：带 tools 时拼工具目录；降级纯文本时移除并禁止文本模拟 */
  function withSystem(msgs: ChatMessage[], useTools: boolean): ChatMessage[] {
    const base = msgs[0]?.role === 'system' ? msgs[0].content : ''
    const rest = msgs[0]?.role === 'system' ? msgs.slice(1) : msgs
    let sys = base
    if (useTools && options?.toolCatalogText) {
      sys += `\n\n${options.toolCatalogText}`
    } else if (!useTools) {
      sys += `\n\n（注意：本次请求未启用工具调用。请不要输出 <tool_call>、tool_calls 或任何 JSON 工具调用格式，直接以文字回答。）`
    }
    return [{ role: 'system', content: sys }, ...rest]
  }

  for (let round = 0; round <= maxToolRounds; round++) {
    let resp: { content?: string; toolCalls?: ToolCall[] }
    try {
      // 第一轮就带 tools（此前 round>0 导致首轮纯文本、工具从未真正启用）
      resp = await requestOnce(withSystem(working, hasTools), hasTools, true)
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      // 工具参数导致 400/422（模型不支持 function calling）：降级为纯文本重试一次（同时移除工具目录）
      if (hasTools && /接口返回 4(00|22)/.test(err.message) && round === 0) {
        const fallback = await requestOnce(withSystem(working, false), false, true)
        return { content: fallback.content ?? '（模型未返回文本）', toolCalls: trace }
      }
      throw err
    }

    if (resp.content) lastContent = resp.content

    const calls = resp.toolCalls?.filter((c) => c.function?.name) ?? []
    if (calls.length === 0 || !hasTools || round >= maxToolRounds) {
      const content =
        lastContent || (calls.length > 0 ? `已调用 ${calls.length} 个工具，但模型未返回最终文本。` : '（模型未返回文本）')
      return { content, toolCalls: trace }
    }

    // 把 assistant 的 tool_calls 原样放回对话，再补 tool 结果
    working.push({
      role: 'assistant',
      content: resp.content ?? '',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...(resp.toolCalls ? { tool_calls: resp.toolCalls } : {})
    } as ChatMessage)

    for (const call of calls) {
      const name = call.function?.name ?? ''
      const callId = call.id ?? `call_${round}_${name}`
      const rawArgs = call.function?.arguments ?? ''
      let args: Record<string, unknown> = {}
      try {
        args = rawArgs ? JSON.parse(rawArgs) : {}
      } catch {
        args = {}
      }

      const label = options?.toolLabel?.(name)
      // 通知渲染层：即将执行。回调异常绝不能影响对话主流程。
      try {
        options?.onToolEvent?.({ id: callId, round, phase: 'start', name, label, args: rawArgs })
      } catch {
        /* 忽略事件回调自身异常 */
      }

      const startedAt = Date.now()
      let result: string
      let state: 'done' | 'failed' = 'done'
      try {
        result = await options!.toolExecutor!(name, args, mode)
      } catch (e) {
        result = `工具执行失败：${(e as Error).message}`
        state = 'failed'
      }
      const durationMs = Date.now() - startedAt
      const clipped = clipToolResult(result)

      trace.push({ id: callId, name, label, args: rawArgs, result: clipped, state, durationMs })

      try {
        options?.onToolEvent?.({
          id: callId,
          round,
          phase: 'end',
          name,
          label,
          args: rawArgs,
          result: clipped,
          state,
          durationMs
        })
      } catch {
        /* 忽略事件回调自身异常 */
      }

      working.push({
        role: 'tool',
        content: result,
        tool_call_id: callId
      } as unknown as ChatMessage)
    }
  }

  return { content: lastContent || '（模型未返回文本）', toolCalls: trace }
}

/* ------------------------------------------------------------------
   流式对话（chatCompletionStream）
   ------------------------------------------------------------------ */

export interface ChatCompletionStreamOptions extends ChatCompletionOptions {
  /** 外部取消信号（渲染层「停止」按钮 → 主进程 abort 该 controller） */
  signal?: AbortSignal
  /** 正文增量回调（每个分片推一次，渲染层自行累积） */
  onDelta?: (text: string, round: number) => void
  /** 思考增量回调（qwen3 / DeepSeek-R1 的 reasoning_content） */
  onReasoning?: (text: string, round: number) => void
  /** 每次 API 调用完成后的 usage 回调（用于本地 Token 用量统计；被中止时可能为 undefined） */
  onUsage?: (usage: TokenUsageRaw | undefined, round: number) => void
}

export interface ChatCompletionStreamResult {
  content: string
  reasoning?: string
  toolCalls: ToolCallTrace[]
  /** true = 被外部信号 / 超时中止（保留已生成内容）；false = 正常完成 */
  stopped: boolean
}

/**
 * 流式版对话入口：正文 / 思考增量实时回调，支持外部中止（用户「停止」），
 * 工具调用轮次与事件推送语义与 chatCompletion 一致。
 */
export async function chatCompletionStream(
  cfg: LlmConfig,
  messages: ChatMessage[],
  mode: AgentMode,
  options?: ChatCompletionStreamOptions
): Promise<ChatCompletionStreamResult> {
  if (!isConfigured(cfg)) {
    await sleep(600)
    return { content: mockReply(messages, mode), toolCalls: [], stopped: false }
  }

  const baseURL = cfg.baseURL.replace(/\/+$/, '')
  const urls = chatURLs(baseURL)
  const timeoutSec = cfg.timeoutSec > 0 ? cfg.timeoutSec : 120
  const maxRetries = cfg.maxRetries >= 0 ? cfg.maxRetries : 3
  const maxToolRounds = Math.max(0, Math.min(8, options?.maxToolRounds ?? 4))
  const hasTools = Boolean(options?.tools && options.tools.length > 0 && options.toolExecutor)

  /** 按本轮是否带 tools 组装 system prompt（与原 chatCompletion 相同语义） */
  function withSystem(msgs: ChatMessage[], useTools: boolean): ChatMessage[] {
    const base = msgs[0]?.role === 'system' ? msgs[0].content : ''
    const rest = msgs[0]?.role === 'system' ? msgs.slice(1) : msgs
    let sys = base
    if (useTools && options?.toolCatalogText) {
      sys += `\n\n${options.toolCatalogText}`
    } else if (!useTools) {
      sys += `\n\n（注意：本次请求未启用工具调用。请不要输出 <tool_call>、tool_calls 或任何 JSON 工具调用格式，直接以文字回答。）`
    }
    return [{ role: 'system', content: sys }, ...rest]
  }

  /**
   * 流式调用一次请求（单轮）：SSE 解析 delta.content / delta.reasoning_content / delta.tool_calls。
   * 被外部信号中止时返回已累积的内容 + stopped: true（不抛错，让上层保留半成品）。
   */
  async function requestOnceStream(
    msgs: ChatMessage[],
    useTools: boolean,
    allowRetry: boolean,
    externalSignal: AbortSignal | undefined,
    round: number
  ): Promise<{ content: string; reasoning: string; toolCalls: ToolCall[]; stopped: boolean; usage?: TokenUsageRaw }> {
    let lastError: Error | null = null
    let urlIdx = 0
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const onExternalAbort = (): void => controller.abort()
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort()
        else externalSignal.addEventListener('abort', onExternalAbort)
      }
      const timer = setTimeout(() => controller.abort(), timeoutSec * 1000)

      // 累积变量放 try 外：被中止时 catch 里能拿到已生成的半成品
      let content = ''
      let reasoning = ''
      let usage: TokenUsageRaw | undefined
      const toolSlots: Record<number, { id?: string; name?: string; args: string }> = {}

      try {
        const body: Record<string, unknown> = {
          model: cfg.model.trim(),
          messages: msgs,
          stream: true,
          temperature: 0.7
        }
        if (useTools && options?.tools) {
          body.tools = options.tools.map((t) => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters ?? { type: 'object', properties: {} } }
          }))
        }
        const res = await fetch(urls[urlIdx], {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cfg.apiKey.trim()}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })

        // 404 且还有备用地址（MaaS /api/v1 → /compatible-mode/v1）：切换地址，不消耗重试次数
        if (res.status === 404 && urlIdx < urls.length - 1) {
          urlIdx++
          attempt--
          continue
        }
        // 可重试的瞬时错误：限流与 5xx
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          lastError = new Error(`HTTP ${res.status}`)
          await sleep(500 * (attempt + 1))
          continue
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          throw new Error(`接口返回 ${res.status}: ${errText.slice(0, 300)}`)
        }
        if (!res.body) throw new Error('接口不支持流式响应')

        // SSE 逐行解析
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let nl: number
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim()
            buf = buf.slice(nl + 1)
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (payload === '[DONE]') continue
            let chunk: {
              choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: ToolCall[] } }>
              usage?: TokenUsageRaw
            }
            try {
              chunk = JSON.parse(payload)
            } catch {
              continue // 个别分片不完整，跳过
            }
            // 流式响应的 usage 通常出现在最后一个分片；有则记录
            if (chunk.usage && typeof chunk.usage === 'object') usage = chunk.usage as TokenUsageRaw
            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue
            if (typeof delta.reasoning_content === 'string') {
              reasoning += delta.reasoning_content
              options?.onReasoning?.(delta.reasoning_content, round)
            }
            if (typeof delta.content === 'string') {
              content += delta.content
              options?.onDelta?.(delta.content, round)
            }
            if (Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0
                const slot = toolSlots[idx] ?? (toolSlots[idx] = { args: '' })
                if (tc.id) slot.id = tc.id
                if (tc.function?.name) slot.name = tc.function.name
                if (tc.function?.arguments) slot.args += tc.function.arguments
              }
            }
          }
        }
        const toolCalls: ToolCall[] = Object.values(toolSlots).map((s) => ({
          id: s.id,
          function: { name: s.name, arguments: s.args }
        }))
        return { content, reasoning, toolCalls, stopped: false, usage }
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))
        const aborted = controller.signal.aborted || Boolean(externalSignal?.aborted)
        // 被外部信号（用户停止）或超时中止：把半成品交还上层，不再重试
        if (aborted) {
          const toolCalls: ToolCall[] = Object.values(toolSlots).map((s) => ({
            id: s.id,
            function: { name: s.name, arguments: s.args }
          }))
          return { content, reasoning, toolCalls, stopped: true, usage }
        }
        if (attempt < maxRetries && allowRetry && lastError.message.includes('fetch failed')) {
          await sleep(500 * (attempt + 1))
          continue
        }
        throw lastError
      } finally {
        clearTimeout(timer)
        externalSignal?.removeEventListener('abort', onExternalAbort)
      }
    }
    throw lastError ?? new Error('请求失败')
  }

  const working = [...messages]
  let lastContent = ''
  let lastReasoning = ''
  const trace: ToolCallTrace[] = []

  for (let round = 0; round <= maxToolRounds; round++) {
    let resp: { content: string; reasoning: string; toolCalls: ToolCall[]; stopped: boolean; usage?: TokenUsageRaw }
    try {
      resp = await requestOnceStream(withSystem(working, hasTools), hasTools, true, options?.signal, round)
      // 每次成功的 API 调用（无论是否走工具轮次）都上报 usage，用于本地统计
      try {
        options?.onUsage?.(resp.usage, round)
      } catch {
        /* 统计回调异常不影响对话 */
      }
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      // 工具参数导致 400/422（模型不支持 function calling）：降级为纯文本重试一次
      if (hasTools && /接口返回 4(00|22)/.test(err.message) && round === 0) {
        const fallback = await requestOnceStream(withSystem(working, false), false, true, options?.signal, round)
        try {
          options?.onUsage?.(fallback.usage, round)
        } catch {
          /* 统计回调异常不影响对话 */
        }
        return {
          content: fallback.content || '（模型未返回文本）',
          reasoning: fallback.reasoning || undefined,
          toolCalls: trace,
          stopped: fallback.stopped
        }
      }
      throw err
    }

    // 用户点击「停止」：保留已生成的内容与思考过程
    if (resp.stopped) {
      return {
        content: resp.content || lastContent,
        reasoning: resp.reasoning || lastReasoning || undefined,
        toolCalls: trace,
        stopped: true
      }
    }

    if (resp.content) lastContent = resp.content
    if (resp.reasoning) lastReasoning = resp.reasoning

    const calls = resp.toolCalls?.filter((c) => c.function?.name) ?? []
    if (calls.length === 0 || !hasTools || round >= maxToolRounds) {
      const content =
        lastContent || (calls.length > 0 ? `已调用 ${calls.length} 个工具，但模型未返回最终文本。` : '（模型未返回文本）')
      return { content, reasoning: lastReasoning || undefined, toolCalls: trace, stopped: false }
    }

    // 把 assistant 的 tool_calls 原样放回对话，再补 tool 结果
    working.push({
      role: 'assistant',
      content: resp.content,
      ...(resp.toolCalls ? { tool_calls: resp.toolCalls } : {})
    } as ChatMessage)

    for (const call of calls) {
      const name = call.function?.name ?? ''
      const callId = call.id ?? `call_${round}_${name}`
      const rawArgs = call.function?.arguments ?? ''
      let args: Record<string, unknown> = {}
      try {
        args = rawArgs ? JSON.parse(rawArgs) : {}
      } catch {
        args = {}
      }

      const label = options?.toolLabel?.(name)
      try {
        options?.onToolEvent?.({ id: callId, round, phase: 'start', name, label, args: rawArgs })
      } catch {
        /* 忽略事件回调自身异常 */
      }

      const startedAt = Date.now()
      let result: string
      let state: 'done' | 'failed' = 'done'
      try {
        result = await options!.toolExecutor!(name, args, mode)
      } catch (e) {
        result = `工具执行失败：${(e as Error).message}`
        state = 'failed'
      }
      const durationMs = Date.now() - startedAt
      const clipped = clipToolResult(result)

      trace.push({ id: callId, name, label, args: rawArgs, result: clipped, state, durationMs })

      try {
        options?.onToolEvent?.({
          id: callId,
          round,
          phase: 'end',
          name,
          label,
          args: rawArgs,
          result: clipped,
          state,
          durationMs
        })
      } catch {
        /* 忽略事件回调自身异常 */
      }

      working.push({
        role: 'tool',
        content: result,
        tool_call_id: callId
      } as unknown as ChatMessage)
    }
  }

  return { content: lastContent || '（模型未返回文本）', reasoning: lastReasoning || undefined, toolCalls: trace, stopped: false }
}

/** 测试模型连接：发一个最小请求验证配置可用（参照 Shorekeeper SETTINGS_TEST_CONNECTION） */
export async function testConnection(cfg: LlmConfig): Promise<TestConnectionResult> {
  const start = Date.now()
  if (!cfg.baseURL.trim() || !cfg.apiKey.trim() || !cfg.model.trim()) {
    return { ok: false, error: '请先填写接口地址、API Key 与模型名' }
  }

  const baseURL = cfg.baseURL.trim().replace(/\/+$/, '')
  const urls = chatURLs(baseURL)
  const timeoutSec = cfg.timeoutSec > 0 ? cfg.timeoutSec : 120
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutSec, 30) * 1000)

  let lastBody = ''
  try {
    for (let idx = 0; idx < urls.length; idx++) {
      const res = await fetch(urls[idx], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey.trim()}`
        },
        body: JSON.stringify({
          model: cfg.model.trim(),
          messages: [{ role: 'user', content: '你好' }],
          max_tokens: 8,
          stream: false
        }),
        signal: controller.signal
      })
      const latencyMs = Date.now() - start

      if (res.status === 404 && idx < urls.length - 1) {
        lastBody = await res.text().catch(() => '')
        continue // 切到备用地址（MaaS /api/v1 → /compatible-mode/v1）
      }

      if (!res.ok) {
        lastBody = await res.text().catch(() => '')
        if (res.status === 404) {
          return {
            ok: false,
            latencyMs,
            error: `HTTP 404：该地址不支持 /chat/completions。阿里云 MaaS 网关请使用兼容模式地址（…/compatible-mode/v1）；若已使用该地址，请检查模型名是否正确。`
          }
        }
        return { ok: false, latencyMs, error: `HTTP ${res.status}：${lastBody.slice(0, 240)}` }
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) return { ok: false, latencyMs, error: '接口返回为空，请检查模型名是否正确' }
      return {
        ok: true,
        latencyMs,
        model: cfg.model.trim(),
        provider: cfg.provider || detectProvider(cfg)
      }
    }
    return { ok: false, error: `HTTP 404：${lastBody.slice(0, 200)}` }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    return { ok: false, latencyMs: Date.now() - start, error: err.name === 'AbortError' ? '连接超时' : err.message }
  } finally {
    clearTimeout(timer)
  }
}

/** 获取模型列表：调用 OpenAI 兼容的 GET /models（参照参考图的「连接并获取模型」） */
export async function fetchModelList(cfg: LlmConfig): Promise<ModelListResult> {
  const start = Date.now()
  if (!cfg.baseURL.trim() || !cfg.apiKey.trim()) {
    return { ok: false, error: '请先填写接口地址与 API Key，再获取模型列表' }
  }

  const baseURL = cfg.baseURL.trim().replace(/\/+$/, '')
  const timeoutSec = cfg.timeoutSec > 0 ? cfg.timeoutSec : 120
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(timeoutSec, 30) * 1000)

  const getJson = async (url: string): Promise<{ status: number; text: string }> => {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.apiKey.trim()}` },
      signal: controller.signal
    })
    return { status: res.status, text: await res.text().catch(() => '') }
  }

  try {
    const first = await getJson(`${baseURL}/models`)
    const latencyMs = Date.now() - start

    if (![200, 201].includes(first.status)) {
      if (first.status === 404) {
        return {
          ok: false,
          latencyMs,
          error: `该接口不支持模型列表查询（HTTP 404）。部分网关（如火山方舟推理接入点、专属网关）不开放 /models 端点，可直接在下方手填模型名。`
        }
      }
      return { ok: false, latencyMs, error: `HTTP ${first.status}：${first.text.slice(0, 240)}` }
    }

    const parseBody = (text: string): { ids: string[]; maas?: { total: number; pageSize: number; pageNo: number } } => {
      try {
        const data = JSON.parse(text)
        // 阿里云 MaaS 网关：output.models[].model
        if (data?.output && Array.isArray(data.output.models)) {
          const ids = data.output.models
            .map((m: { model?: string; name?: string }) => m.model ?? m.name ?? '')
            .filter((s: string) => typeof s === 'string' && s.trim().length > 0)
            .map((s: string) => s.trim())
          return {
            ids,
            maas: {
              total: Number(data.output.total) || 0,
              pageSize: Number(data.output.page_size) || ids.length,
              pageNo: Number(data.output.page_no) || 1
            }
          }
        }
        // OpenAI 兼容：data[].id / data[].model / data[].name
        if (Array.isArray(data.data)) {
          const ids = data.data
            .map((m: { id?: string; model?: string; name?: string }) => m.id ?? m.model ?? m.name ?? '')
            .filter((s: string) => typeof s === 'string' && s.trim().length > 0)
            .map((s: string) => s.trim())
          return { ids }
        }
        // 简单格式：models[] 字符串数组
        if (Array.isArray(data.models)) {
          const ids = data.models.filter((s: string) => typeof s === 'string' && s.trim().length > 0).map((s: string) => s.trim())
          return { ids }
        }
        return { ids: [] }
      } catch {
        return { ids: [] }
      }
    }

    const firstParsed = parseBody(first.text)

    // MaaS 网关分页拉全量：page_size=100，串行但每页快，受总超时约束
    if (firstParsed.maas && firstParsed.maas.total > firstParsed.ids.length) {
      const { total, pageSize, pageNo } = firstParsed.maas
      const size = 100
      const totalPages = Math.ceil(total / size)
      const ids = new Set(firstParsed.ids)
      for (let p = pageNo + 1; p <= totalPages; p++) {
        if (controller.signal.aborted) break
        const r = await getJson(`${baseURL}/models?page_no=${p}&page_size=${size}`)
        if (![200, 201].includes(r.status)) break
        const chunk = parseBody(r.text)
        chunk.ids.forEach((s) => ids.add(s))
      }
      const unique = [...ids].sort((a, b) => a.localeCompare(b))
      if (unique.length === 0) {
        return { ok: false, latencyMs, error: '接口已响应，但未解析到任何模型。可直接在下方手填模型名。' }
      }
      return { ok: true, latencyMs, models: unique, count: unique.length }
    }

    const unique = [...new Set(firstParsed.ids)].sort((a, b) => a.localeCompare(b))
    if (unique.length === 0) {
      return { ok: false, latencyMs, error: '接口已响应，但未解析到任何模型（返回格式不支持）。可直接在下方手填模型名。' }
    }
    return { ok: true, latencyMs, models: unique, count: unique.length }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    return {
      ok: false,
      latencyMs: Date.now() - start,
      error: err.name === 'AbortError' ? '连接超时' : err.message
    }
  } finally {
    clearTimeout(timer)
  }
}
