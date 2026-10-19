import type { ProfileFacts, TaskItem } from '../shared/types'

/**
 * 用户画像注入（C1 / C4）—— 纯函数，不碰存储
 *
 * 画像的**权威来源在渲染层的 localStorage**（`utils/uiPrefs.ts` 的 UserProfile，
 * 由设置里的「用户信息」与 UserProfileModal 维护）。主进程不另存一份，
 * 避免"两处画像不一致"这种典型 bug——从对话页改的和从设置改的必须是同一个。
 *
 * 因此这里只负责：拿到渲染层随消息传来的画像 → 渲染成 prompt 里的一个块。
 * 为空时返回空串，**完全不占 token**。
 */

/** 注入上限：与渲染层输入框的 maxLength 呼应，双保险 */
const MAX_FACTS = 20
const MAX_FACT_CHARS = 80
const MAX_DATES = 12

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

/**
 * 取出「今天」命中的重要日期，以及未来 7 天内的（C4）。
 * 纯本地日期比较，不调模型。
 */
export function upcomingDates(facts: ProfileFacts, now: Date = new Date()): string[] {
  const out: string[] = []
  const todayKey = `${now.getMonth() + 1}-${now.getDate()}`

  for (const d of (facts.dates ?? []).slice(0, MAX_DATES)) {
    const label = clean(d?.label, 24)
    const raw = clean(d?.date, 12)
    if (!label || !/^\d{1,4}-\d{1,2}(-\d{1,2})?$/.test(raw)) continue
    const yearly = d?.yearly !== false
    // 统一成 M-D 比较；一次性日期若年份已过一年以上则不再提
    const mmdd = raw.split('-').slice(-2).join('-')
    const norm = (s: string): string => {
      const [a, b] = s.split('-')
      return `${Number(a)}-${Number(b)}`
    }
    if (norm(mmdd) === norm(todayKey)) {
      out.push(`今天是${label}`)
      continue
    }
    if (!yearly) {
      const y = Number(raw.split('-')[0])
      if (Number.isFinite(y) && now.getFullYear() > y) continue // 已过去的一次性日期
    }
    for (let i = 1; i <= 7; i++) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      if (norm(`${t.getMonth() + 1}-${t.getDate()}`) === norm(mmdd)) {
        out.push(`${i} 天后是${label}`)
        break
      }
    }
  }
  return out
}

/**
 * 渲染画像块。返回空串表示没有可注入内容，调用方据此跳过（不占 token）。
 */
export function renderProfileBlock(facts: ProfileFacts | undefined, now: Date = new Date()): string {
  if (!facts || facts.enabled === false) return ''
  const name = clean(facts.name, 24)
  const note = clean(facts.bio, 200)
  const list = Array.isArray(facts.facts)
    ? facts.facts.map((f) => clean(f, MAX_FACT_CHARS)).filter(Boolean).slice(0, MAX_FACTS)
    : []
  const dates = upcomingDates(facts, now)

  const lines: string[] = []
  if (name) lines.push(`- 用户希望被称呼为：${name}`)
  if (note) lines.push(`- 用户自述：${note}`)
  if (list.length > 0) {
    lines.push('- 关于用户的已知情况：')
    for (const f of list) lines.push(`  · ${f}`)
  }
  if (dates.length > 0) {
    lines.push('- 最近的日期：')
    for (const d of dates) lines.push(`  · ${d}`)
  }
  if (lines.length === 0) return ''

  return [
    '# 关于用户（由用户自己填写）',
    lines.join('\n'),
    '',
    '用法：这是用户明确告知的信息，可以直接使用；但**不要逐条复述**，也不要在不相关的场合提及。',
    '称呼用户时优先使用上面「用户希望被称呼为」的名字；若没有提供名字，就自然用「你」称呼，不要使用泛指或占位称呼。',
    '日期到了可以自然带一句，不必隆重；没到也不必预告。',
    '如果用户这次说的与这里不一致，以用户这次说的为准。'
  ].join('\n')
}

/* ============================================================
   任务块（D6）：把用户手头的任务注入对话。
   纯函数，不碰存储；没有进行中任务时返回空串，完全不占 token。
   ============================================================ */

const PRIORITY_LABEL: Record<TaskItem['priority'], string> = { high: '高', medium: '中', low: '低' }
const TASK_BLOCK_MAX = 8 // 只注入最近的 8 条，防止挤占上下文

/** 截止时间的相对表述：今天 / 明天 / N 天后 / M月D日 / 已逾期 */
function dueLabel(dueAt: number, now: Date): string {
  const d = new Date(dueAt)
  d.setHours(0, 0, 0, 0)
  const t = new Date(now)
  t.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - t.getTime()) / 86_400_000)
  if (diff < 0) return `已逾期 ${-diff} 天`
  if (diff === 0) return '今天截止'
  if (diff === 1) return '明天截止'
  if (diff <= 7) return `${diff} 天后截止`
  return `${d.getMonth() + 1}月${d.getDate()}日截止`
}

/**
 * 渲染任务块。只有进行中任务（status=active）会注入；已完成/已取消不占 token。
 * 按「截止日期最近在前、无截止靠后，同层按优先级」排序，保证 agent 先看到最急的事。
 */
export function renderTaskBlock(tasks: TaskItem[] | undefined, now: Date = new Date()): string {
  const active = Array.isArray(tasks)
    ? tasks
        .filter((t) => t && t.status === 'active' && typeof t.title === 'string' && t.title.trim())
        .map((t) => ({
          ...t,
          title: t.title.trim().slice(0, 60),
          note: typeof t.note === 'string' ? t.note.trim().slice(0, 100) : ''
        }))
        .sort((a, b) => {
          const rank = (x: TaskItem): [number, number] => {
            const p = x.priority === 'high' ? 0 : x.priority === 'medium' ? 1 : 2
            return x.dueAt ? [0, p] : [1, p]
          }
          const ra = rank(a)
          const rb = rank(b)
          if (ra[0] !== rb[0]) return ra[0] - rb[0]
          if (ra[0] === 0) return (a.dueAt ?? 0) - (b.dueAt ?? 0)
          return ra[1] - rb[1]
        })
        .slice(0, TASK_BLOCK_MAX)
    : []
  if (active.length === 0) return ''

  const lines = active.map((t) => {
    const parts = [`[${PRIORITY_LABEL[t.priority]}]${t.title}`]
    if (t.dueAt) parts.push(`（${dueLabel(t.dueAt, now)}）`)
    if (t.tag) parts.push(` #${t.tag}`)
    if (t.note) parts.push(` —— ${t.note}`)
    return `- ${parts.join(' ')}`
  })

  return [
    '# 用户的任务（本地任务系统，可能由用户或我创建）',
    lines.join('\n'),
    '',
    '用法：',
    '- 对话时自然承接用户手头的任务：提到时关心进度、必要时主动提醒截止，但**不要每轮都复述整份清单**。',
    '- 用户提出新任务、或要修改/完成/取消某个任务时，用 task_create / task_update 工具实际更新任务系统，让任务页同步可见。',
    '- 完成任务时通过 task_update 把状态改为 done；不确定某个任务是否存在时先 task_list 查一下。'
  ].join('\n')
}
