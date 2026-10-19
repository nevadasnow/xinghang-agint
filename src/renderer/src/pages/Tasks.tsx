import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskItem, TaskPriority, TaskStatus } from '../../../shared/types'
import Rail from '../components/Rail'
import Motes from '../components/Motes'
import { getAgentRole } from '../utils/agentRoles'
import './tasks.css'

interface Props {
  onHome: () => void
  onChat: () => void
  onOpenSettings: () => void
  onOpenProfile?: () => void
  /** 侧栏 ⚉ Agent：打开 Agent 档案面板（App 层） */
  onAgent?: () => void
  /** 侧栏「文档」：进入文档独立页 */
  onDocs?: () => void
  /** 侧栏「记忆库」：进入记忆库独立页 */
  onMemory?: () => void
  /** 左下角「命令」：打开命令面板 */
  onCommand?: () => void
}

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: '高', medium: '中', low: '低' }
const PRIORITY_COLOR: Record<TaskPriority, string> = { high: '#e26d7a', medium: '#d9a13b', low: '#6aa9e0' }

/** 截止时间的相对表述 */
function relDue(t?: number, now: Date = new Date()): string {
  if (!t) return ''
  const d = new Date(t)
  const day = new Date(t)
  day.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diff < 0) return `${-diff} 天前逾期 · ${hm}`
  if (diff === 0) return `今天 ${hm}`
  if (diff === 1) return `明天 ${hm}`
  if (diff <= 7) return `${diff} 天后 · ${hm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

function isOverdue(t: number, now: Date = new Date()): boolean {
  return t < now.getTime()
}

/* ============================================================
   筛选：任务多了以后，"全部"看不出重点
   ------------------------------------------------------------
   today = 截止在今天（含已逾期但未完成）；week = 未来 7 天内；
   overdue 只看已过期的；none 是无期限任务。
   ============================================================ */
type FilterKey = 'all' | 'today' | 'week' | 'overdue' | 'none'

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'today', label: '今天' },
  { key: 'week', label: '近 7 天' },
  { key: 'overdue', label: '已逾期' },
  { key: 'none', label: '无期限' }
]

function matchFilter(t: TaskItem, f: FilterKey, now: Date): boolean {
  if (f === 'all') return true
  if (f === 'none') return !t.dueAt
  if (!t.dueAt) return false
  const d = new Date(t.dueAt)
  const day = new Date(t.dueAt)
  day.setHours(0, 0, 0, 0)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
  if (f === 'overdue') return t.dueAt < now.getTime()
  if (f === 'today') return diff <= 0
  if (f === 'week') return diff >= 0 && diff <= 7
  return true
}

interface TaskDraft {
  title: string
  note: string
  priority: TaskPriority
  dueAt: string // datetime-local 的本地字符串，空表示无截止
  tag: string
}

function emptyDraft(): TaskDraft {
  return { title: '', note: '', priority: 'medium', dueAt: '', tag: '' }
}

/** 毫秒时间戳 → datetime-local 本地字符串（含时区偏移） */
function tsToLocalInput(t: number): string {
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 本地字符串 → 毫秒时间戳 */
function localInputToTs(s: string): number | undefined {
  if (!s) return undefined
  const t = new Date(s).getTime()
  return Number.isFinite(t) ? t : undefined
}

/**
 * 任务排序。
 *
 * 优先用手动顺序（sortOrder）：只要**任一**任务被拖过，整组就按手动顺序排，
 * 没被拖过的（sortOrder 为 undefined）排在其后并保持原相对顺序。
 * 这样「没排过」不会因为缺字段被当成 0 冲到最前面。
 */
function sortTasks(tasks: TaskItem[]): TaskItem[] {
  const active = tasks.filter((t) => t.status === 'active')
  const rest = tasks.filter((t) => t.status !== 'active')
  const pRank = (p: TaskPriority) => (p === 'high' ? 0 : p === 'medium' ? 1 : 2)

  const hasManual = active.some((t) => typeof t.sortOrder === 'number')
  if (hasManual) {
    // 稳定排序：有 sortOrder 的按它排；没有的用一个大值保持原下标顺序
    active.sort((a, b) => {
      const av = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
      const bv = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
      return av - bv
    })
  } else {
    active.sort((a, b) => {
      if (a.dueAt && b.dueAt) return a.dueAt - b.dueAt
      if (a.dueAt) return -1
      if (b.dueAt) return 1
      return pRank(a.priority) - pRank(b.priority)
    })
  }
  rest.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))
  return [...active, ...rest]
}

export default function Tasks({ onHome, onChat, onOpenSettings, onOpenProfile, onAgent, onDocs, onMemory, onCommand }: Props) {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKey>('all')
  const [editing, setEditing] = useState<TaskItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft())
  /** 批量模式：开启后每行前面出现勾选框 */
  const [batch, setBatch] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  /** 拖动中的任务 id（用于高亮与放手判定） */
  const dragId = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    window.shorekeeper.listTasks().then(setTasks).catch(() => setTasks([]))
  }, [])

  useEffect(() => {
    refresh()
    // agent 用 task_* 工具改过任务时，主进程会推 tasks:changed，这里实时刷新
    const off = window.shorekeeper.onTasksChanged(refresh)
    const t = window.setInterval(refresh, 30_000)
    return () => {
      off()
      window.clearInterval(t)
    }
  }, [refresh])

  const now = useMemo(() => new Date(), [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = tasks.filter((t) => matchFilter(t, filter, now))
    if (q) {
      list = list.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.note ?? '').toLowerCase().includes(q) ||
          (t.tag ?? '').toLowerCase().includes(q)
      )
    }
    return sortTasks(list)
  }, [tasks, query, filter, now])

  const groups = useMemo(() => {
    const active = filtered.filter((t) => t.status === 'active')
    const done = filtered.filter((t) => t.status === 'done')
    const cancelled = filtered.filter((t) => t.status === 'cancelled')
    const out: Array<{ key: string; label: string; items: TaskItem[] }> = []
    if (active.length) out.push({ key: 'active', label: '进行中', items: active })
    if (done.length) out.push({ key: 'done', label: '已完成', items: done })
    if (cancelled.length) out.push({ key: 'cancelled', label: '已取消', items: cancelled })
    return out
  }, [filtered])

  /**
   * 统计。
   *
   * 「今日到期」按自然日比较（同一天但已过时间点的也算今天该处理的），
   * 否则下午 3 点就看不到今天早上到期的任务了，不符合直觉。
   */
  const counts = useMemo(() => {
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const active = tasks.filter((t) => t.status === 'active')
    const done = tasks.filter((t) => t.status === 'done')
    const todayDue = active.filter((t) => t.dueAt && t.dueAt >= today.getTime() && t.dueAt < tomorrow.getTime()).length
    const overdue = active.filter((t) => t.dueAt && t.dueAt < now.getTime()).length
    // 今日已完成：用 completedAt 落在今天
    const doneToday = done.filter((t) => t.completedAt && t.completedAt >= today.getTime()).length
    return { active: active.length, done: done.length, todayDue, overdue, doneToday, total: tasks.length }
  }, [tasks, now])

  /** 每个筛选下有几条（用于标签上的计数） */
  const filterCounts = useMemo(() => {
    const out = {} as Record<FilterKey, number>
    for (const f of FILTERS) out[f.key] = tasks.filter((t) => matchFilter(t, f.key, now)).length
    return out
  }, [tasks, now])

  function openCreate(): void {
    setEditing(null)
    setDraft(emptyDraft())
    setCreating(true)
  }

  function openEdit(t: TaskItem): void {
    setCreating(false)
    setEditing(t)
    setDraft({
      title: t.title,
      note: t.note ?? '',
      priority: t.priority,
      dueAt: t.dueAt ? tsToLocalInput(t.dueAt) : '',
      tag: t.tag ?? ''
    })
  }

  function closePanel(): void {
    setCreating(false)
    setEditing(null)
  }

  async function submitDraft(): Promise<void> {
    const title = draft.title.trim()
    if (!title) return
    const base = {
      title,
      note: draft.note.trim() || undefined,
      priority: draft.priority,
      dueAt: localInputToTs(draft.dueAt),
      tag: draft.tag.trim() || undefined
    }
    try {
      if (editing) {
        setTasks(await window.shorekeeper.patchTask(editing.id, base))
      } else {
        setTasks(await window.shorekeeper.saveTask({ ...base, status: 'active', source: 'manual' }))
      }
      closePanel()
    } catch {
      /* 静默 */
    }
  }

  async function complete(t: TaskItem): Promise<void> {
    try {
      setTasks(await window.shorekeeper.patchTask(t.id, { status: 'done' }))
    } catch {
      /* 静默 */
    }
  }

  async function restore(t: TaskItem): Promise<void> {
    try {
      setTasks(await window.shorekeeper.patchTask(t.id, { status: 'active' }))
    } catch {
      /* 静默 */
    }
  }

  async function cancelTask(t: TaskItem): Promise<void> {
    try {
      setTasks(await window.shorekeeper.patchTask(t.id, { status: 'cancelled' }))
    } catch {
      /* 静默 */
    }
  }

  async function remove(t: TaskItem): Promise<void> {
    try {
      setTasks(await window.shorekeeper.deleteTask(t.id))
    } catch {
      /* 静默 */
    }
  }

  /* ---------- 批量模式 ---------- */

  function toggleChecked(id: string): void {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exitBatch(): void {
    setBatch(false)
    setChecked(new Set())
  }

  async function runBulk(action: 'done' | 'active' | 'cancelled' | 'delete'): Promise<void> {
    const ids = [...checked]
    if (ids.length === 0) return
    try {
      setTasks(await window.shorekeeper.tasksBulk(ids, action))
      setChecked(new Set())
    } catch {
      /* 静默 */
    }
  }

  async function clearCompleted(): Promise<void> {
    try {
      setTasks(await window.shorekeeper.tasksClearCompleted())
    } catch {
      /* 静默 */
    }
  }

  /* ---------- 拖动排序 ---------- */

  /**
   * 放手时把拖动项插到目标项的位置，并把**当前可见的进行中任务**
   * 按新顺序整体写回 sortOrder。
   *
   * 只写回可见项：这样在"今天"筛选下拖动，不会把筛选外的任务顺序打乱。
   */
  async function dropOn(target: TaskItem): Promise<void> {
    const from = dragId.current
    dragId.current = null
    setDragOverId(null)
    if (!from || from === target.id) return

    const visible = filtered.filter((t) => t.status === 'active')
    const fromIdx = visible.findIndex((t) => t.id === from)
    const toIdx = visible.findIndex((t) => t.id === target.id)
    if (fromIdx < 0 || toIdx < 0) return

    const next = [...visible]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    try {
      setTasks(await window.shorekeeper.tasksReorder(next.map((t) => t.id)))
    } catch {
      /* 静默 */
    }
  }

  return (
    <div className="tasks-page">
      <h1 className="sr-only">{getAgentRole().name} · 任务</h1>
      <Motes />

      <Rail
        active="tasks"
        onHome={onHome}
        onChat={onChat}
        onTasks={() => undefined}
        taskCount={counts.active}
        onSettings={onOpenSettings}
        onOpenProfile={onOpenProfile}
        onAgent={onAgent}
        onToggleDocs={onDocs}
        onToggleMemory={onMemory}
        onCommand={onCommand}
      />

      <main className="tasks-main">
        <header className="tasks-head">
          <div className="tasks-title-wrap">
            <h2 className="tasks-title">任务</h2>
            <p className="tasks-sub">我把你该做的事放在这里了，也会和我说。</p>
          </div>
          <div className="tasks-stats">
            <span className="ts-stat ts-active">进行中 {counts.active}</span>
            {counts.todayDue > 0 && <span className="ts-stat ts-due">今日到期 {counts.todayDue}</span>}
            {counts.overdue > 0 && <span className="ts-stat ts-over">已逾期 {counts.overdue}</span>}
            {counts.doneToday > 0 && <span className="ts-stat">今日完成 {counts.doneToday}</span>}
            <span className="ts-stat">已完成 {counts.done}</span>
          </div>
        </header>

        <div className="tasks-toolbar">
          <input
            className="tasks-search"
            type="text"
            placeholder="搜索任务标题 / 备注 / 标签…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className={'tasks-mode' + (batch ? ' on' : '')}
            onClick={() => (batch ? exitBatch() : setBatch(true))}
            title="批量选择任务"
          >
            ☑ 批量
          </button>
          {counts.done > 0 && (
            <button
              type="button"
              className="tasks-clear"
              onClick={() => void clearCompleted()}
              title="删除所有已完成的任务（已取消的会保留）"
            >
              清理已完成
            </button>
          )}
          <button type="button" className="tasks-add" onClick={openCreate}>
            ＋ 新建任务
          </button>
        </div>

        {/* 筛选标签：任务多了以后"全部"看不出重点 */}
        <div className="tasks-filters" role="tablist" aria-label="任务筛选">
          {FILTERS.map((f) => {
            const n = filterCounts[f.key]
            return (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={'tf-chip' + (filter === f.key ? ' on' : '') + (f.key === 'overdue' && n > 0 ? ' warn' : '')}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {n > 0 && <em className="tf-n">{n}</em>}
              </button>
            )
          })}
        </div>

        {/* 批量操作条：选中后出现 */}
        {batch && (
          <div className="tasks-batch">
            <span className="tb-count">已选 {checked.size} 条</span>
            <button
              type="button"
              className="tb-act"
              onClick={() => setChecked(new Set(groups.flatMap((g) => g.items).map((t) => t.id)))}
            >
              全选
            </button>
            <button type="button" className="tb-act" onClick={() => setChecked(new Set())}>
              取消选择
            </button>
            <span className="tb-sep" />
            <button type="button" className="tb-act ok" disabled={checked.size === 0} onClick={() => void runBulk('done')}>
              标记完成
            </button>
            <button type="button" className="tb-act" disabled={checked.size === 0} onClick={() => void runBulk('cancelled')}>
              取消任务
            </button>
            <button type="button" className="tb-act del" disabled={checked.size === 0} onClick={() => void runBulk('delete')}>
              删除
            </button>
            <button type="button" className="tb-act" onClick={exitBatch}>
              退出
            </button>
          </div>
        )}

        <section className="tasks-body card">
          {tasks.length === 0 && (
            <div className="tasks-empty">
              <p>还没有任务。可以点右上角「新建任务」，或者直接对我说：</p>
              <p className="tasks-empty-hint">「帮我记一个任务：明天下午 3 点交周报」</p>
              <button type="button" className="tasks-add-main" onClick={openCreate}>
                ＋ 新建第一个任务
              </button>
            </div>
          )}

          {tasks.length > 0 && filtered.length === 0 && (
            <div className="tasks-empty">
              <p>
                {query ? `没有匹配「${query}」的任务。` : `「${FILTERS.find((f) => f.key === filter)?.label}」下没有任务。`}
              </p>
            </div>
          )}

          {groups.map((g) => (
            <div className="task-group" key={g.key}>
              <div className="task-group-head">
                <span className="task-group-label">{g.label}</span>
                <span className="task-group-count">{g.items.length}</span>
              </div>
              {g.items.map((t) => {
                const draggable = t.status === 'active' && !batch
                return (
                  <div
                    className={
                      'trow' +
                      (t.status !== 'active' ? ' off' : '') +
                      (dragOverId === t.id ? ' drag-over' : '') +
                      (checked.has(t.id) ? ' checked' : '')
                    }
                    key={t.id}
                    draggable={draggable}
                    onDragStart={() => {
                      dragId.current = t.id
                    }}
                    onDragOver={(e) => {
                      if (!draggable || !dragId.current) return
                      e.preventDefault()
                      if (dragOverId !== t.id) setDragOverId(t.id)
                    }}
                    onDragLeave={() => {
                      if (dragOverId === t.id) setDragOverId(null)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      void dropOn(t)
                    }}
                    onDragEnd={() => {
                      dragId.current = null
                      setDragOverId(null)
                    }}
                  >
                    {batch && (
                      <label className="trow-check" title="选择这条任务">
                        <input type="checkbox" checked={checked.has(t.id)} onChange={() => toggleChecked(t.id)} />
                      </label>
                    )}
                    {draggable && (
                      <span className="trow-grip" title="按住拖动排序" aria-hidden="true">
                        ⋮⋮
                      </span>
                    )}
                    <span
                      className="trow-pri"
                      style={{ background: PRIORITY_COLOR[t.priority] }}
                      title={`优先级：${PRIORITY_LABEL[t.priority]}`}
                    />
                    <div className="trow-main">
                      <div className="trow-t">
                        {t.title}
                        {t.status === 'done' && <span className="trow-flag">✓</span>}
                        {t.status === 'cancelled' && <span className="trow-flag trow-flag-cancel">已取消</span>}
                      </div>
                      {t.note && <div className="trow-note">{t.note}</div>}
                      <div className="trow-meta">
                        {t.dueAt && t.status === 'active' && (
                          <span className={isOverdue(t.dueAt) ? 'trow-due overdue' : 'trow-due'}>{relDue(t.dueAt)}</span>
                        )}
                        {t.dueAt && t.status !== 'active' && <span className="trow-due">{relDue(t.dueAt)}</span>}
                        {t.tag && <span className="trow-tag">#{t.tag}</span>}
                        {t.source === 'agent' && <span className="trow-agent">由我创建</span>}
                      </div>
                    </div>
                    <span className="trow-ops">
                      {t.status === 'active' && (
                        <>
                          <button type="button" className="trow-btn trow-done" title="完成" aria-label="完成" onClick={() => void complete(t)}>✓</button>
                          <button type="button" className="trow-btn" title="编辑" aria-label="编辑" onClick={() => openEdit(t)}>✎</button>
                          <button type="button" className="trow-btn" title="取消" aria-label="取消" onClick={() => void cancelTask(t)}>◌</button>
                        </>
                      )}
                      {t.status !== 'active' && (
                        <button type="button" className="trow-btn trow-restore" title="恢复进行中" aria-label="恢复" onClick={() => void restore(t)}>↺</button>
                      )}
                      <button type="button" className="trow-btn trow-del" title="删除" aria-label="删除" onClick={() => void remove(t)}>✕</button>
                    </span>
                  </div>
                )
              })}
            </div>
          ))}
        </section>
      </main>

      {(creating || editing) && (
        <div className="task-editor-overlay" onClick={closePanel}>
          <div className="task-editor" onClick={(e) => e.stopPropagation()}>
            <div className="task-editor-head">
              <span className="task-editor-title">{editing ? '编辑任务' : '新建任务'}</span>
              <button type="button" className="task-editor-close" onClick={closePanel} aria-label="关闭">✕</button>
            </div>
            <label className="task-editor-field">
              <span>标题</span>
              <input
                type="text"
                placeholder="要做什么？"
                value={draft.title}
                autoFocus
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitDraft()
                }}
              />
            </label>
            <label className="task-editor-field">
              <span>备注</span>
              <textarea
                placeholder="补充说明（可选）"
                rows={3}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </label>
            <div className="task-editor-field">
              <span>优先级</span>
              <div className="task-editor-pri">
                {(['high', 'medium', 'low'] as TaskPriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={'pri-btn' + (draft.priority === p ? ' on' : '')}
                    style={draft.priority === p ? { borderColor: PRIORITY_COLOR[p], color: PRIORITY_COLOR[p], background: PRIORITY_COLOR[p] + '1a' } : undefined}
                    onClick={() => setDraft({ ...draft, priority: p })}
                  >
                    {PRIORITY_LABEL[p]}优先级
                  </button>
                ))}
              </div>
            </div>
            <label className="task-editor-field">
              <span>截止时间</span>
              <input
                type="datetime-local"
                value={draft.dueAt}
                onChange={(e) => setDraft({ ...draft, dueAt: e.target.value })}
              />
              <em className="task-editor-hint">不填则视为无期限任务</em>
            </label>
            <label className="task-editor-field">
              <span>标签</span>
              <input
                type="text"
                placeholder="如：学习 / 工作（可选）"
                value={draft.tag}
                onChange={(e) => setDraft({ ...draft, tag: e.target.value })}
              />
            </label>
            <div className="task-editor-actions">
              <button type="button" className="task-editor-cancel" onClick={closePanel}>取消</button>
              <button type="button" className="task-editor-save" onClick={() => void submitDraft()} disabled={!draft.title.trim()}>
                {editing ? '保存修改' : '创建任务'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
