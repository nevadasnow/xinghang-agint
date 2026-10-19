import type { Group, Project, Session } from '../../../shared/types'

/**
 * 侧栏归类的视图模型：分组（顶层） → 分类 = 项目（二级） → 会话，未分类项目固定在底部。
 *
 * 纯派生，不新增任何持久化字段（state/org.tsx 的数据结构保持不动）：
 * 「分类属于哪个分组」由该分类下会话出现次数最多的 groupId 推出。
 */

export interface OrgProjectNode {
  id: string
  name: string
  sessions: Session[]
}

export interface OrgGroupNode {
  id: string
  name: string
  projects: OrgProjectNode[]
  /** 直接挂在分组下、没有分类的会话 */
  loose: Session[]
  count: number
}

export interface OrgView {
  groups: OrgGroupNode[]
  unsorted: { projects: OrgProjectNode[]; loose: Session[]; count: number }
}

export function buildOrgView(groups: Group[], projects: Project[], sessions: Session[]): OrgView {
  const nodes: OrgGroupNode[] = groups.map((g) => ({
    id: g.id,
    name: g.name,
    projects: [],
    loose: [],
    count: 0
  }))
  const byId = new Map(nodes.map((g) => [g.id, g]))

  // 分类 → 分组：取该分类下会话里出现次数最多的 groupId
  const tally = new Map<string, Map<string, number>>()
  for (const s of sessions) {
    if (!s.projectId || !s.groupId) continue
    let per = tally.get(s.projectId)
    if (!per) {
      per = new Map<string, number>()
      tally.set(s.projectId, per)
    }
    per.set(s.groupId, (per.get(s.groupId) ?? 0) + 1)
  }
  const bucketGroup = new Map<string, string>()
  for (const [pid, per] of tally) {
    let best: string | null = null
    let bestN = 0
    for (const [gid, n] of per) {
      if (n > bestN) {
        bestN = n
        best = gid
      }
    }
    if (best && byId.has(best)) bucketGroup.set(pid, best)
  }

  // 会话按分类预索引，避免每个分类都全量扫一遍
  const byProject = new Map<string, Session[]>()
  for (const s of sessions) {
    if (!s.projectId) continue
    const list = byProject.get(s.projectId)
    if (list) list.push(s)
    else byProject.set(s.projectId, [s])
  }

  for (const p of projects) {
    const gid = bucketGroup.get(p.id)
    const g = gid ? byId.get(gid) : undefined
    if (!g) continue
    g.projects.push({ id: p.id, name: p.name, sessions: byProject.get(p.id) ?? [] })
  }

  for (const s of sessions) {
    if (s.projectId) continue
    const g = s.groupId ? byId.get(s.groupId) : undefined
    if (g) g.loose.push(s)
  }

  for (const g of nodes) {
    g.count = g.projects.reduce((n, p) => n + p.sessions.length, 0) + g.loose.length
  }

  const unsortedProjects = projects
    .filter((p) => !bucketGroup.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, sessions: byProject.get(p.id) ?? [] }))
  const unsortedLoose = sessions.filter((s) => !s.projectId && (!s.groupId || !byId.has(s.groupId)))

  return {
    groups: nodes.filter((g) => g.projects.length > 0 || g.loose.length > 0),
    unsorted: {
      projects: unsortedProjects,
      loose: unsortedLoose,
      count: unsortedProjects.length + unsortedLoose.length
    }
  }
}
