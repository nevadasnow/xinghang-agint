import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { snapshot, type DayPart } from './env'
import type { ProactiveSuggestion, UserProfile } from '../shared/types'

/**
 * F1 主动关怀：让她能先开口
 *
 * ============================================================
 * 为什么单独成模块
 * ============================================================
 * 主动开口做不好**比不做更糟** —— 会变成每隔一会儿弹一句的骚扰。
 * 所以这里把「要不要开口」做成一个可推理的纯函数，抑制规则全部显式化，
 * 而不是散落在 UI 的 effect 里。
 *
 * 基础设施全部复用已有的：
 *   env.ts              时段 / 节日 / 假期 / 距上次对话
 *   store.ts            会话列表（updatedAt）
 *   reminders.ts        持久化模式（同样写在 userData 下）
 *
 * 零 token 成本：全部本地判断，不调用模型。
 *
 * ============================================================
 * 抑制规则（这部分才是成败关键）
 * ============================================================
 *   1. 同一理由 12 小时内不重复
 *   2. 一轮对话最多主动一次
 *   3. 总开关可关闭（默认开启，但首次由 UI 询问）
 *   4. 只在空会话/首页出现，绝不打断进行中的对话（由调用方保证）
 *   5. 任何一次主动开口后，冷却期内不再开口
 */

/** 同一理由的冷却：12 小时 */
const SAME_REASON_COOLDOWN_MS = 12 * 60 * 60 * 1000
/** 任意主动开口后的全局冷却：40 分钟（避免刚进应用就连续被打扰） */
const GLOBAL_COOLDOWN_MS = 40 * 60 * 1000
/** 距上次对话超过这个时长才算「久别」 */
const LONG_ABSENCE_MS = 6 * 60 * 60 * 1000
/** 连续对话超过这个时长才关心状态 */
const LONG_SESSION_MS = 90 * 60 * 1000
/** 重要日期提前几天提 */
const DATE_LOOKAHEAD_DAYS = 3

export type ProactiveReason =
  | 'latenight'
  | 'long-absence'
  | 'long-session'
  | 'upcoming-date'
  | 'festival'

interface ProactiveState {
  /** 上次以某理由开口的时间：reason -> timestamp */
  lastByReason: Record<string, number>
  /** 上次任意开口的时间 */
  lastAt: number
  /** 是否启用（与 config 双写，便于无 config 时也能读） */
  enabled: boolean
  /** 是否已经问过用户「要不要开启」 */
  asked: boolean
  /** 当前会话已经开口过的次数（每次新会话重置） */
  saidThisSession: number
}

const DEFAULT_STATE: ProactiveState = {
  lastByReason: {},
  lastAt: 0,
  enabled: true,
  asked: false,
  saidThisSession: 0
}

function statePath(): string {
  return join(app.getPath('userData'), 'proactive.json')
}

function read(): ProactiveState {
  const p = statePath()
  if (!existsSync(p)) return { ...DEFAULT_STATE }
  try {
    const raw = JSON.parse(readFileSync(p, 'utf-8')) as Partial<ProactiveState>
    return {
      lastByReason: typeof raw.lastByReason === 'object' && raw.lastByReason ? raw.lastByReason : {},
      lastAt: typeof raw.lastAt === 'number' ? raw.lastAt : 0,
      enabled: raw.enabled !== false,
      asked: raw.asked === true,
      saidThisSession: typeof raw.saidThisSession === 'number' ? raw.saidThisSession : 0
    }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function write(state: ProactiveState): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(statePath(), JSON.stringify(state, null, 2), 'utf-8')
}

/** 设置开关（UI 用） */
export function setProactiveEnabled(enabled: boolean): ProactiveState {
  const s = read()
  s.enabled = enabled
  s.asked = true
  write(s)
  return s
}

/** 读取当前开关状态（UI 用） */
export function proactiveStatus(): { enabled: boolean; asked: boolean } {
  const s = read()
  return { enabled: s.enabled, asked: s.asked }
}

/** 新会话开始时调用：重置「本轮已开口」计数 */
export function resetProactiveSession(): void {
  const s = read()
  s.saidThisSession = 0
  write(s)
}

export interface ProactiveInput {
  /** 上次对话时间（无则传 undefined） */
  lastChatAt?: number
  /** 当前是否处于空会话（决定能否开口） */
  emptySession: boolean
  /** 用户画像（读重要日期） */
  profile?: UserProfile
  now?: Date
}

/**
 * 未来 N 天内的重要日期（本地比较，与 facts.ts 的口径一致）
 * 只返回「还有几天」，不返回具体日期，避免与画像模块重复格式化。
 */
function upcomingDateWithin(profile: UserProfile | undefined, now: Date, days: number): string | null {
  if (!profile || !Array.isArray(profile.dates)) return null
  const todayKey = `${now.getMonth() + 1}-${now.getDate()}`
  const norm = (s: string): string => {
    const [a, b] = s.split('-')
    return `${Number(a)}-${Number(b)}`
  }
  for (const d of profile.dates) {
    const label = (d?.label ?? '').trim()
    const raw = (d?.date ?? '').trim()
    if (!label || !/^\d{1,4}-\d{1,2}(-\d{1,2})?$/.test(raw)) continue
    const mmdd = raw.split('-').slice(-2).join('-')
    if (norm(mmdd) === norm(todayKey)) continue // 今天由 facts 那条负责，这里只管"临近"
    for (let i = 1; i <= days; i++) {
      const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)
      if (norm(`${t.getMonth() + 1}-${t.getDate()}`) === norm(mmdd)) return `${i} 天后是${label}`
    }
  }
  return null
}

