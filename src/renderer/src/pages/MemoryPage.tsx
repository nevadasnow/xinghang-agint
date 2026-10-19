import { useCallback, useEffect, useState } from 'react'
import Rail from '../components/Rail'
import Motes from '../components/Motes'
import { ButterflyDefs } from '../components/ButterflySymbol'
import { getAgentRole } from '../utils/agentRoles'
import './workspace-pages.css'

interface MemoryEntry {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

function fmtTime(t: number): string {
  const d = new Date(t)
  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  onHome: () => void
  onChat: () => void
  onTasks: () => void
  onOpenSettings: () => void
  onOpenProfile?: () => void
  onAgent: () => void
  onDocs: () => void
  /** 左下角「命令」：打开命令面板 */
  onCommand?: () => void
}

/** 记忆库独立页（左侧栏「工作区 → 记忆库」）：手写记忆条目，对话时自动注入给 agent */
export default function MemoryPage({ onHome, onChat, onTasks, onOpenSettings, onOpenProfile, onAgent, onDocs, onCommand }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await window.shorekeeper.memoryList()
      if (r.ok) setEntries(r.entries ?? [])
      else setError(r.error ?? '读取失败。')
    } catch (e) {
      setError((e as Error)?.message ?? '读取失败。')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function add(): Promise<void> {
    const text = draft.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      const r = await window.shorekeeper.memoryAdd(text)
      if (r.ok) {
        setEntries(r.entries ?? [])
        setDraft('')
      } else {
        setError(r.error ?? '添加失败。')
      }
    } catch (e) {
      setError((e as Error)?.message ?? '添加失败。')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return
    const text = editing.text.trim()
    if (!text) return
    setBusy(true)
    setError('')
    try {
      const r = await window.shorekeeper.memoryUpdate(editing.id, text)
      if (r.ok) {
        setEntries(r.entries ?? [])
        setEditing(null)
      } else {
        setError(r.error ?? '保存失败。')
      }
    } catch (e) {
      setError((e as Error)?.message ?? '保存失败。')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const r = await window.shorekeeper.memoryDelete(id)
      if (r.ok) setEntries(r.entries ?? [])
      else setError(r.error ?? '删除失败。')
    } catch (e) {
      setError((e as Error)?.message ?? '删除失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="memory-page-app">
      <ButterflyDefs />
      <Motes />
      <Rail
        active="memory"
        onHome={onHome}
        onChat={onChat}
        onTasks={onTasks}
        onAgent={onAgent}
        onToggleDocs={onDocs}
        onToggleMemory={() => undefined}
        onSettings={onOpenSettings}
        onOpenProfile={onOpenProfile}
        onCommand={onCommand}
      />
      <main className="page-main">
        <header className="page-head">
          <div>
            <h2 className="page-title">记忆库</h2>
            <p className="page-sub">
              {getAgentRole().name}会记住这里的碎片，并在后续对话中自然提到（最多注入 12 条 · 每条 200 字）。仅保存在本地。
            </p>
          </div>
        </header>

        <section className="page-card memory-page-body">
          {error && <div className="doc-error">{error}</div>}

          {/* 添加区 */}
          <div className="memory-add">
            <textarea
              className="memory-add-input"
              placeholder="写一条想让她记住的事，例如：我最近在准备驾照科目一，怕记不住交规…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
            />
            <button type="button" className="memory-add-btn" onClick={() => void add()} disabled={busy || !draft.trim()}>
              记下来
            </button>
          </div>

          {/* 列表 */}
          <div className="memory-list">
            {entries.length === 0 ? (
              <div className="doc-empty">
                <div className="doc-empty-glyph" aria-hidden="true">
                  ♒
                </div>
                <p className="doc-empty-title">记忆还是空的</p>
                <p className="doc-empty-desc">在上面写一条，之后每次对话她都会带着这份记忆。</p>
              </div>
            ) : (
              entries.map((m) => (
                <div key={m.id} className="memory-item">
                  {editing && editing.id === m.id ? (
                    <div className="memory-edit">
                      <textarea
                        className="memory-edit-input"
                        value={editing.text}
                        onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                        rows={3}
                      />
                      <div className="memory-edit-actions">
                        <button
                          type="button"
                          className="memory-btn"
                          onClick={() => void saveEdit()}
                          disabled={busy || !editing.text.trim()}
                        >
                          保存
                        </button>
                        <button type="button" className="memory-btn ghost" onClick={() => setEditing(null)} disabled={busy}>
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="memory-item-text">{m.text}</div>
                      <div className="memory-item-foot">
                        <span className="memory-item-time">记于 {fmtTime(m.createdAt)}</span>
                        {m.updatedAt !== m.createdAt && (
                          <span className="memory-item-time">· 改于 {fmtTime(m.updatedAt)}</span>
                        )}
                        <span className="memory-item-actions">
                          <button
                            type="button"
                            className="memory-btn"
                            onClick={() => setEditing({ id: m.id, text: m.text })}
                            title="编辑"
                          >
                            编辑
                          </button>
                          <button type="button" className="memory-btn danger" onClick={() => void remove(m.id)} title="删除">
                            删除
                          </button>
                        </span>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <p className="doc-footnote">数据文件：userData/memory.json，可随时删除重置。</p>
        </section>
      </main>
    </div>
  )
}
