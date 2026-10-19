/**
 * E5 提醒时间解析（纯本地，零模型调用）
 *
 * 目的：不必让人手算 24 小时制。支持这些写法：
 *   09:30 / 9:30 / 930        —— 具体时刻
 *   今晚8点 / 明早9点 / 下午3点 —— 带时段词
 *   明天 / 后天 / 3天后        —— 相对日期
 *   下周一                     —— 下周几
 *   3小时后 / 30分钟后         —— 相对时长
 *
 * 设计原则：
 *   1) 解析不出来就**明确返回 null**，绝不"猜一个最近的时间"——
 *      提醒响错时间比不响更让人失去信任。
 *   2) 返回一段人类可读的描述，让用户在添加前能核对理解是否一致。
 */

export interface ParsedTime {
  at: number
  /** 自然语言描述，例如「明天 09:00」 */
  label: string
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function atTime(base: Date, h: number, m: number): Date {
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d
}

function label(d: Date): string {
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()

  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `今天 ${hh}:${mm}`
  if (isTomorrow) return `明天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hh}:${mm}`
}

/** 中文数字 → 阿拉伯数字（只处理 0-59，覆盖时间表达足够） */
const CN_NUM: Record<string, number> = {
  零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10
}

function cnToNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  // 十一 / 二十 / 二十三 / 十
  if (s === '十') return 10
  if (s.length === 1 && CN_NUM[s] !== undefined) return CN_NUM[s]
  const m = /^(.?)十(.*)$/.exec(s)
  if (m) {
    const tens = m[1] ? (CN_NUM[m[1]] ?? NaN) : 1
    const ones = m[2] ? (CN_NUM[m[2]] ?? NaN) : 0
    if (Number.isFinite(tens) && Number.isFinite(ones)) return tens * 10 + ones
  }
  return null
}

/**
 * 解析时间表达。
 *
 * @returns 解析成功返回时间与描述；无法理解返回 null（调用方据此提示用户）
 */
export function parseWhen(input: string, now: Date = new Date()): ParsedTime | null {
  const raw = (input ?? '').trim()
  if (!raw) return null
  const s = raw.replace(/\s+/g, '')

  /* ---------- 1) 相对时长：3小时后 / 30分钟后 ---------- */
  const rel = /^(\d+|[一二两三四五六七八九十]+)(个)?(小时|分钟|天)后$/.exec(s)
  if (rel) {
    const n = cnToNum(rel[1])
    if (n !== null && n > 0) {
      const d = new Date(now)
      if (rel[3] === '小时') d.setHours(d.getHours() + n)
      else if (rel[3] === '分钟') d.setMinutes(d.getMinutes() + n)
      else d.setDate(d.getDate() + n)
      return { at: d.getTime(), label: label(d) }
    }
  }

  /* ---------- 2) 明确时刻：09:30 / 9:30 / 930 ---------- */
  const clock = /^(\d{1,2})[:：](\d{2})$/.exec(s) ?? /^(\d{3,4})$/.exec(s)
  if (clock) {
    let h: number
    let m: number
    if (clock[2] !== undefined) {
      h = Number(clock[1])
      m = Number(clock[2])
    } else {
      const digits = clock[1]
      h = Number(digits.slice(0, digits.length - 2))
      m = Number(digits.slice(-2))
    }
    if (h <= 23 && m <= 59) {
      const d = atTime(now, h, m)
      // 无日期词的时刻：已过就顺延到明天（符合"我说 9 点"的日常直觉）
      if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
      return { at: d.getTime(), label: label(d) }
    }
    return null
  }

  /* ---------- 3) 日期词 + 可选时刻 ---------- */
  let dayOffset: number | null = null
  let weekdayTarget: number | null = null

  if (/^今天|^今晚|^今早|^今儿/.test(s)) dayOffset = 0
  else if (/^明天|^明早|^明晚/.test(s)) dayOffset = 1
  else if (/^后天/.test(s)) dayOffset = 2
  else {
    const after = /^(\d+|[一二两三四五六七八九十]+)天后/.exec(s)
    if (after) {
      const n = cnToNum(after[1])
      if (n !== null) dayOffset = n
    } else {
      const wd = /^下?(?:周|星期|礼拜)([一二三四五六日天])$/.exec(s)
      if (wd) {
        const t = wd[1] === '天' ? 0 : WEEKDAYS.indexOf(wd[1])
        if (t >= 0) weekdayTarget = t
      }
    }
  }

  /* ---------- 4) 时段词 → 小时修正 ---------- */
  let hourHint: number | null = null
  let hasPeriod = false
  if (/凌晨/.test(s)) {
    hourHint = 0
    hasPeriod = true
  } else if (/早上|早晨|清晨|一早|早/.test(s)) {
    hourHint = 0
    hasPeriod = true
  } else if (/上午/.test(s)) {
    hourHint = 0
    hasPeriod = true
  } else if (/中午|午间/.test(s)) {
    hourHint = 12
    hasPeriod = true
  } else if (/下午/.test(s)) {
    hourHint = 12
    hasPeriod = true
  } else if (/傍晚|晚上|晚|夜里|今晚|明晚/.test(s)) {
    hourHint = 12
    hasPeriod = true
  }

  /* ---------- 5) 从剩余文本里取「几点几分」 ---------- */
  let hh: number | null = null
  let mm = 0
  const hm = /(\d{1,2}|[一二两三四五六七八九十]+)点(半|(\d{1,2}|[一二两三四五六七八九十]+)分?)?/.exec(s)
  if (hm) {
    const h0 = cnToNum(hm[1])
    if (h0 !== null) {
      hh = h0
      if (hm[2] === '半') mm = 30
      else if (hm[3]) {
        const m0 = cnToNum(hm[3])
        if (m0 !== null) mm = m0
      }
      // 12 小时制修正：下午/晚上 1-11 点要 +12；凌晨 12 点视为 0 点
      if (hasPeriod && hourHint === 12 && hh < 12) hh += 12
      if (hasPeriod && hourHint === 0 && hh === 12) hh = 0
    }
  }

  if (dayOffset === null && weekdayTarget === null && hh === null) return null
  if (hh !== null && (hh > 23 || mm > 59)) return null

  const d = new Date(now)
  if (dayOffset !== null) {
    d.setDate(d.getDate() + dayOffset)
  } else if (weekdayTarget !== null) {
    // 「周X」= 最近的未来那个星期几；「下周X」= 在它基础上再推一周。
    // 先取"下一个该星期几"，若是"下周"则整体 +7 天。
    const cur = d.getDay() // 0=周日
    let delta = (weekdayTarget - cur + 7) % 7
    if (delta === 0) delta = 7 // 今天就是那天时，指下一个
    if (/^下/.test(s)) delta += 7
    d.setDate(d.getDate() + delta)
  }

  // 有具体时刻就套上去，只给日期词则默认 09:00（早上的常规提醒时间）
  const finalH = hh ?? (hasPeriod && hourHint === 12 ? 20 : 9)
  const finalM = hh !== null ? mm : 0
  d.setHours(finalH, finalM, 0, 0)

  // 纯时刻（无日期词）且已过 → 顺延到明天
  if (dayOffset === null && weekdayTarget === null && hh !== null && d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1)
  }
  // 有日期词时，若算出来仍在过去（例如只说"今晚"但已经凌晨）也顺延一天
  if ((dayOffset !== null || weekdayTarget !== null) && d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1)
  }

  return { at: d.getTime(), label: label(d) }
}