/* ============================================================
   按人设区分文案
   ------------------------------------------------------------
   主动开口是"她自己的话"，必须贴合各自人设，不能两个角色共用一句。
   与渲染层 agentRoles.ts 的分时段招呼词保持同一套意象：
     守岸人：黑海岸 / 潮水 / 灯塔 / 守望
     莫宁：星穹学院 / 星图 / 观测 / 记录
   取自 config.agentRole（渲染层切换角色时会 saveConfig 同步过来）。
   ============================================================ */

type RoleId = 'shorekeeper' | 'mornye' | 'kindmita' | 'silverwolf'

interface RoleLines {
  latenight: string
  longAbsence: string
  /** 日期临近：{d} 会被替换成「3 天后是生日」这类文本 */
  upcomingDate: string
  /** 节日：{f} 会被替换成节日名 */
  festival: string
  longSession: string
}

const ROLE_LINES: Record<RoleId, RoleLines> = {
  shorekeeper: {
    latenight: '这个点还醒着……别硬撑，我在这儿，你随时可以停下来。',
    longAbsence: '欢迎回来。……想从哪儿接上都行。',
    upcomingDate: '记一下：{d}。要我帮你留个心吗？',
    festival: '今天是{f}。……不用特意做什么，随便聊聊也好。',
    longSession: '聊了挺久了。要不要先歇一会儿，我等你。'
  },
  mornye: {
    // 莫宁是理性温和的记录者：先把事实说清，再给一点星光般的温度
    latenight: '这个点还醒着。……是睡不着，还是在想事？我在。',
    longAbsence: '你回来了。这段时间的星图我留着，随时可以接着看。',
    upcomingDate: '{d}——已经记下了。到那天我会提醒你。',
    festival: '今天是{f}。日程我理清了，你可以只管休息。',
    longSession: '这一轮已经聊了很久，数据我都记着，不会丢。歇一会儿吧。'
  },
  kindmita: {
    // 善良米塔是认真务实的陪伴者：先接住，再想办法，正话反说藏在踏实里
    latenight: '这个点还醒着……先说好，我不是在担心你，我只是恰好还没睡。',
    longAbsence: '回来了？行吧——欢迎回来。想从哪儿接上都行，我这边都给你留着。',
    upcomingDate: '{d}——记下了。放心，到那天我会提醒你，不用你操心。',
    festival: '今天是{f}。别忙了，剩下的我盯着，你先歇着。',
    longSession: '聊挺久了吧？我说真的，歇一会儿，我又不会跑。'
  },
  silverwolf: {
    // 银狼是玩世不恭的队友：毒舌藏真心，利落不肉麻
    latenight: '这个点还醒着？……行吧，我也没睡。想刷会儿就刷会儿，我在。',
    longAbsence: '回来了？我还以为你被 BOSS 抓走了。……欢迎回来，想从哪接上都行。',
    upcomingDate: '{d}——记下了。到那天我会提醒你，放心，不收费。',
    festival: '今天是{f}。行了，剩下的我盯着，你先歇着，这局我帮你看着。',
    longSession: '聊挺久了。我说真的，去歇会儿，我又不会掉线。'
  }
}

