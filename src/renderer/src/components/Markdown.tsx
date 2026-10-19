import { useState, type ReactNode } from 'react'
import { requestTerminalCommand } from '../utils/terminalBus'

interface Props {
  content: string
  /** 可选：当前对话搜索关键词，命中文本包 <mark>（不处理代码块内容） */
  highlight?: string
}

/**
 * 轻量 Markdown 渲染（不引入 markdown 依赖，保持供应链干净、产物小）。
 *
 * 支持：围栏代码块（带复制按钮）、行内代码、粗体、斜体、标题、无序/有序列表、链接、引用。
 * 刻意不支持表格与嵌套列表 —— 需要时再换成熟库，而不是在这里堆复杂度。
 */

type Block =
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'text'; lines: string[] }

/** 按围栏代码块切分，块外内容按行保留 */
function splitBlocks(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.split('\n')
  let buf: string[] = []
  let i = 0

  const flush = (): void => {
    if (buf.length > 0) {
      blocks.push({ kind: 'text', lines: buf })
      buf = []
    }
  }

  while (i < lines.length) {
    const fence = /^\s*```(.*)$/.exec(lines[i])
    if (fence) {
      flush()
      const lang = fence[1].trim()
      const code: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i])
        i += 1
      }
      i += 1 // 跳过收尾围栏
      blocks.push({ kind: 'code', lang, text: code.join('\n') })
      continue
    }
    buf.push(lines[i])
    i += 1
  }
  flush()
  return blocks
}

/** 关键词高亮：把一段文本里命中 q 的片段包成 <mark>（大小写不敏感） */
function hl(text: string, q: string | undefined, keyBase: string): ReactNode[] {
  const needle = q?.trim()
  if (!needle || !text) return [text]
  const lower = text.toLowerCase()
  const low = needle.toLowerCase()
  const out: ReactNode[] = []
  let from = 0
  let k = 0
  for (;;) {
    const at = lower.indexOf(low, from)
    if (at < 0) break
    if (at > from) out.push(text.slice(from, at))
    out.push(<mark key={`${keyBase}-h${k++}`}>{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  if (from < text.length) out.push(text.slice(from))
  return out
}

/** 行内标记 → React 节点（顺序：代码 → 粗体 → 斜体 → 链接） */
function renderInline(text: string, keyPrefix: string, q?: string): ReactNode[] {
  const out: ReactNode[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let n = 0

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(...hl(text.slice(last, m.index), q, keyPrefix))
    const token = m[0]
    const key = `${keyPrefix}-i${n++}`
    if (token.startsWith('`')) {
      out.push(
        <code className="md-inline-code" key={key}>
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      out.push(<strong key={key}>{hl(token.slice(2, -2), q, key)}</strong>)
    } else if (token.startsWith('*')) {
      out.push(<em key={key}>{hl(token.slice(1, -1), q, key)}</em>)
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link) {
        out.push(
          <a className="md-link" key={key} href={link[2]} target="_blank" rel="noreferrer noopener">
            {hl(link[1], q, key)}
          </a>
        )
      } else {
        out.push(...hl(token, q, key))
      }
    }
    last = m.index + token.length
  }
  if (last < text.length) out.push(...hl(text.slice(last), q, keyPrefix))
  return out
}

/** E2：哪些语言标记下的代码块可以送进终端执行 */
const SHELL_LANGS = new Set([
  'sh',
  'bash',
  'shell',
  'zsh',
  'powershell',
  'ps1',
  'pwsh',
  'cmd',
  'bat',
  'batch',
  'console',
  'terminal'
])

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState('')

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  /**
   * E2 在终端运行。
   *
   * 只取**第一行非注释命令**：模型给的示例常带多行与 `#` 注释，
   * 整段塞进终端会执行到注释或后续无关命令，比不执行更危险。
   */
  function runInTerminal(): void {
    const first = text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('//'))
    if (!first) {
      setSent('没有可执行的命令行')
      window.setTimeout(() => setSent(''), 1800)
      return
    }
    const ok = requestTerminalCommand(first, false)
    setSent(ok ? '已送到终端（未自动执行）' : '请先打开右侧面板的终端')
    window.setTimeout(() => setSent(''), 2200)
  }

  const isShell = SHELL_LANGS.has((lang || '').toLowerCase())

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || 'text'}</span>
        {sent && <span className="md-code-sent">{sent}</span>}
        {isShell && (
          <button className="md-code-copy" onClick={runInTerminal} title="把第一条命令送到右侧终端">
            在终端运行
          </button>
        )}
        <button className="md-code-copy" onClick={copy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{text}</code>
      </pre>
    </div>
  )
}

/** 文本块 → 段落 / 标题 / 列表 / 引用 */
function TextBlock({ lines, keyPrefix, q }: { lines: string[]; keyPrefix: string; q?: string }) {
  const nodes: ReactNode[] = []
  let listBuf: { ordered: boolean; items: string[] } | null = null
  let n = 0

  const flushList = (): void => {
    if (listBuf === null) return
    const key = `${keyPrefix}-l${n++}`
    const items = listBuf.items.map((item, idx) => <li key={`${key}-${idx}`}>{renderInline(item, `${key}-${idx}`, q)}</li>)
    nodes.push(listBuf.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>)
    listBuf = null
  }

  for (const line of lines) {
    if (!line.trim()) {
      flushList()
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)

    if (heading) {
      flushList()
      const level = heading[1].length
      const key = `${keyPrefix}-h${n++}`
      const content = renderInline(heading[2], key, q)
      nodes.push(
        level === 1 ? (
          <h1 key={key}>{content}</h1>
        ) : level === 2 ? (
          <h2 key={key}>{content}</h2>
        ) : level === 3 ? (
          <h3 key={key}>{content}</h3>
        ) : (
          <h4 key={key}>{content}</h4>
        )
      )
    } else if (ul) {
      if (listBuf?.ordered !== false) {
        flushList()
        listBuf = { ordered: false, items: [] }
      }
      listBuf.items.push(ul[1])
    } else if (ol) {
      if (listBuf?.ordered !== true) {
        flushList()
        listBuf = { ordered: true, items: [] }
      }
      listBuf.items.push(ol[1])
    } else if (quote) {
      flushList()
      nodes.push(
        <blockquote className="md-quote" key={`${keyPrefix}-q${n++}`}>
          {renderInline(quote[1], `${keyPrefix}-q${n}`, q)}
        </blockquote>
      )
    } else {
      flushList()
      nodes.push(
        <p className="md-p" key={`${keyPrefix}-p${n++}`}>
          {renderInline(line, `${keyPrefix}-p${n}`, q)}
        </p>
      )
    }
  }
  flushList()
  return <>{nodes}</>
}

export default function Markdown({ content, highlight }: Props) {
  const blocks = splitBlocks(content)
  return (
    <div className="md">
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <CodeBlock key={`c${i}`} lang={b.lang} text={b.text} />
        ) : (
          <TextBlock key={`t${i}`} lines={b.lines} keyPrefix={`t${i}`} q={highlight} />
        )
      )}
    </div>
  )
}
