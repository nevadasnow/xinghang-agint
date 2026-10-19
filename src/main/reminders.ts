import { app, Notification } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Reminder } from '../shared/types'

/**
 * E5 定时提醒
 *
 * 范围（方案 A：**应用内提醒**）：
 *   应用运行期间到点触发系统通知。应用完全退出后不会再提醒 ——
 *   要做到"关了也能提醒"必须注册 Windows 计划任务，那有系统侵入性，
 *   不在本轮范围（需要时可在设置里另行开启，届时另做）。
 *
 * 调度方式：**每分钟轮询一次**，而不是为每条提醒挂 setTimeout。
 *   理由：提醒可能跨越休眠/待机，setTimeout 在系统休眠后不准；
 *   轮询用当前时间比对，休眠恢复后会立刻补触发，行为可预期。
 *
 * 补触发策略：错过的提醒（应用没开着的那段时间）**只在 2 小时内补**，
 *   否则打开应用会被一堆过期提醒淹没。
 */

const CATCHUP_WINDOW_MS = 2 * 60 * 60 * 1000
const TICK_MS = 30_000

interface ReminderFile {
  reminders: Reminder[]
}

function filePath(): string {
  return join(app.getPath('userData'), 'reminders.json')
}

/** 归一化：过滤非法条目，避免一条坏数据让整个列表失效 */
function normalize(raw: unknown): Reminder[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((r) => r as Partial<Reminder>)
    .filter((r) => typeof r?.id === 'string' && typeof r?.text === 'string' && typeof r?.at === 'number')
    .map((r) => ({
      id: String(r.id),
      text: String(r.text).slice(0, 200),
      at: Number(r.at),
      repeat: r.repeat === 'daily' ? ('daily' as const) : ('once' as const),
      enabled: r.enabled !== false,
      lastFiredAt: typeof r.lastFiredAt === 'number' ? r.lastFiredAt : undefined
    }))
    .sort((a, b) => a.at - b.at)
}

function read(): Reminder[] {
  const p = filePath()
  if (!existsSync(p)) return []
  try {
    const data = JSON.parse(readFileSync(p, 'utf-8')) as ReminderFile
    return normalize(data?.reminders)
  } catch {
    return []
  }
}

function write(list: Reminder[]): Reminder[] {
  const clean = normalize(list)
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(filePath(), JSON.stringify({ reminders: clean }, null, 2), 'utf-8')
  return clean
}

export function listReminders(): Reminder[] {
  return read()
}

export function saveReminder(input: Partial<Reminder>): Reminder[] {
  const list = read()
  const at = Number(input.at)
  if (!Number.isFinite(at) || at <= 0) return list
  const text = String(input.text ?? '').trim().slice(0, 200)
  if (!text) return list

  const id = input.id || `rem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const next: Reminder = {
    id,
    text,
    at,
    repeat: input.repeat === 'daily' ? 'daily' : 'once',
    enabled: input.enabled !== false
  }
  const i = list.findIndex((r) => r.id === id)
  if (i >= 0) list[i] = { ...list[i], ...next }
  else list.push(next)
  return write(list)
}

export function deleteReminder(id: string): Reminder[] {
  return write(read().filter((r) => r.id !== id))
}

export function toggleReminder(id: string, enabled: boolean): Reminder[] {
  return write(read().map((r) => (r.id === id ? { ...r, enabled } : r)))
}

/**
 * 启动调度器。
 *
 * 「该不该响」的判断直接在 tick 里做（比对 at 与 lastFiredAt），
 * 不再单独算"下一次时间"——那样会产生两份需要保持一致的逻辑。
 * 这个模块刻意只留一条判定路径。
 *
 * @param onFire 触发时的回调：主进程用来弹系统通知并通知渲染层，
 *               让对话界面也能留一条痕迹（通知容易被漏看）。
 * @returns 停止函数
 */
export function startReminderScheduler(onFire: (r: Reminder) => void): () => void {
  const tick = (): void => {
    const now = Date.now()
    const list = read()
    let changed = false

    for (const r of list) {
      if (!r.enabled) continue
      // 还没到点就跳过（每日提醒的 at 是首次设定时刻，跨天由下面的「今天该响的时刻」判定）
      if (r.at > now) continue

      if (r.repeat === 'daily') {
        // 每日提醒：算出「今天这个时刻」，若今天已经响过就跳过。
        // 用「今天该响的时刻」而不是 at 本身比较，否则跨天后 lastFiredAt(昨天)
        // 会小于 at(更早的昨天)，导致同一条被反复触发。
        const today = new Date(now)
        today.setHours(new Date(r.at).getHours(), new Date(r.at).getMinutes(), 0, 0)
        if ((r.lastFiredAt ?? 0) >= today.getTime()) continue
      } else if (typeof r.lastFiredAt === 'number') {
        continue // 一次性提醒触发过就不再触发
      } else if (now - r.at > CATCHUP_WINDOW_MS) {
        // 错过太久（比如应用关了好几天）就不再打扰，直接标记为已处理，
        // 否则一打开应用会被一堆过期提醒淹没
        r.lastFiredAt = now
        changed = true
        continue
      }

      r.lastFiredAt = now
      changed = true
      try {
        onFire(r)
      } catch {
        /* 单条提醒触发失败不应中断整个调度 */
      }
    }
    if (changed) write(list)
  }

  tick() // 启动时先补一次，处理"应用刚打开就该响"的情况
  const timer = setInterval(tick, TICK_MS)
  return () => clearInterval(timer)
}

/** 弹系统通知（Windows 上会进操作中心） */
export function notify(title: string, body: string): void {
  try {
    if (!Notification.isSupported()) return
    new Notification({ title, body }).show()
  } catch {
    /* 某些受管环境不允许通知，忽略即可 */
  }
}
