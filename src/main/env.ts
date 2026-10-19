/**
 * 外部环境感知（规格 6 · 一）
 *
 * 目的：让守岸人知道「此刻是什么时候」，从而自然地说出贴合当下的话，
 * 而不是在深夜说"早上好"、在凌晨用白天的工作语气。
 *
 * 设计原则：
 *   1) 只注入**可验证的真实参数**（系统时间、时段、季节），不编造任何"经历"。
 *      人设里明确禁止假装记得系统未提供的事，所以这里给的是环境，不是记忆。
 *   2) 摘要是**给人设参考的事实**，不是让模型复述的清单。提示词里会说明
 *      「不要直接朗读这些字段」。
 *   3) 时区用系统本地时区，保证与用户桌面时间一致。
 */

export type DayPart = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'latenight'

/* ============================================================
   节日与节气（A3 / A5）
   只收编**固定公历或固定农历日期**的常见节日，且不依赖任何网络/模型调用。
   农历节日按年列出（农历无法用公式从公历简单推算）。
   法定节假日（含调休）单独一张表，用于判断"今天要不要上班"。
   ============================================================ */

/** 固定公历节日：'M-D' */
const SOLAR_FESTIVALS: Record<string, string> = {
  '1-1': '元旦',
  '2-14': '情人节',
  '3-8': '妇女节',
  '3-12': '植树节',
  '4-1': '愚人节',
  '5-1': '劳动节',
  '5-4': '青年节',
  '6-1': '儿童节',
  '7-1': '建党节',
  '8-1': '建军节',
  '9-10': '教师节',
  '10-1': '国庆节',
  '10-31': '万圣节',
  '11-11': '双十一',
  '12-24': '平安夜',
  '12-25': '圣诞节'
}

/** 农历节日（按年写死，公历日期查表） */
const LUNAR_FESTIVALS: Record<string, string> = {
  '2026-2-17': '春节',
  '2026-3-3': '元宵节',
  '2026-6-19': '端午节',
  '2026-8-19': '七夕',
  '2026-9-25': '中秋节',
  '2026-10-18': '重阳节',
  '2027-2-6': '春节',
  '2027-2-20': '元宵节',
  '2027-6-9': '端午节',
  '2027-8-8': '七夕',
  '2027-9-15': '中秋节',
  '2027-10-8': '重阳节'
}

/** 2026 法定节假日与调休（国务院办公厅通知）；label 为假期名 */
const CN_HOLIDAYS_2026: Record<string, string> = {
  '2026-1-1': '元旦',
  '2026-1-2': '元旦假期',
  '2026-1-3': '元旦假期',
  '2026-2-15': '春节假期',
  '2026-2-16': '春节假期',
  '2026-2-17': '春节',
  '2026-2-18': '春节假期',
  '2026-2-19': '春节假期',
  '2026-2-20': '春节假期',
  '2026-2-21': '春节假期',
  '2026-4-4': '清明节',
  '2026-4-5': '清明假期',
  '2026-4-6': '清明假期',
  '2026-5-1': '劳动节',
  '2026-5-2': '劳动节假期',
  '2026-5-3': '劳动节假期',
  '2026-5-4': '劳动节假期',
  '2026-5-5': '劳动节假期',
  '2026-6-19': '端午节',
  '2026-6-20': '端午假期',
  '2026-6-21': '端午假期',
  '2026-9-25': '中秋节',
  '2026-9-26': '中秋假期',
  '2026-9-27': '中秋假期',
  '2026-10-1': '国庆节',
  '2026-10-2': '国庆假期',
  '2026-10-3': '国庆假期',
  '2026-10-4': '国庆假期',
  '2026-10-5': '国庆假期',
  '2026-10-6': '国庆假期',
  '2026-10-7': '国庆假期',
  '2026-10-8': '国庆假期'
}

/** 2026 调休上班日（周末但要上班） */
const CN_WORKDAYS_2026: Record<string, string> = {
  '2026-2-14': '春节调休上班',
  '2026-2-28': '春节调休上班',
  '2026-9-19': '中秋国庆调休上班',
  '2026-10-10': '中秋国庆调休上班'
}

export interface EnvSnapshot {
  /** ISO 时间戳（便于模型做任意推算） */
  iso: string
  /** 2026年10月7日 星期三 */
  dateText: string
  /** 03:12 */
  clock: string
  /** 时段枚举 */
  dayPart: DayPart
  /** 时段中文：凌晨 / 清晨 / 上午 / 中午 / 下午 / 傍晚 / 夜晚 / 深夜 */
  dayPartText: string
  /** 季节：春 / 夏 / 秋 / 冬 */
  season: string
  /** 是否周末（自然日，不考虑调休） */
  weekend: boolean
  /** 今天是什么节日（含节气/法定假期），无则为 undefined */
  festival?: string
  /** 今天是否法定休假日（已含调休修正）；undefined 表示本年无数据 */
  isHoliday?: boolean
  /** 今天是否调休上班（周末但要上班） */
  isMakeupWorkday?: boolean
  /** 本次对话已持续多久，如「1 小时 20 分钟」 */
  sessionDuration?: string
  /** 距上一次对话多久，如「3 天前」 */
  sinceLastChat?: string
  /** 上次聊到的内容摘要（B5 主动话题延续），仅开启新会话时提供 */
  previousTopics?: string
}

