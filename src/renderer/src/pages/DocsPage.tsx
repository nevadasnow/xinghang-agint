import { useCallback, useEffect, useState } from 'react'
import Rail from '../components/Rail'
import Motes from '../components/Motes'
import { ButterflyDefs } from '../components/ButterflySymbol'
import './workspace-pages.css'

/**
 * 文档 · 工作区独立页（左侧栏「工作区 → 文档」）。
 * 浏览「会话工作区」（= 应用运行目录，与终端默认 cwd 同一处），
 * 进入目录、预览文本类文件、在系统文件夹中定位；全程只读。
 */

interface DirEntry {
  name: string
  rel: string
  isDir: boolean
  size: number
}

interface Preview {
  rel: string
  name: string
  text: string
  truncated?: boolean
  notice?: string
  error?: string
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

interface Props {
  onHome: () => void
  onChat: () => void
  onTasks: () => void
  onOpenSettings: () => void
  onOpenProfile?: () => void
  onAgent: () => void
  onMemory: () => void
  /** 左下角「命令」：打开命令面板 */
  onCommand?: () => void
}

export default function DocsPage({ onHome, onChat, onTasks, onOpenSettings, onOpenProfile, onAgent, onMemory, onCommand }: Props) {
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rootName, setRootName] = useState('工作区')
  const [preview, setPreview] = useState<Preview | null>(null)

  const load = useCallback(async (rel: string) => {
    setLoading(true)
    setError('')
    setPreview(null)
    try {
      const r = await window.shorekeeper.workspaceList(rel || undefined)
      if (!r.ok) {
        setError(r.error ?? '读取目录失败。')
        setEntries(null)
      } else {
        setPath(r.path ?? '')
        setEntries(r.entries ?? [])
      }
    } catch (e) {
      setError((e as Error)?.message ?? '读取目录失败。')
      setEntries(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load('')
    void window.shorekeeper.workspaceRoot().then((root) => {
      const seg = root.split(/[\\/]/).filter(Boolean)
      setRootName(seg[seg.length - 1] || '工作区')
    })
  }, [load])

  function openDir(rel: string): void {
    void load(rel)
  }

  function goRoot(): void {
    void load('')
  }

  function goUp(): void {
    if (!path) return
    const seg = path.split(/[\\/]/)
    seg.pop()
    void load(seg.join('/'))
  }

  async function openFile(e: DirEntry): Promise<void> {
    setLoading(true)
    setError('')
    try {
      const r = await window.shorekeeper.workspaceRead(e.rel)
      setPreview({ rel: e.rel, name: e.name, text: r.text ?? '', truncated: r.truncated, notice: r.notice, error: r.error })
    } catch (err) {
      setPreview({ rel: e.rel, name: e.name, text: '', error: (err as Error)?.message ?? '读取失败。' })
    } finally {
      setLoading(false)
    }
  }

  function reveal(e: DirEntry | { rel: string }): void {
    void window.shorekeeper.workspaceReveal(e.rel)
  }

  const crumbs = path ? ['', ...path.split(/[\\/]/)] : ['']

  return (
    <div className="docs-page-app">
      <ButterflyDefs />
      <Motes />
      <Rail
        active="docs"
        onHome={onHome}
        onChat={onChat}
        onTasks={onTasks}
        onAgent={onAgent}
        onToggleDocs={() => undefined}
        onToggleMemory={onMemory}
        onSettings={onOpenSettings}
        onOpenProfile={onOpenProfile}
        onCommand={onCommand}
      />
      <main className="page-main">
        <header className="page-head">
          <div>
            <h2 className="page-title">文档 · 工作区</h2>
            <p className="page-sub">
              工作区 = 应用运行目录（{rootName}），与终端默认目录一致；仅本地只读。
            </p>
          </div>
        </header>

        <section className="page-card docs-page-body">
          {/* 路径面包屑 + 返回上级 */}
          <div className="doc-crumbs">
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1
              const target = crumbs.slice(1, i + 1).join('/')
              return (
                <span key={i}>
                  {i > 0 && <span className="doc-crumb-sep">/</span>}
                  {isLast ? (
                    <span className="doc-crumb-cur">{c || rootName}</span>
                  ) : (
                    <button type="button" className="doc-crumb" onClick={() => void load(target)}>
                      {c || rootName}
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          <div className="doc-toolbar">
            <button type="button" className="doc-tb-btn" onClick={goRoot} disabled={!path}>
              ⟲ 根目录
            </button>
            <button type="button" className="doc-tb-btn" onClick={goUp} disabled={!path}>
              ↑ 上级
            </button>
            <button type="button" className="doc-tb-btn" onClick={() => void load(path)} disabled={loading}>
              ⟳ 刷新
            </button>
          </div>

          {error && <div className="doc-error">{error}</div>}

          {loading && !preview ? (
            <div className="doc-empty">
              <div className="doc-empty-glyph" aria-hidden="true">
                ◌
              </div>
              <p className="doc-empty-title">正在读取…</p>
            </div>
          ) : preview ? (
            <div className="doc-viewer">
              <div className="doc-viewer-head">
                <span className="doc-viewer-name" title={preview.rel}>
                  {preview.name}
                </span>
                <button type="button" className="doc-tb-btn" onClick={() => reveal(preview)} title="在文件夹中显示">
                  📂 定位
                </button>
                <button type="button" className="doc-tb-btn" onClick={() => setPreview(null)} title="返回文件列表">
                  ← 返回
                </button>
              </div>
              {preview.error ? (
                <div className="doc-viewer-empty">{preview.error}</div>
              ) : preview.notice ? (
                <div className="doc-viewer-empty">{preview.notice}</div>
              ) : (
                <pre className="doc-viewer-pre">
                  {preview.text}
                  {preview.truncated ? '\n\n…（文件过大，仅显示前半部分）' : ''}
                </pre>
              )}
            </div>
          ) : (
            <div className="doc-list">
              {!entries || entries.length === 0 ? (
                <div className="doc-empty">
                  <div className="doc-empty-glyph" aria-hidden="true">
                    ▤
                  </div>
                  <p className="doc-empty-title">这个目录是空的</p>
                  <p className="doc-empty-desc">Agent 生成 / 写入的文件会落在工作区里，可在这里直接浏览文本内容。</p>
                </div>
              ) : (
                entries.map((e) => (
                  <div key={e.rel} className={'doc-item' + (e.isDir ? ' dir' : '')}>
                    <button
                      type="button"
                      className="doc-item-main"
                      onClick={() => (e.isDir ? openDir(e.rel) : void openFile(e))}
                      title={e.isDir ? `进入 ${e.name}` : `预览 ${e.name}`}
                    >
                      <span className="doc-item-ic" aria-hidden="true">
                        {e.isDir ? '▸' : '▫'}
                      </span>
                      <span className="doc-item-name">{e.name}</span>
                      <span className="doc-item-size">{e.isDir ? '' : fmtSize(e.size)}</span>
                    </button>
                    <button type="button" className="doc-item-reveal" title="在文件夹中显示" onClick={() => reveal(e)}>
                      📂
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
