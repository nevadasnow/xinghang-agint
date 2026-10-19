import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * E1 工作区文件（右侧面板 tab）
 *
 * 从"空壳"换成真功能：列出会话工作区（= 应用运行目录，与终端 cwd 同一处）的内容，
 * 展开目录、读取文本预览、在资源管理器里定位。
 *
 * 为什么与终端同一个根目录：两处若各用一个根，用户在终端 `dir` 到的内容
 * 和面板里看到的对不上，会以为面板坏了。
 *
 * 刻意**只读**：不提供删除/重命名/新建 —— 这些动作有破坏性，
 * 而右侧面板是个随手点开的地方，不适合放破坏性操作。
 * 需要改动文件时走 Agent 工具或终端，那两处都有明确的调用记录。
 */

interface Entry {
  name: string
  rel: string
  isDir: boolean
  size: number
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** 按扩展名给一个字符图标（不引图标库） */
function iconOf(e: Entry): string {
  if (e.isDir) return '▸'
  const ext = e.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return '⟨⟩'
  if (['.json', '.yaml', '.yml', '.toml', '.ini', '.cfg'].includes(ext)) return '{}'
  if (['.md', '.markdown', '.txt', '.log'].includes(ext)) return '¶'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'].includes(ext)) return '▣'
  if (['.css', '.scss', '.less', '.html', '.htm'].includes(ext)) return '◈'
  return '·'
}

export default function WorkspaceFilesPane() {
  const [root, setRoot] = useState('')
  /** 当前列出的相对路径 */
  const [cwd, setCwd] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  /** 已展开的目录 -> 其子项 */
  const [open, setOpen] = useState<Record<string, Entry[]>>({})
  /** 正在预览的文件 */
  const [preview, setPreview] = useState<{
    rel: string
    text: string
    truncated?: boolean
    notice?: string
  } | null>(null)
  const seq = useRef(0)

  const load = useCallback(async (rel: string) => {
    const mine = ++seq.current
    setLoading(true)
    setErr('')
    const r = await window.shorekeeper.workspaceList(rel)
    if (mine !== seq.current) return // 快速切换目录时丢弃过期结果
    setLoading(false)
    if (!r.ok) {
      setErr(r.error || '读取失败')
      setEntries([])
      return
    }
    setEntries(r.entries ?? [])
  }, [])

  useEffect(() => {
    void window.shorekeeper.workspaceRoot().then((p) => setRoot(p || ''))
    void load('')
  }, [load])

  /** 展开/收起一个目录（首次展开时才去读，避免一次列出整棵树） */
  async function toggleDir(e: Entry): Promise<void> {
    if (open[e.rel]) {
      setOpen((prev) => {
        const next = { ...prev }
        delete next[e.rel]
        return next
      })
      return
    }
    const r = await window.shorekeeper.workspaceList(e.rel)
    if (!r.ok) {
      setErr(r.error || '读取失败')
      return
    }
    setOpen((prev) => ({ ...prev, [e.rel]: r.entries ?? [] }))
  }

  async function openFile(e: Entry): Promise<void> {
    const r = await window.shorekeeper.workspaceRead(e.rel)
    if (!r.ok) {
      setPreview({ rel: e.rel, text: '', notice: r.notice || r.error || '无法预览' })
      return
    }
    setPreview({ rel: e.rel, text: r.text ?? '', truncated: r.truncated })
  }

  /** 面包屑：把相对路径拆成可点的层级 */
  const crumbs = cwd ? cwd.split(/[\\/]/).filter(Boolean) : []

  function renderRows(list: Entry[], depth: number): React.ReactNode {
    return list.map((e) => {
      const kids = open[e.rel]
      return (
        <div key={e.rel}>
          <button
            type="button"
            className={'ws-row' + (e.isDir ? ' is-dir' : '') + (preview?.rel === e.rel ? ' is-active' : '')}
            style={{ paddingLeft: 8 + depth * 13 }}
            title={e.rel}
            onClick={() => (e.isDir ? void toggleDir(e) : void openFile(e))}
          >
            <span className={'ws-ic' + (kids ? ' open' : '')} aria-hidden="true">
              {iconOf(e)}
            </span>
            <span className="ws-name">{e.name}</span>
            {!e.isDir && <span className="ws-size">{fmtSize(e.size)}</span>}
          </button>
          {kids && kids.length > 0 && <div>{renderRows(kids, depth + 1)}</div>}
          {kids && kids.length === 0 && (
            <div className="ws-empty-dir" style={{ paddingLeft: 21 + depth * 13 }}>
              空目录
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div className="rp-files">
      <div className="rp-files-head">
        <span className="rp-files-title">工作区文件</span>
        <button
          type="button"
          className="rp-icon-btn"
          title="刷新当前目录"
          onClick={() => {
            setOpen({})
            setPreview(null)
            void load(cwd)
          }}
        >
          ⟳
        </button>
      </div>

      {/* 面包屑 + 工作区根路径 */}
      <div className="ws-crumbs">
        <button
          type="button"
          className={'ws-crumb' + (cwd === '' ? ' is-cur' : '')}
          onClick={() => {
            setCwd('')
            void load('')
          }}
        >
          工作区
        </button>
        {crumbs.map((c, i) => {
          const rel = crumbs.slice(0, i + 1).join('/')
          return (
            <span key={rel} className="ws-crumb-wrap">
              <span className="ws-crumb-sep">/</span>
              <button
                type="button"
                className={'ws-crumb' + (i === crumbs.length - 1 ? ' is-cur' : '')}
                onClick={() => {
                  setCwd(rel)
                  void load(rel)
                }}
              >
                {c}
              </button>
            </span>
          )
        })}
      </div>
      {root && (
        <div className="ws-root" title={root}>
          {root}
        </div>
      )}

      {loading && <p className="ws-hint">读取中…</p>}
      {err && <p className="ws-hint ws-hint-bad">{err}</p>}
      {!loading && !err && entries.length === 0 && <p className="ws-hint">这个目录是空的</p>}

      <div className="ws-tree">{renderRows(entries, 0)}</div>

      {/* 预览区：只读，超大文件会说明已截断 */}
      {preview && (
        <div className="ws-preview">
          <div className="ws-preview-head">
            <span className="ws-preview-name" title={preview.rel}>
              {preview.rel}
            </span>
            <button
              type="button"
              className="rp-icon-btn"
              title="在资源管理器中显示"
              onClick={() => void window.shorekeeper.workspaceReveal(preview.rel)}
            >
              ⧉
            </button>
            <button type="button" className="rp-icon-btn" title="关闭预览" onClick={() => setPreview(null)}>
              ✕
            </button>
          </div>
          {preview.notice ? (
            <p className="ws-hint">{preview.notice}</p>
          ) : (
            <>
              {preview.truncated && <p className="ws-hint">文件较大，只显示前面一部分。</p>}
              <pre className="ws-preview-pre">{preview.text}</pre>
            </>
          )}
        </div>
      )}
    </div>
  )
}