/** 本地日期键：2026-10-7（不带前导零，与上面的表一致） */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

function solarKey(d: Date): string {
  return `${d.getMonth() + 1}-${d.getDate()}`
}

/** 把毫秒差写成自然中文时长 */
export function humanDuration(ms: number): string {
  const min = Math.floor(ms / 60000)
  if (min < 1) return '不到 1 分钟'
  if (min < 60) return `${min} 分钟`
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h < 24) return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  const d = Math.floor(h / 24)
  const rh = h % 24
  if (d < 30) return rh > 0 ? `${d} 天 ${rh} 小时` : `${d} 天`
  const mo = Math.floor(d / 30)
  return `${mo} 个月`
}

/** 日程相关的环境事实（由调用方从会话存储里取，env 本身不碰存储） */
export interface EnvFacts {
  /** 当前会话开始时间 */
  sessionStartedAt?: number
  /** 上一次对话的时间（用于「距上次多久」） */
  lastChatAt?: number
  /** 上次聊到的内容摘要（B5），只在开启新会话时传 */
  previousTopics?: string
}

function partOf(hour: number): { part: DayPart; text: string } {
  if (hour < 5) return { part: 'latenight', text: '凌晨' }
  if (hour < 8) return { part: 'dawn', text: '清晨' }
  if (hour < 11) return { part: 'morning', text: '上午' }
  if (hour < 13) return { part: 'noon', text: '中午' }
  if (hour < 17) return { part: 'afternoon', text: '下午' }
  if (hour < 19) return { part: 'evening', text: '傍晚' }
  if (hour < 23) return { part: 'night', text: '夜晚' }
  return { part: 'latenight', text: '深夜' }
}

function seasonOf(month: number): string {
  // 以农历节气的近似公历区间划分，够用即可
  if (month >= 3 && month <= 5) return '春'
  if (month >= 6 && month <= 8) return '夏'
  if (month >= 9 && month <= 11) return '秋'
  return '冬'
}

const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

