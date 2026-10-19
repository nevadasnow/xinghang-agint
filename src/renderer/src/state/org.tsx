import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Group, Project, Session } from '../../../shared/types'

/**
 * 项目 / 分组 的组织数据层。
 *
 * 数据落在 data.json 的 projects / groups 数组，会话通过 projectId / groupId 关联。
 * 抽成 context 是为了让「首页最近对话」与「对话页侧栏」共用同一份，避免两处各拉一次
 * 而看到不一致的归类。
 */

export type OrgTab = 'project' | 'group'

/** 未归类的固定 id，UI 上用这个名字显示 */
export const UNSORTED = '__unsorted__'

interface OrgValue {
  projects: Project[]
  groups: Group[]
  loading: boolean
  tab: OrgTab
  setTab: (t: OrgTab) => void
  /** 当前 tab 下展开的容器 id 集合 */
  open: Record<string, boolean>
  toggleOpen: (id: string) => void
  /** 批量设置展开状态（参照 Cyrene expandAllProjects / collapseAllProjects） */
  setAllOpen: (ids: string[], open: boolean) => void
  createProject: (name: string) => Promise<void>
  createGroup: (name: string, color?: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  removeGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  /** 分组通用补丁：name / color / pinned（参照 Cyrene applyDraft 局部更新） */
  patchGroup: (id: string, patch: Partial<Pick<Group, 'name' | 'color' | 'pinned'>>) => Promise<void>
  /** 按给定 id 顺序重排分组（置顶分组由渲染层决定放哪） */
  reorderGroups: (ids: string[]) => Promise<void>
  move: (sessionId: string, target: { projectId?: string; groupId?: string }) => Promise<void>
  /** 按当前 tab 把会话分桶；键为容器 id，UNSORTED 为未归类。分组视图下置顶分组在前 */
  bucketOf: (sessions: Session[]) => Array<{ id: string; name: string; color?: string; pinned?: boolean; items: Session[] }>
}

const Ctx = createContext<OrgValue | null>(null)

export function useOrg(): OrgValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useOrg 必须在 OrgProvider 内使用')
  return v
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<OrgTab>('group')
  const [open, setOpen] = useState<Record<string, boolean>>({ [UNSORTED]: true })

  useEffect(() => {
    Promise.all([window.shorekeeper.listProjects(), window.shorekeeper.listGroups()])
      .then(([ps, gs]) => {
        setProjects(ps)
        setGroups(gs)
      })
      .catch(() => {
        /* 读失败就按空处理，不阻塞界面 */
      })
      .finally(() => setLoading(false))
  }, [])

  const toggleOpen = useCallback((id: string) => {
    setOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? false) }))
  }, [])

  const setAllOpen = useCallback((ids: string[], open: boolean) => {
    setOpen((prev) => {
      const next = { ...prev }
      for (const id of ids) next[id] = open
      return next
    })
  }, [])

  const createProject = useCallback(async (name: string) => {
    const p: Project = { id: uid('proj'), name, createdAt: Date.now() }
    setProjects(await window.shorekeeper.saveProject(p))
    setOpen((prev) => ({ ...prev, [p.id]: true }))
  }, [])

  const createGroup = useCallback(async (name: string, color?: string) => {
    const g: Group = { id: uid('grp'), name, createdAt: Date.now(), color }
    setGroups(await window.shorekeeper.saveGroup(g))
    setOpen((prev) => ({ ...prev, [g.id]: true }))
  }, [])

  const removeProject = useCallback(async (id: string) => {
    const r = await window.shorekeeper.deleteProject(id)
    setProjects(r.projects)
  }, [])

  const removeGroup = useCallback(async (id: string) => {
    const r = await window.shorekeeper.deleteGroup(id)
    setGroups(r.groups)
  }, [])

  const renameGroup = useCallback(async (id: string, name: string) => {
    setGroups(await window.shorekeeper.renameGroup(id, name))
  }, [])

  const patchGroup = useCallback(async (id: string, patch: Partial<Pick<Group, 'name' | 'color' | 'pinned'>>) => {
    setGroups(await window.shorekeeper.patchGroup(id, patch))
  }, [])

  const reorderGroups = useCallback(async (ids: string[]) => {
    setGroups(await window.shorekeeper.reorderGroups(ids))
  }, [])

  const move = useCallback(
    async (sessionId: string, target: { projectId?: string; groupId?: string }) => {
      await window.shorekeeper.assignSession(sessionId, target)
    },
    []
  )

  /** 按当前 tab 把会话分桶；空容器也会返回，便于显示空态。分组视图下置顶分组在前 */
  const bucketOf = useCallback(
    (sessions: Session[]) => {
      const isProject = tab === 'project'
      const list = isProject ? projects : groups
      const key = isProject ? 'projectId' : 'groupId'

      // 分组视图：置顶分组优先（参照 Cyrene 置顶语义），其余保持创建/拖拽顺序
      const ordered = isProject
        ? list
        : [...(list as Group[])].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))

      const buckets = ordered.map((c) => ({
        id: c.id,
        name: c.name,
        color: 'color' in c ? (c as Group).color : undefined,
        pinned: 'pinned' in c ? Boolean((c as Group).pinned) : false,
        items: sessions.filter((s) => s[key] === c.id)
      }))
      const loose = sessions.filter((s) => !s[key])
      buckets.push({
        id: UNSORTED,
        name: isProject ? '未分类项目' : '未分组',
        color: undefined,
        pinned: false,
        items: loose
      })
      return buckets
    },
    [tab, projects, groups]
  )

  const value = useMemo<OrgValue>(
    () => ({
      projects,
      groups,
      loading,
      tab,
      setTab,
      open,
      toggleOpen,
      setAllOpen,
      createProject,
      createGroup,
      removeProject,
      removeGroup,
      renameGroup,
      patchGroup,
      reorderGroups,
      move,
      bucketOf
    }),
    [projects, groups, loading, tab, open, toggleOpen, setAllOpen, createProject, createGroup, removeProject, removeGroup, renameGroup, patchGroup, reorderGroups, move, bucketOf]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
