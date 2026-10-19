/**
 * 内置浏览器的 Agent 工具（规格 5 · 八 · 8.1）。
 *
 * 6 个工具操作的是**面板里那个 <webview> 实例**（经 browser-bridge 登记），
 * 所以「用户用鼠标点的页面」和「Agent 操作的页面」是同一个：
 * Agent 调 browser_open / click / fill 之后，面板会自动跳转并刷新地址栏。
 *
 * risk / effectKind 严格按规格表格：
 *   browser_open       network        mutation
 *   browser_snapshot   safe           read
 *   browser_click      input-control  external_side_effect
 *   browser_fill       input-control  external_side_effect
 *   browser_screenshot safe           read
 *   browser_close      safe           mutation
 *
 * 本文件只导出「定义 + 参数 schema」，注册动作由 tools.ts 的 registerAllTools 负责。
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ToolDefinition } from '../shared/types'
import {
  agentCapture,
  agentClick,
  agentClose,
  agentFill,
  agentNavigate,
  agentSnapshot,
  normalizeHttpUrl
} from './browser-bridge'

/** 截图落盘目录：应用工作目录下的 .sk-browser */
function shotDir(): string {
  return join(process.cwd(), '.sk-browser')
}

function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    id: 'browser_open',
    name: '打开网址',
    description:
      '在内置浏览器（右侧面板的浏览器 tab）中打开一个 http/https 网址，用户在面板里能直接看到并继续操作。只允许 http / https。若浏览器面板还没打开，会自动打开右侧面板与浏览器 tab 并新建标签页，无需用户先手动操作。',
    enabled: true,
    modes: ['work'],
    effectKind: 'mutation',
    risk: 'network',
    verificationPolicy: 'none',
    execute: async (args) => {
      const raw = String(args['url'] ?? '')
      const target = normalizeHttpUrl(raw)
      if (!target) {
        return `拒绝打开：只允许 http / https 网址（收到：${raw.slice(0, 80)}）。file: / javascript: / data: 等协议已被禁用。`
      }
      const r = await agentNavigate(target)
      if (!r.ok) return r.error
      return `已在内置浏览器打开：${r.url}\n页面标题：${r.title || '(无)'}`
    }
  },
  {
    id: 'browser_snapshot',
    name: '读取页面结构',
    description:
      '读取内置浏览器当前页面的标题、URL、可见文本（截断）以及可交互元素列表（链接/按钮/输入框，带 index 与 selector）。点击与填写要用这里返回的 index。',
    enabled: true,
    modes: ['work'],
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => {
      const r = await agentSnapshot()
      if (!r.ok) return r.error
      const s = r.snapshot
      const head = [
        `URL：${s.url}`,
        `标题：${s.title || '(无)'}`,
        `可交互元素：${s.elements.length} 个（页面共匹配 ${s.total} 个候选）`
      ]
      const list = s.elements.map((e) => {
        const bits = [`[${e.index}]`, e.tag]
        if (e.type && e.type !== e.tag) bits.push(`type=${e.type}`)
        if (e.disabled) bits.push('(disabled)')
        if (e.text) bits.push(`"${e.text}"`)
        if (e.href) bits.push(`→ ${e.href}`)
        if (e.value) bits.push(`value="${e.value}"`)
        bits.push(`selector=${e.selector}`)
        return bits.join(' ')
      })
      const text = [
        '--- 可见文本（截断至 4000 字符）---',
        s.text ? s.text.slice(0, 4000) : '(空)',
        s.textTruncated ? '…（文本已截断）' : ''
      ].filter(Boolean)
      return [...head, '', '--- 可交互元素 ---', ...(list.length ? list : ['(没有可见的可交互元素)']), '', ...text].join('\n')
    }
  },
  {
    id: 'browser_click',
    name: '点击页面元素',
    description:
      '按 browser_snapshot 返回的 index 点击内置浏览器页面上的元素（滚动到可见、聚焦、click()，并派发鼠标事件）。index 失效会返回提示，需要重新调用 browser_snapshot。',
    enabled: true,
    modes: ['work'],
    effectKind: 'external_side_effect',
    risk: 'input-control',
    verificationPolicy: 'none',
    execute: async (args) => {
      const index = Number(args['index'])
      const r = await agentClick(index)
      if (!r.ok) return r.error
      // 点完给一份新鲜的结构，方便模型接着做下一步
      await new Promise((res) => setTimeout(res, 350))
      const snap = await agentSnapshot()
      const after = snap.ok ? `\n当前页面：${snap.snapshot.title || '(无标题)'} — ${snap.snapshot.url}` : ''
      return `已点击 <${r.tag}>（index=${Math.floor(index)}）${after}`
    }
  },
  {
    id: 'browser_fill',
    name: '填写表单',
    description:
      '按 browser_snapshot 返回的 index 向内嵌浏览器页面上的输入框/文本域填写 value（会派发 input/change 事件；submit=true 时提交所在表单或模拟回车）。',
    enabled: true,
    modes: ['work'],
    effectKind: 'external_side_effect',
    risk: 'input-control',
    verificationPolicy: 'none',
    execute: async (args) => {
      const index = Number(args['index'])
      const value = String(args['value'] ?? '')
      const submit = args['submit'] === true
      const r = await agentFill(index, value, submit)
      if (!r.ok) return r.error
      return `已向 index=${Math.floor(index)} 填入 ${value.length} 个字符${r.submitted ? '，并已提交表单' : ''}。`
    }
  },
  {
    id: 'browser_screenshot',
    name: '页面截图',
    description:
      '对内置浏览器当前页面截图（Electron capturePage），保存为 PNG 并返回文件路径。可用于确认页面渲染结果。',
    enabled: true,
    modes: ['work'],
    effectKind: 'read',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => {
      const r = await agentCapture()
      if (!r.ok) return r.error
      try {
        const png = r.image.toPNG()
        const dir = shotDir()
        mkdirSync(dir, { recursive: true })
        const file = join(dir, `shot-${stamp()}.png`)
        writeFileSync(file, png)
        const size = r.image.getSize()
        return `截图已保存：${file}\n页面：${r.title || '(无标题)'} — ${r.url}\n尺寸：${size.width}×${size.height}，${Math.round(png.length / 1024)} KB`
      } catch (e) {
        return `截图保存失败：${(e as Error).message}`
      }
    }
  },
  {
    id: 'browser_close',
    name: '关闭浏览器',
    description: '关闭内置浏览器页面：面板回到空态，并解除 Agent 对该 webview 的绑定（下次操作需要重新打开网址）。',
    enabled: true,
    modes: ['work'],
    effectKind: 'mutation',
    risk: 'safe',
    verificationPolicy: 'none',
    execute: async () => {
      const r = agentClose()
      if (!r.ok) {
        return r.error ?? '当前没有可关闭的内置浏览器页面（请先打开右侧面板的「浏览器」tab 并访问一个网址）。'
      }
      return '已关闭内置浏览器页面（面板回到空态，客户端绑定已解除）。'
    }
  }
]

/** 6 个工具的 function calling 参数 schema（tools.ts 里合并进 TOOL_PARAMS） */
export const BROWSER_TOOL_PARAMS: Record<string, Record<string, unknown>> = {
  browser_open: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '要打开的完整网址，必须以 http:// 或 https:// 开头' }
    },
    required: ['url']
  },
  browser_snapshot: { type: 'object', properties: {}, additionalProperties: false },
  browser_click: {
    type: 'object',
    properties: {
      index: { type: 'number', description: 'browser_snapshot 返回的元素 index（≥1）' }
    },
    required: ['index']
  },
  browser_fill: {
    type: 'object',
    properties: {
      index: { type: 'number', description: 'browser_snapshot 返回的输入框 index（≥1）' },
      value: { type: 'string', description: '要填入的文本' },
      submit: { type: 'boolean', description: '填完后是否提交（提交所在表单或模拟回车），默认 false' }
    },
    required: ['index', 'value']
  },
  browser_screenshot: { type: 'object', properties: {}, additionalProperties: false },
  browser_close: { type: 'object', properties: {}, additionalProperties: false }
}