export function snapshot(now: Date = new Date(), facts: EnvFacts = {}): EnvSnapshot {
  const h = now.getHours()
  const { part, text } = partOf(h)
  const m = now.getMonth() + 1
  const d = now.getDate()
  const isWeekend = now.getDay() === 0 || now.getDay() === 6

  const dk = dayKey(now)
  const sk = solarKey(now)
  // 节日优先取法定假期名（含"假期"字样，信息更足），否则公历节日，再否则农历
  const festival = CN_HOLIDAYS_2026[dk] ?? SOLAR_FESTIVALS[sk] ?? LUNAR_FESTIVALS[dk]

  // 法定休假判定：在假期表里 → 休；在调休表里 → 上班（即使周末）；否则看是否周末
  const holidayName = CN_HOLIDAYS_2026[dk]
  const makeup = CN_WORKDAYS_2026[dk]
  let isHoliday: boolean | undefined
  if (makeup) isHoliday = false
  else if (holidayName) isHoliday = true
  else if (now.getFullYear() === 2026) isHoliday = isWeekend
  else isHoliday = undefined // 无该年数据时不猜

  const snap: EnvSnapshot = {
    iso: now.toISOString(),
    dateText: `${now.getFullYear()}年${m}月${d}日 ${WEEK[now.getDay()]}`,
    clock: `${String(h).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    dayPart: part,
    dayPartText: text,
    season: seasonOf(m),
    weekend: isWeekend,
    isHoliday,
    isMakeupWorkday: makeup ? true : undefined
  }
  if (festival) snap.festival = festival

  // 会话时长 / 距上次对话：由调用方提供时间戳，这里只负责换算成自然语言
  if (typeof facts.sessionStartedAt === 'number' && facts.sessionStartedAt > 0) {
    const span = now.getTime() - facts.sessionStartedAt
    if (span > 60_000) snap.sessionDuration = humanDuration(span)
  }
  if (typeof facts.lastChatAt === 'number' && facts.lastChatAt > 0) {
    const gap = now.getTime() - facts.lastChatAt
    if (gap > 60_000) snap.sinceLastChat = humanDuration(gap)
  }
  if (facts.previousTopics) snap.previousTopics = facts.previousTopics
  return snap
}

/** 各时段下、符合人设的「在场感」提示 —— 只给方向，不给台词 */
const PART_HINT: Record<DayPart, string> = {
  latenight: '深夜。放轻节奏，不催事、不派新任务；对方还在忙就先照顾状态，而不是加压。',
  dawn: '清晨。语气清爽些，适合一天的开始，不必刻意沉重。',
  morning: '上午。平稳有条理，适合推进事情。',
  noon: '中午。可顺着「吃饭了吗／歇会儿」的真实节律关心一句，但不必每次都问。',
  afternoon: '下午。继续推进手头的事，语气保持稳定。',
  evening: '傍晚。一天收束的时段，适合回顾、放松、聊点轻的。',
  night: '夜晚。安静亲近一些，适合长一点、慢一点的对话。'
}

/**
 * 渲染成注入 system prompt 的环境块。
 * 注意：明确告诉模型「这是环境事实，不是记忆；不要朗读字段」。
 */
export function renderEnvBlock(env: EnvSnapshot, extra?: { modeText?: string }): string {
  const lines: string[] = []
  lines.push('# 当前环境（系统实时注入，是事实不是记忆）')
  lines.push(`- 时间：${env.dateText} ${env.clock}（${env.dayPartText}）`)
  const seasonal: string[] = [`季节：${env.season}`]
  if (env.festival) seasonal.push(`今天是 ${env.festival}`)
  if (env.isMakeupWorkday) seasonal.push('调休上班日')
  else if (env.isHoliday && !env.weekend) seasonal.push('休假日')
  else if (env.weekend && env.isHoliday !== false) seasonal.push('周末')
  else if (env.isHoliday === false) seasonal.push('工作日')
  lines.push(`- ${seasonal.join('　·　')}`)
  if (env.sessionDuration) lines.push(`- 本次对话已持续：${env.sessionDuration}`)
  if (env.sinceLastChat) lines.push(`- 距上次对话：${env.sinceLastChat}`)
  if (env.previousTopics) lines.push(`- 上次聊到：${env.previousTopics}`)
  if (extra?.modeText) lines.push(`- 模式：${extra.modeText}`)
  lines.push('')
  lines.push('用法：据此调整语气与温度，**不要报时、不要朗读字段名、不要每轮都提**，只在自然相关时轻描一句。')
  lines.push('对话历史中用户消息带时间标注（如「今天 14:30」「昨天 22:10」「3 天前」）：较早的对话发生在过去，回答时以标注时间为准，不要把前几天聊过的当成刚刚或今晚发生；你的回复紧跟其后的用户消息，时间以它为准，回复正文不要带时间前缀。')
  lines.push('节日不逢节必贺；久未联系不责问也不夸张想念；聊得太久可关心状态但不强行结束。')
  lines.push('「上次聊到」是上次会话的片段，可以自然承接，但不要复述、不要盘问对方后续，也不要假装记得没提供过的细节。')
  lines.push('这些参数不构成记忆，不能当作「我记得你昨天…」的依据；用户说的时间与此不符时以用户为准。')
  lines.push('')
  lines.push(composeHint(env))
  return lines.join('\n')
}

/** 把时段、假期、对话时长合成一段「此刻该怎么在场」的提示 */
function composeHint(env: EnvSnapshot): string {
  const parts: string[] = [PART_HINT[env.dayPart]]

  if (env.isMakeupWorkday) {
    parts.push('调休上班日，周末还要上班，人容易疲惫——正常陪着，别拿这点开玩笑。')
  } else if (env.festival && env.isHoliday) {
    parts.push(`今天是${env.festival}。可以带一点节日气息，但不煽情、不追问对方安排。`)
  } else if (env.weekend && env.isHoliday !== false) {
    parts.push('周末。节奏松一些；对方仍在忙时，不必强调「周末该休息」。')
  }

  const d = env.sessionDuration
  if (d) {
    // 只识别小时级以上的持续时间，分钟级不必多嘴
    if (/天|个月/.test(d)) {
      parts.push(`这次对话已经跨了${d}，是非常长的相处了。除非对方主动提，不要指出时间过了多久。`)
    } else if (/小时/.test(d)) {
      parts.push(`这次对话已经持续${d}。可以在合适的时候轻轻关心一句状态（喝水、歇一下），但只说一次，不要反复催。`)
    }
  }

  const g = env.sinceLastChat
  if (g) {
    if (/个月/.test(g)) {
      parts.push('距离上一次对话已经很久了。不要责问对方为什么这么久没来，也不要夸张地表达想念；像平常一样自然地接着聊。')
    } else if (/天/.test(g)) {
      parts.push(`距离上一次对话过了${g}。可以自然承接上次的语境，但不要盘问对方这些天做了什么。`)
    }
  }
  return parts.filter(Boolean).join('\n\n')
}
