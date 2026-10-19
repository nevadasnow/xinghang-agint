import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DailyUsage, ModelUsageEntry, TokenUsageRaw, UsageStats } from '../shared/types'

/* ============================================================
   Token 用量统计（仅本地）
   每次模型 API 调用成功后，把响应的 usage 累加进
   <userData>/token-usage.json。不涉及任何上传。
   结构：累计字段 + byModel（按模型）+ daily（按本地日期，
   供设置界面做每日/每周/每月/累计与趋势图表）。
   ============================================================ */

const usageFile = (): string => join(app.getPath('userData'), 'token-usage.json')

const emptyModel = (): ModelUsageEntry => ({
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  lastAt: 0
})

const emptyDaily = (): DailyUsage => ({
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  byModel: {}
})

const empty = (): UsageStats => ({
  totalCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  cacheHitTokens: 0,
  cacheMissTokens: 0,
  updatedAt: 0,
  byModel: {},
  daily: {}
})

function load(): UsageStats {
  try {
    const raw = JSON.parse(readFileSync(usageFile(), 'utf8')) as Partial<UsageStats>
    const daily: Record<string, DailyUsage> = {}
    if (raw.daily && typeof raw.daily === 'object') {
      for (const [k, v] of Object.entries(raw.daily)) {
        const d = v as Partial<DailyUsage>
        daily[k] = {
          ...emptyDaily(),
          ...d,
          byModel: d.byModel && typeof d.byModel === 'object' ? (d.byModel as Record<string, ModelUsageEntry>) : {}
        }
      }
    }
    return {
      ...empty(),
      ...raw,
      byModel: raw.byModel && typeof raw.byModel === 'object' ? (raw.byModel as Record<string, ModelUsageEntry>) : {},
      daily
    }
  } catch {
    return empty()
  }
}

function save(stats: UsageStats): void {
  try {
    const file = usageFile()
    const dir = file.slice(0, Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')))
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(stats, null, 2), 'utf8')
  } catch {
    /* 写盘失败不影响对话 */
  }
}

/** 本地日期字符串 YYYY-MM-DD（与渲染层聚合口径一致） */
function dayKey(ts: number): string {
  const d = new Date(ts)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 记录一次成功的模型调用用量（usage 缺失时静默忽略） */
export function recordUsage(model: string, usage?: TokenUsageRaw | null): void {
  if (!usage) return
  const prompt = Math.max(0, Number(usage.prompt_tokens) || 0)
  const completion = Math.max(0, Number(usage.completion_tokens) || 0)
  const total = Math.max(0, Number(usage.total_tokens) || (prompt + completion))
  if (total <= 0 && prompt <= 0 && completion <= 0) return
  const hit =
    Math.max(0, Number(usage.prompt_cache_hit_tokens) || 0) ||
    Math.max(0, Number(usage.prompt_tokens_details?.cached_tokens) || 0)
  // 命中/未命中拆分：优先用接口返回的 miss；只有 cached_tokens（OpenAI 新格式）时按 prompt-hit 推算
  let miss = Math.max(0, Number(usage.prompt_cache_miss_tokens) || 0)
  if (miss <= 0 && hit > 0) miss = Math.max(0, prompt - hit)
  const now = Date.now()

  const stats = load()
  stats.totalCalls += 1
  stats.promptTokens += prompt
  stats.completionTokens += completion
  stats.totalTokens += total
  stats.cacheHitTokens += hit
  stats.cacheMissTokens += miss
  stats.updatedAt = now

  const key = (model ?? '').trim() || '未知模型'

  const addEntry = (entry: ModelUsageEntry): void => {
    entry.calls += 1
    entry.promptTokens += prompt
    entry.completionTokens += completion
    entry.cacheHitTokens += hit
    entry.cacheMissTokens += miss
    entry.lastAt = now
  }

  addEntry(stats.byModel[key] ?? (stats.byModel[key] = emptyModel()))

  // 按日明细
  const dk = dayKey(now)
  const day = stats.daily?.[dk] ?? (stats.daily![dk] = emptyDaily())
  day.calls += 1
  day.promptTokens += prompt
  day.completionTokens += completion
  day.totalTokens += total
  day.cacheHitTokens += hit
  day.cacheMissTokens += miss
  addEntry(day.byModel[key] ?? (day.byModel[key] = emptyModel()))

  save(stats)
}

export function getUsageStats(): UsageStats {
  return load()
}

export function resetUsageStats(): UsageStats {
  const stats = empty()
  save(stats)
  return stats
}