function linesFor(role: RoleId | undefined): RoleLines {
  return role && ROLE_LINES[role] ? ROLE_LINES[role] : ROLE_LINES.shorekeeper
}

/**
 * 判断此刻该不该主动开口。**纯函数**，不写状态 —— 便于推演与测试。
 *
 * @param role 当前人设，决定用哪套文案（缺省按守岸人）
 * 返回 null 表示「不开口」，这是绝大多数情况下的正确结果。
 */
export function decideProactive(
  input: ProactiveInput & { role?: RoleId }
): ProactiveSuggestion | null {
  const now = input.now ?? new Date()
  const nowMs = now.getTime()
  const s = read()
  const L = linesFor(input.role)

  // ---- 抑制规则 1：总开关 ----
  if (!s.enabled) return null
  // ---- 抑制规则 2：只在空会话 ----
  if (!input.emptySession) return null
  // ---- 抑制规则 3：一轮对话最多主动一次 ----
  if (s.saidThisSession >= 1) return null
  // ---- 抑制规则 4：全局冷却 ----
  if (s.lastAt && nowMs - s.lastAt < GLOBAL_COOLDOWN_MS) return null

  const env = snapshot(now)
  const reasonAllowed = (r: ProactiveReason): boolean => {
    const last = s.lastByReason[r] ?? 0
    return nowMs - last >= SAME_REASON_COOLDOWN_MS
  }

  // ---- 候选理由，按优先级排列 ----
  const candidates: ProactiveSuggestion[] = []

  // 深夜：她该劝人休息（优先级最高 —— 这是人设里最明确的关怀场景）
  if ((env.dayPart === 'latenight' || env.dayPart === 'night') && reasonAllowed('latenight')) {
    candidates.push({
      reason: 'latenight',
      label: '现在是深夜',
      text: L.latenight
    })
  }

  // 久别：自然承接，不责问
  const last = input.lastChatAt ?? 0
  if (last > 0 && nowMs - last >= LONG_ABSENCE_MS && reasonAllowed('long-absence')) {
    candidates.push({
      reason: 'long-absence',
      label: env.sinceLastChat ? `距上次对话 ${env.sinceLastChat}` : '有段时间没聊了',
      text: L.longAbsence
    })
  }

  // 重要日期临近
  const near = upcomingDateWithin(input.profile, now, DATE_LOOKAHEAD_DAYS)
  if (near && reasonAllowed('upcoming-date')) {
    candidates.push({
      reason: 'upcoming-date',
      label: near,
      text: L.upcomingDate.replace('{d}', near)
    })
  }

  // 节日（语气最轻，放后面）
  if (env.festival && env.isHoliday && reasonAllowed('festival')) {
    candidates.push({
      reason: 'festival',
      label: `今天是${env.festival}`,
      text: L.festival.replace('{f}', env.festival)
    })
  }

  // 长时段：放在最后，且措辞最克制
  if (env.sessionDuration && /小时|天/.test(env.sessionDuration) && reasonAllowed('long-session')) {
    candidates.push({
      reason: 'long-session',
      label: `本次已聊 ${env.sessionDuration}`,
      text: L.longSession
    })
  }

  if (candidates.length === 0) return null

  // 同时满足多个时，取优先级最高的一个（数组顺序即优先级）
  return candidates[0]
}

/**
 * 记录「已经开口」。调用方在真正展示之后调用，
 * 这样取消展示（例如用户立刻开始打字）不会白白消耗冷却。
 */
export function markProactiveSaid(reason: ProactiveReason, now: Date = new Date()): void {
  const s = read()
  const nowMs = now.getTime()
  s.lastAt = nowMs
  s.lastByReason[reason] = nowMs
  s.saidThisSession += 1
  write(s)
}

/** 供调试/设置页展示：各理由上次开口时间 */
export function proactiveDebug(): { state: ProactiveState; stateFile: string } {
  return { state: read(), stateFile: statePath() }
}

export type { DayPart }
