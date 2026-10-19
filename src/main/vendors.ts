import type { VendorPreset } from '../shared/types'

/**
 * 厂商预设注册表。
 * 参照 Shorekeeper 的 vendor-registry 结构（capability: baseUrl / defaultModel / transport），
 * 这里只保留本项目支持的 OpenAI 兼容国内端点。
 * 模型名与默认值以 Shorekeeper 2026 年 registry 及厂商公开文档为准。
 */
export const VENDOR_PRESETS: VendorPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek（深度求索）',
    baseURL: 'https://api.deepseek.com',
    models: ['deepseek-chat', 'deepseek-flash', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
    note: 'deepseek-chat 为通用对话；deepseek-flash 为 V4.1 Flash；deepseek-reasoner 为思考模型。'
  },
  {
    id: 'doubao',
    name: '豆包（火山方舟）',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-2-1-pro-260628', 'doubao-1-5-pro-32k-250115', 'doubao-1-5-flash-32k-250115'],
    defaultModel: 'doubao-seed-2-1-pro-260628',
    note: '也可在火山方舟控制台创建推理接入点，模型名填 ep-xxx 端点 ID。'
  },
  {
    id: 'qwen',
    name: '通义千问（DashScope）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
    defaultModel: 'qwen-max',
    note: '官方 OpenAI 兼容模式；新模型可先查询百炼控制台确认模型名。'
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.2', 'glm-5.1', 'glm-5-flash', 'glm-4.6'],
    defaultModel: 'glm-5.2',
    note: 'OpenAI 兼容端点；glm-5.3 系列为强制思考模型，多步任务注意开销。'
  },
  {
    id: 'minimax',
    name: 'MiniMax（稀宇科技）',
    baseURL: 'https://api.minimaxi.com/v1',
    models: ['MiniMax-M3', 'MiniMax-Text-01'],
    defaultModel: 'MiniMax-M3',
    note: 'OpenAI 兼容端点；M3 为旗舰模型。'
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    baseURL: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3', 'kimi-k2.7-code', 'moonshot-v1-32k'],
    defaultModel: 'kimi-k2.7-code',
    note: '官方仅兼容 Chat Completions；kimi-k3 为旗舰思考模型。'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseURL: '',
    models: [],
    defaultModel: '',
    note: '任意 OpenAI 兼容接口：填写 Base URL（通常以 /v1 结尾）+ API Key + 模型名。'
  }
]

export function findVendor(idOrName: string): VendorPreset | undefined {
  return VENDOR_PRESETS.find((v) => v.id === idOrName || v.name === idOrName)
}

/** 根据已保存的 baseURL 反查最匹配的厂商预设（用于打开设置时回显） */
export function matchVendorByBaseURL(baseURL: string): VendorPreset | undefined {
  const url = (baseURL || '').trim().toLowerCase()
  if (!url) return undefined
  return VENDOR_PRESETS.find((v) => v.baseURL && url.startsWith(v.baseURL.toLowerCase()))
}

export function vendorNameOf(baseURL: string): string {
  return matchVendorByBaseURL(baseURL)?.name ?? (baseURL ? '自定义' : '未配置')
}
