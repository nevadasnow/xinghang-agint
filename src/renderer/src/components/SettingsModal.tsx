import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConfigInfo, ImportantDate, LlmConfig, ModelProfile, Reminder, UsageStats, DailyUsage } from '../../../shared/types'
import * as echarts from 'echarts'
import { VENDOR_PRESETS } from '../../../main/vendors'
import ToolSettingsModal from './ToolSettingsModal'
import AvatarCropModal from './AvatarCropModal'
import AssetPickerModal from './AssetPickerModal'
import {
  DEFAULT_USER_NAME,
  getChatAgentSize,
  getChatFontSize,
  getChatSpacing,
  getChatUserSize,
  getTheme,
  getUserProfile,
  currentDayPart,
  setChatAgentSize,
  setChatFontSize,
  setChatSpacing,
  setChatUserSize,
  setTheme,
  setUserProfile,
  getAppBgConfig,
  getSplashConfig,
  setAppBgConfig,
  resetAppBgConfig,
  setSplashConfig,
  type ThemeMode
} from '../utils/uiPrefs'
import { parseWhen } from '../utils/parseWhen'
import { getTtsRefByRole, setTtsRefForRole, DEFAULT_TTS_REFS, getTtsRefForRole } from '../utils/ttsRefs'
import { getAgentRole, getEffectiveAgentAvatar, AGENT_ROLE_LIST } from '../utils/agentRoles'
import type { AgentRoleId } from '../utils/agentRoles'

interface Props {
  open: boolean
  current: ConfigInfo | null
  onClose: () => void
  onSaved: (info: ConfigInfo) => void
}

function uid(): string {
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7)
}

/* ---------- 用量图表聚合（纯函数，本地数据） ---------- */

function emptyDaily(): DailyUsage {
  return { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, byModel: {} }
}

function dayKeys(daily: UsageStats['daily']): string[] {
  return Object.keys(daily ?? {}).sort()
}

/** 周标签：MM/DD 周（如 10/12 周），避免「10-12周」被误读成第 10~12 周 */
function weekLabelOf(bk: string): string {
  return bk.slice(5).replace('-', '/') + ' 周'
}
/** 周范围：MM/DD - MM/DD（tooltip 用，周一起止） */
function weekRangeOf(bk: string): string {
  const [y, m, d] = bk.split('-').map(Number)
  const start = new Date(y, m - 1, d)
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6)
  const p2 = (n: number) => String(n).padStart(2, '0')
  return p2(start.getMonth() + 1) + '/' + p2(start.getDate()) + ' - ' + p2(end.getMonth() + 1) + '/' + p2(end.getDate())
}
/** 自然周键：返回该日期所在周的周一 YYYY-MM-DD（本地时区） */
function weekKeyOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = (dt.getDay() + 6) % 7 // 周一 = 0
  const monday = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - dow)
  const p = (n: number) => String(n).padStart(2, '0')
  return monday.getFullYear() + '-' + p(monday.getMonth() + 1) + '-' + p(monday.getDate())
}

function monthKeyOf(day: string): string {
  return day.slice(0, 7)
}

function mergeEntry(target: DailyUsage, e: { calls: number; promptTokens: number; completionTokens: number; cacheHitTokens: number; cacheMissTokens: number }, model: string): void {
  target.calls += e.calls
  target.promptTokens += e.promptTokens
  target.completionTokens += e.completionTokens
  target.totalTokens += e.promptTokens + e.completionTokens
  target.cacheHitTokens += e.cacheHitTokens
  target.cacheMissTokens += e.cacheMissTokens
  const bm = target.byModel[model] ?? { calls: 0, promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, lastAt: 0 }
  bm.calls += e.calls
  bm.promptTokens += e.promptTokens
  bm.completionTokens += e.completionTokens
  bm.cacheHitTokens += e.cacheHitTokens
  bm.cacheMissTokens += e.cacheMissTokens
  target.byModel[model] = bm
}

/** 每日 / 每周 / 每月聚合（键升序） */
function aggregatePeriods(daily: UsageStats['daily'], mode: 'daily' | 'weekly' | 'monthly'): Array<{ key: string; label: string; usage: DailyUsage }> {
  const keys = dayKeys(daily)
  if (mode === 'daily') {
    return keys.map((k) => ({ key: k, label: k.slice(5), usage: daily![k] }))
  }
  const buckets = new Map<string, DailyUsage>()
  for (const k of keys) {
    const bk = mode === 'weekly' ? weekKeyOf(k) : monthKeyOf(k)
    if (!buckets.has(bk)) buckets.set(bk, emptyDaily())
    const b = buckets.get(bk)!
    const d = daily![k]
    b.calls += d.calls
    b.promptTokens += d.promptTokens
    b.completionTokens += d.completionTokens
    b.totalTokens += d.totalTokens
    b.cacheHitTokens += d.cacheHitTokens
    b.cacheMissTokens += d.cacheMissTokens
    for (const [m, e] of Object.entries(d.byModel)) mergeEntry(b, e, m)
  }
  return [...buckets.entries()].map(([bk, u]) => ({
    key: bk,
    label: mode === 'weekly' ? weekLabelOf(bk) : bk,
    usage: u
  }))
}

/** 累计总量（折线） */
function cumulativeSeries(daily: UsageStats['daily']): Array<{ label: string; total: number }> {
  let acc = 0
  return dayKeys(daily).map((k) => {
    acc += daily![k].totalTokens
    return { label: k.slice(5), total: acc }
  })
}

/** 近 N 天每模型趋势 */
function trendSeries(daily: UsageStats['daily'], days: number): { dates: string[]; models: string[]; series: Record<string, number[]> } {
  const dates: string[] = []
  const today = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    dates.push(d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()))
  }
  const models = new Set<string>()
  for (const k of Object.keys(daily ?? {})) for (const m of Object.keys(daily![k].byModel)) models.add(m)
  const series: Record<string, number[]> = {}
  for (const m of models) {
    series[m] = dates.map((d) => {
      const e = daily?.[d]?.byModel[m]
      return e ? e.promptTokens + e.completionTokens : 0
    })
  }
  return { dates, models: [...models], series }
}

/** 各模型总 tokens 占比 */
function modelShare(daily: UsageStats['daily']): Array<{ name: string; value: number }> {
  const map = new Map<string, number>()
  for (const k of Object.keys(daily ?? {})) {
    for (const [m, e] of Object.entries(daily![k].byModel)) {
      map.set(m, (map.get(m) ?? 0) + e.promptTokens + e.completionTokens)
    }
  }
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
}

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

const CHART_PALETTE = ['#5b8def', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#64748b', '#e11d48']

function sameCredential(a: { baseURL: string; apiKey: string; model: string }, b: { baseURL: string; apiKey: string; model: string }): boolean {
  return (
    a.baseURL.trim() === b.baseURL.trim() &&
    a.apiKey.trim() === b.apiKey.trim() &&
    a.model.trim() === b.model.trim()
  )
}

type SettingsTab = 'general' | 'model' | 'agent' | 'appearance' | 'voice' | 'usage' | 'profile'

const THEME_OPTIONS: Array<{ id: ThemeMode; label: string; desc: string }> = [
  { id: 'sky', label: '经典颜色（守岸蓝）', desc: '守岸蓝浅色主题（默认）' },
  { id: 'dark', label: '纯黑', desc: '深海夜色主题' },
  { id: 'light', label: '纯白', desc: '明亮简洁主题' },
  { id: 'system', label: '跟随系统', desc: '自动匹配系统深浅色' },
  { id: 'sakura', label: '绯樱', desc: '暖粉浅色主题' },
  { id: 'bamboo', label: '青竹', desc: '冷绿浅色主题' },
  { id: 'mornye', label: '莫宁紫', desc: '浅紫渐变主题' },
  { id: 'mita', label: '米塔粉', desc: '浅粉治愈主题（善良米塔）' },
  { id: 'silverwolf', label: '银狼紫', desc: '银白星空主题（银狼）' }
]

export default function SettingsModal({ open, current, onClose, onSaved }: Props) {
  const [tab, setTab] = useState<SettingsTab>('model')
  /** 只在每次「打开」弹窗瞬间切到模型设置；保存/配置刷新（current 变化）不再回跳 tab */
  const openedOnce = useRef(false)

  // ---------- Token 用量统计（仅本地） ----------
  const [usage, setUsage] = useState<UsageStats | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    void window.shorekeeper.getUsage().then((u) => {
      if (alive) setUsage(u)
    })
    return () => {
      alive = false
    }
  }, [open])
  async function refreshUsage(): Promise<void> {
    setUsage(await window.shorekeeper.getUsage())
  }

  // ---------- 用量可视化 ----------
  const [periodMode, setPeriodMode] = useState<'daily' | 'weekly' | 'monthly' | 'total'>('daily')
  const [trendDays, setTrendDays] = useState<30 | 7 | 90>(30)
  const periodElRef = useRef<HTMLDivElement | null>(null)
  const trendElRef = useRef<HTMLDivElement | null>(null)
  const shareElRef = useRef<HTMLDivElement | null>(null)
  const periodChartRef = useRef<echarts.ECharts | null>(null)
  const trendChartRef = useRef<echarts.ECharts | null>(null)
  const shareChartRef = useRef<echarts.ECharts | null>(null)
  async function clearUsage(): Promise<void> {
    setUsage(await window.shorekeeper.resetUsage())
    setMsg('已清空本机 Token 用量统计')
  }



  // ---------- 用户信息 ----------
  const [userName, setUserName] = useState(() => getUserProfile().name)
  const [userBio, setUserBio] = useState(() => getUserProfile().bio)
  const [userAvatar, setUserAvatar] = useState(() => getUserProfile().avatar)
  /** C1：关于用户的事实，逐条注入 prompt */
  const [userFacts, setUserFacts] = useState<string[]>(() => getUserProfile().facts)
  /** C4：重要日期（生日/纪念日/截止日） */
  const [userDates, setUserDates] = useState<ImportantDate[]>(() => getUserProfile().dates)
  /** 关掉后画像不进 prompt（省 token） */
  const [profileEnabled, setProfileEnabled] = useState(() => getUserProfile().profileEnabled)
  /* ---------- D1 本地语音朗读（GPT-SoVITS api_v2） ---------- */
  const [ttsURL, setTtsURL] = useState(() => current?.ttsURL ?? 'http://localhost:9872')
  const [ttsRefAudio, setTtsRefAudio] = useState(() => current?.ttsRefAudio ?? '')
  /** 每个角色的自定义参考音频（切换角色时自动应用） */
  const [refByRole, setRefByRole] = useState<Partial<Record<AgentRoleId, string>>>(() => getTtsRefByRole())
  const [ttsPromptText, setTtsPromptText] = useState(() => current?.ttsPromptText ?? '')
  /** 'idle' | 'busy' | 'ok' | 'ok-cached' | 错误文本 */
  const [ttsState, setTtsState] = useState<string>('idle')
  /** 本地语音缓存统计（同文本二次朗读秒播） */
  const [cacheCount, setCacheCount] = useState(0)
  const [cacheBytes, setCacheBytes] = useState(0)
  /* ---------- 小米 MiMo 云端 TTS ---------- */
  const [ttsProvider, setTtsProvider] = useState<'local' | 'mimo' | 'indextts'>(() => current?.ttsProvider ?? 'local')
  const [mimoTTSKey, setMimoTTSKey] = useState(() => current?.mimoTTSKey ?? '')
  const [mimoKeyLocked, setMimoKeyLocked] = useState(() => Boolean(current?.mimoTTSKey))
  const [mimoKeyVisible, setMimoKeyVisible] = useState(true)
  const [mimoTTSModel, setMimoTTSModel] = useState(() => current?.mimoTTSModel ?? 'mimo-v2.5-tts')
  const [mimoTTSVoice, setMimoTTSVoice] = useState(() => current?.mimoTTSVoice ?? 'mimo_default')
  const [mimoTTSBaseURL, setMimoTTSBaseURL] = useState(
    () => current?.mimoTTSBaseURL ?? 'https://api.xiaomimimo.com/v1'
  )
  const [mimoStylePrompt, setMimoStylePrompt] = useState(() => current?.mimoStylePrompt ?? '')
  /* ---------- IndexTTS 本地引擎（参照 D:\shorekeeper-agent 移植） ---------- */
  const [indexttsRefAudio, setIndexttsRefAudio] = useState(() => current?.indexttsRefAudio ?? '')
  const [indexttsUseRoleRef, setIndexttsUseRoleRef] = useState<boolean>(() => current?.indexttsUseRoleRef !== false)
  const [indexttsDevice, setIndexttsDevice] = useState<'cuda' | 'cpu'>(() => current?.indexttsDevice ?? 'cuda')
  const [indexttsSpeed, setIndexttsSpeed] = useState(() => current?.indexttsSpeed ?? 1.0)
  const [indexttsPitch, setIndexttsPitch] = useState(() => current?.indexttsPitch ?? 0)
  const [indexttsVolume, setIndexttsVolume] = useState(() => current?.indexttsVolume ?? 100)
  const [indexttsSTTEnabled, setIndexttsSTTEnabled] = useState(() => current?.indexttsSTTEnabled ?? false)
  const [indexttsSTTModelDir, setIndexttsSTTModelDir] = useState(() => current?.indexttsSTTModelDir ?? '')
  const [indexStatus, setIndexStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [sttStatus, setSttStatus] = useState<{ ok: boolean; message: string } | null>(null)
  /* ---------- 常规设置：关闭行为 + 开机自启 ---------- */
  const [closeBehavior, setCloseBehavior] = useState<'ask' | 'tray' | 'quit'>(() => current?.closeBehavior ?? 'ask')
  const [skipCloseConfirm, setSkipCloseConfirm] = useState(() => Boolean(current?.skipCloseConfirm))
  const [confirmDangerous, setConfirmDangerous] = useState(() => current?.confirmDangerousTools !== false)
  const [trayEnabled, setTrayEnabled] = useState(() => current?.trayEnabled !== false)
  const [autoLaunch, setAutoLaunch] = useState(() => Boolean(current?.autoLaunch))
  const [scEnabled, setScEnabled] = useState(() => current?.globalShortcutEnabled !== false)
  const [scAccel, setScAccel] = useState(() => current?.globalShortcut ?? 'CommandOrControl+Shift+S')
  /** 全局快捷键是否真的注册上了（被别的程序占用时会失败，需要如实告知） */
  const [scRegistered, setScRegistered] = useState<boolean | null>(null)
  /* ---------- E5 定时提醒 ---------- */
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [remText, setRemText] = useState('')
  const [remTime, setRemTime] = useState('09:00')
  const [remRepeat, setRemRepeat] = useState<'once' | 'daily'>('once')
  const [remMsg, setRemMsg] = useState('')
  const userFileRef = useRef<HTMLInputElement | null>(null)
  const [userCropOpen, setUserCropOpen] = useState(false)
  const [userCropImage, setUserCropImage] = useState<string | null>(null)
  /** 选择图片 → 打开裁剪界面（与 Agent 头像同款：缩放移动圆框选择） */
  function onUserAvatarFile(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      setUserCropImage(String(reader.result ?? ''))
      setUserCropOpen(true)
      if (userFileRef.current) userFileRef.current.value = ''
    }
    reader.readAsDataURL(f)
  }
  /** 裁剪确认：以圆内区域作为用户头像 */
  function onUserCropConfirm(dataUrl: string): void {
    setUserAvatar(dataUrl)
    setUserCropOpen(false)
    setUserCropImage(null)
  }
  function saveUserProfile(): void {
    const next = {
      name: userName.trim() || DEFAULT_USER_NAME,
      bio: userBio.trim(),
      avatar: userAvatar,
      // C1/C4：这些字段参与对话注入，与原 name/bio/avatar 存在同一份 localStorage 里，
      // 保证「从设置改」和「从对话页读」永远是同一份画像
      facts: userFacts.map((f) => f.trim()).filter(Boolean),
      dates: userDates.filter((d) => d.label.trim() && /^\d{1,4}-\d{1,2}(-\d{1,2})?$/.test(d.date.trim())),
      profileEnabled: profileEnabled
    }
    setUserProfile(next)
    setMsg('用户信息已保存到本机')
    window.dispatchEvent(new CustomEvent('sk:user-profile-changed'))
  }

  /** 把当前语音配置整份写入 config（手动「保存」与自动保存共用同一份数据） */
  function persistVoice(): Promise<ConfigInfo> {
    return window.shorekeeper.saveConfig({
      ...(current ?? {}),
      ttsURL: ttsURL.trim(),
      ttsRefAudio: ttsRefAudio.trim(),
      ttsPromptText: ttsPromptText.trim(),
      ttsProvider,
      mimoTTSKey: mimoTTSKey.trim(),
      mimoTTSModel,
      mimoTTSVoice,
      mimoTTSBaseURL: mimoTTSBaseURL.trim(),
      mimoStylePrompt: mimoStylePrompt.trim(),
      indexttsRefAudio: indexttsRefAudio.trim(),
      indexttsUseRoleRef,
      indexttsDevice,
      indexttsSpeed,
      indexttsPitch,
      indexttsVolume,
      indexttsSTTEnabled,
      indexttsSTTModelDir: indexttsSTTModelDir.trim()
    })
  }

  /** 保存语音配置（手动「保存」按钮） */
  function saveVoice(): void {
    void persistVoice()
      .then((next) => {
        onSaved?.(next)
        // 保存成功：MiMo Key 锁定（后续只显示掩码，保持可用）
        if (ttsProvider === 'mimo' && mimoTTSKey.trim() && !mimoKeyLocked) {
          setMimoKeyLocked(true)
          setMimoTTSKey(next.mimoTTSKey ?? '')
        }
      })
      .then(() => setMsg('语音设置已保存到本机'))
      .catch((e: unknown) => setMsg((e as Error)?.message || '保存失败'))
  }

  /** 调节细节/文本输入即时自动保存（防抖 600ms）：切走或重开设置都不会丢 */
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function queueVoiceSave(): void {
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current)
    voiceTimerRef.current = setTimeout(() => {
      voiceTimerRef.current = null
      void persistVoice()
        .then((next) => {
          onSaved?.(next)
          if (ttsProvider === 'mimo' && mimoTTSKey.trim() && !mimoKeyLocked) {
            setMimoKeyLocked(true)
            setMimoTTSKey(next.mimoTTSKey ?? '')
          }
        })
        .catch(() => {
          /* 自动保存失败静默，手动点「保存」兜底 */
        })
    }, 600)
  }

  /** 语气描述：输入即自动保存（与其它调节共用 queueVoiceSave 防抖） */
  const styleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function onStylePromptChange(v: string): void {
    setMimoStylePrompt(v)
    queueVoiceSave()
  }
  // 注意：不在这里清理 voiceTimerRef/styleTimerRef——让防抖定时器自然触发，
  // 这样关闭设置时最后一步调节（600ms 内）也会照常落盘，不会丢失。
  // 定时器闭包捕获的是最后一次渲染的 state，即最新值。

  /** 测试 TTS 服务是否在线（GPT-SoVITS / MiMo 由主进程按配置分流；IndexTTS 走引擎状态） */
  async function testVoice(): Promise<void> {
    setTtsState('busy')
    if (ttsProvider === 'indextts') {
      const st = await window.shorekeeper.indexttsStatus()
      setTtsState(st.ok ? 'ok' : st.message || '连接失败')
      setIndexStatus(st)
      return
    }
    const r = await window.shorekeeper.ttsProbe()
    setTtsState(r.ok ? 'ok' : r.error || '连接失败')
  }

  /** 引擎切到 IndexTTS 时自动检测一次就绪状态 */
  useEffect(() => {
    if (ttsProvider === 'indextts') {
      void window.shorekeeper.indexttsStatus().then(setIndexStatus)
    }
  }, [ttsProvider])

  /** 选择 IndexTTS 参考音频并写回配置 */
  async function pickIndexRef(): Promise<void> {
    const next = await window.shorekeeper.indexttsPickRef()
    onSaved?.(next)
    setIndexttsRefAudio(next.indexttsRefAudio ?? '')
  }

  /** 检测 faster-whisper 模型目录 */
  async function checkStt(): Promise<void> {
    setSttStatus(await window.shorekeeper.indexttsSttStatus(indexttsSTTModelDir.trim()))
  }

  /** 刷新本地语音缓存统计 */
  async function refreshCacheStats(): Promise<void> {
    const st = await window.shorekeeper.ttsCacheStats()
    setCacheCount(st.count)
    setCacheBytes(st.bytes)
  }

  function fmtBytes(n: number): string {
    if (n < 1024) return n + ' B'
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
    return (n / 1024 / 1024).toFixed(1) + ' MB'
  }

  async function clearCache(): Promise<void> {
    await window.shorekeeper.ttsCacheClear()
    setMsg('语音缓存已清空')
    void refreshCacheStats()
  }

  /** 试听：用参考音频的文本念一句，验证音色与链路。
   *  缓存命中时秒回（同一句文本不会重新合成）；播放时应用 IndexTTS 语速/音量滑块，
   *  所以「调细节 → 再试听」能立刻听到调整效果而无需重新合成。 */
  async function previewVoice(): Promise<void> {
    setTtsState('busy')
    const r = await window.shorekeeper.ttsSpeak(ttsPromptText.trim() || '我在这里，听得到我吗？', currentDayPart())
    if (!r.ok || !r.dataUrl) {
      setTtsState(r.error || '合成失败')
      return
    }
    setTtsState(r.cached ? 'ok-cached' : 'ok')
    const a = new Audio(r.dataUrl)
    if (current?.ttsProvider === 'indextts') {
      a.playbackRate = Math.min(2, Math.max(0.5, indexttsSpeed))
      a.volume = Math.min(1, Math.max(0, indexttsVolume / 100))
    }
    void a.play().catch(() => setTtsState('播放被拒绝，请再点一次'))
  }

  /** 重新生成试听：跳过本地缓存强制重新合成（不用清空整个缓存） */
  async function rePreviewVoice(): Promise<void> {
    setTtsState('busy')
    const r = await window.shorekeeper.ttsSpeak(
      ttsPromptText.trim() || '我在这里，听得到我吗？',
      currentDayPart(),
      true
    )
    if (!r.ok || !r.dataUrl) {
      setTtsState(r.error || '合成失败')
      return
    }
    setTtsState('ok')
    const a = new Audio(r.dataUrl)
    if (current?.ttsProvider === 'indextts') {
      a.playbackRate = Math.min(2, Math.max(0.5, indexttsSpeed))
      a.volume = Math.min(1, Math.max(0, indexttsVolume / 100))
    }
    void a.play().catch(() => setTtsState('播放被拒绝，请再点一次'))
  }

  // E5：打开设置时拉取提醒列表（提醒不多，直接全量）
  useEffect(() => {
    if (!open) return
    void window.shorekeeper.remindersList().then(setReminders)
  }, [open])

  /** E5 新建提醒。把 "HH:MM" 与「今天/明天」合成为时间戳 */
  async function addReminder(): Promise<void> {
    const text = remText.trim()
    if (!text) {
      setRemMsg('先写点提醒内容')
      return
    }
    // 自然语言解析（纯本地）。解析不出来就明确报错，不猜时间——
    // 提醒响错时间比不响更让人失去信任。
    const parsed = parseWhen(remTime)
    if (!parsed) {
      setRemMsg('没理解这个时间。可以写 09:30、今晚8点、明早9点、3天后、下周一')
      return
    }
    const d = new Date(parsed.at)
    const next = await window.shorekeeper.remindersSave({
      text,
      at: d.getTime(),
      repeat: remRepeat,
      enabled: true
    })
    setReminders(next)
    setRemText('')
    setRemMsg(remRepeat === 'daily' ? `已设为每天 ${remTime}` : `已设为 ${parsed.label}`)
  }

  /** E5 删除提醒 */
  async function removeReminder(id: string): Promise<void> {
    setReminders(await window.shorekeeper.remindersDelete(id))
  }

  /** E5 启用/停用 */
  async function toggleReminderItem(id: string, enabled: boolean): Promise<void> {
    setReminders(await window.shorekeeper.remindersToggle(id, enabled))
  }

  /** 常规设置：关闭按钮行为 */
  async function saveCloseBehavior(v: 'ask' | 'tray' | 'quit'): Promise<void> {
    if (v === closeBehavior) return
    setCloseBehavior(v)
    const next = await window.shorekeeper.prefsCloseBehavior(v)
    onSaved?.(next)
    setMsg(
      v === 'ask' ? '已设为：关闭时每次询问'
        : v === 'tray' ? '已设为：关闭时最小化到托盘'
        : '已设为：关闭时直接退出'
    )
  }

  /** 常规设置：不再显示关闭确认 */
  async function saveSkipConfirm(v: boolean): Promise<void> {
    setSkipCloseConfirm(v)
    const next = await window.shorekeeper.prefsSkipCloseConfirm(v)
    onSaved?.(next)
    setMsg(v ? '已开启：关闭时不再弹窗确认' : '已关闭：关闭时按所选行为询问')
  }
  async function saveConfirmDangerous(v: boolean): Promise<void> {
    setConfirmDangerous(v)
    const next = await window.shorekeeper.prefsConfirmDangerous(v)
    onSaved?.(next)
    setMsg(v ? '已开启：高危操作前会请求你确认' : '已关闭：高危操作不再逐次询问')
  }

  /** F4：托盘常驻开关 */
  async function toggleTray(v: boolean): Promise<void> {
    setTrayEnabled(v)
    const next = await window.shorekeeper.prefsTray(v)
    onSaved?.(next)
    setMsg(v ? '已开启：关闭窗口会最小化到托盘' : '已关闭：关闭窗口将直接退出')
  }

  /** F8：开机自启开关 */
  async function toggleAutoLaunch(v: boolean): Promise<void> {
    setAutoLaunch(v)
    const next = await window.shorekeeper.prefsAutoLaunch(v)
    onSaved?.(next)
    setMsg(v ? '已设置开机自启' : '已取消开机自启')
  }

  /** F5：全局快捷键开关 + 组合键 */
  async function applyShortcut(enabled: boolean, accel: string): Promise<void> {
    const next = await window.shorekeeper.prefsShortcut({ enabled, accelerator: accel })
    onSaved?.(next)
    const st = await window.shorekeeper.prefsShortcutStatus()
    setScRegistered(st.registered)
    if (enabled && !st.registered) setMsg(`快捷键 ${accel} 注册失败（可能被其它程序占用）`)
    else setMsg(enabled ? `全局快捷键已启用：${accel}` : '全局快捷键已关闭')
  }

  /** 选参考音频文件 */
  async function pickRef(): Promise<void> {
    const next = await window.shorekeeper.ttsPickRef()
    if (next?.ttsRefAudio) {
      setTtsRefAudio(next.ttsRefAudio)
      onSaved?.(next)
    }
  }

  const [presetId, setPresetId] = useState('custom')
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  /** API Key 输入时明文可见；连接成功后锁定隐藏（不再可见） */
  const [keyLocked, setKeyLocked] = useState(false)
  const [showKey, setShowKey] = useState(true)
  /** 连接成功后 Key 以全 * 显示（值保留，二次连接/换模型无需重输） */
  const [maskedKey, setMaskedKey] = useState(false)
  const [model, setModel] = useState('')
  const [profiles, setProfiles] = useState<ModelProfile[]>([])
  const [defaultProfileId, setDefaultProfileId] = useState('')
  const [timeoutSec, setTimeoutSec] = useState(120)
  const [maxRetries, setMaxRetries] = useState(3)
  const [ctxTokens, setCtxTokens] = useState(131072)

  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [toolOpen, setToolOpen] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [fetchState, setFetchState] = useState<{ ok: boolean; text: string } | null>(null)

  // ---------- 外观 ----------
  const [theme, setThemeMode] = useState<ThemeMode>('sky')
  // 开屏动画 + 自定义界面背景（外观，即时保存）
  const [splashEnabled, setSplashEnabled] = useState(false)
  const [splashVideo, setSplashVideo] = useState('')
  const [splashSound, setSplashSound] = useState(false)
  const [splashPicker, setSplashPicker] = useState(false)
  const [bgEnabled, setBgEnabled] = useState(false)
  const [bgType, setBgType] = useState<'image' | 'video'>('image')
  const [bgSource, setBgSource] = useState('')
  const [bgOpacity, setBgOpacity] = useState(100)
  const [bgVeil, setBgVeil] = useState(30)
  const [bgBlur, setBgBlur] = useState(0)
  const [bgVeilColor, setBgVeilColor] = useState('#000000')
  const [bgFit, setBgFit] = useState<'cover' | 'contain' | 'stretch'>('cover')
  const [bgPicker, setBgPicker] = useState(false)
  useEffect(() => {
    if (!open || tab !== 'usage' || !usage || usage.totalCalls === 0) return
    const textColor = cssVar('--text-1', '#334155')
    const subColor = cssVar('--text-3', '#94a3b8')
    const lineColor = cssVar('--line-hi', '#e2e8f0')
    const axisStyle = { color: subColor, fontSize: 10.5 }
    const tip = { triggerOn: 'click' as const, renderMode: 'richText' as const, confine: true }
    const baseGrid = { left: 46, right: 18, top: 34, bottom: 30, containLabel: true }

    const rebuild = (): void => {
      // ---- 1) 周期统计（每日/每周/每月柱状，累计折线） ----
      if (periodElRef.current) {
        periodChartRef.current?.dispose()
        const chart = echarts.init(periodElRef.current)
        periodChartRef.current = chart
        if (periodMode === 'total') {
          const cum = cumulativeSeries(usage.daily)
          chart.setOption({
            grid: baseGrid,
            tooltip: { ...tip, trigger: 'axis', formatter: function (ps: any) {
              if (!ps || !ps.length) return ''
              return ps[0].axisValue + String.fromCharCode(10) + '累计 ' + ps[0].value.toLocaleString() + ' tokens'
            } },
            xAxis: { type: 'category', data: cum.map((c) => c.label), axisLabel: axisStyle, axisLine: { lineStyle: { color: lineColor } } },
            yAxis: { type: 'value', axisLabel: { ...axisStyle, formatter: (v: number) => (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)) }, splitLine: { lineStyle: { color: lineColor } } },
            series: [{ type: 'line', name: '累计', data: cum.map((c) => c.total), smooth: true, symbolSize: 5, lineStyle: { width: 2 }, itemStyle: { color: cssVar('--accent', '#5b8def') }, areaStyle: { opacity: 0.12 } }]
          } as echarts.EChartsOption)
        } else {
          const items = aggregatePeriods(usage.daily, periodMode)
          chart.setOption({
            grid: baseGrid,
            tooltip: { ...tip, trigger: 'axis', formatter: function (ps: any) {
              if (!ps || !ps.length) return ''
              const i = items[ps[0].dataIndex]
              if (!i) return ''
              const u = i.usage
              const hit = u.cacheHitTokens + u.cacheMissTokens
              const labelHead = periodMode === 'weekly' ? weekRangeOf(i.key) + String.fromCharCode(10) + i.label : i.label
              return labelHead + String.fromCharCode(10) +
                '调用 ' + u.calls + ' 次' + String.fromCharCode(10) +
                '输入 ' + u.promptTokens.toLocaleString() + ' · 输出 ' + u.completionTokens.toLocaleString() + String.fromCharCode(10) +
                '总计 ' + u.totalTokens.toLocaleString() + ' tokens' + (hit > 0 ? String.fromCharCode(10) + '缓存命中 ' + Math.round((u.cacheHitTokens / hit) * 100) + '%' : '')
            } },
            xAxis: { type: 'category', data: items.map((i) => i.label), axisLabel: { ...axisStyle, interval: Math.max(0, Math.floor(items.length / 12)) }, axisLine: { lineStyle: { color: lineColor } } },
            yAxis: { type: 'value', axisLabel: { ...axisStyle, formatter: (v: number) => (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)) }, splitLine: { lineStyle: { color: lineColor } } },
            series: [{ type: 'bar', name: 'tokens', data: items.map((i) => i.usage.totalTokens), barMaxWidth: 26, itemStyle: { color: cssVar('--accent', '#5b8def'), borderRadius: [4, 4, 0, 0] } }]
          } as echarts.EChartsOption)
        }
      }

      // ---- 2) 趋势（近 7/30/90 天，每模型一条线） ----
      if (trendElRef.current) {
        trendChartRef.current?.dispose()
        const chart = echarts.init(trendElRef.current)
        trendChartRef.current = chart
        const tr = trendSeries(usage.daily, trendDays)
        const seriesData = tr.models.map((m, idx) => ({
          name: m,
          type: 'line' as const,
          data: tr.series[m],
          smooth: true,
          symbolSize: 3,
          lineStyle: { width: 1.8 },
          itemStyle: { color: CHART_PALETTE[idx % CHART_PALETTE.length] }
        }))
        chart.setOption({
          grid: baseGrid,
          legend: { top: 0, left: 0, textStyle: { color: textColor, fontSize: 10.5 }, itemWidth: 14, itemHeight: 8, type: 'scroll' },
          tooltip: { ...tip, trigger: 'axis', formatter: function (ps: any) {
            if (!ps || !ps.length) return ''
            let out = ps[0].axisValue
            for (const item of ps) out += String.fromCharCode(10) + item.marker + item.seriesName + '：' + item.value.toLocaleString() + ' tokens'
            return out
          } },
          xAxis: { type: 'category', data: tr.dates.map((d) => d.slice(5)), axisLabel: { ...axisStyle, interval: Math.max(0, Math.floor(tr.dates.length / 10)) }, axisLine: { lineStyle: { color: lineColor } } },
          yAxis: { type: 'value', axisLabel: { ...axisStyle, formatter: (v: number) => (v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : String(v)) }, splitLine: { lineStyle: { color: lineColor } } },
          series: seriesData
        } as echarts.EChartsOption)
      }

      // ---- 3) 模型占比环形图 ----
      if (shareElRef.current) {
        shareChartRef.current?.dispose()
        const chart = echarts.init(shareElRef.current)
        shareChartRef.current = chart
        const share = modelShare(usage.daily)
        const total = share.reduce((a, b) => a + b.value, 0)
        chart.setOption({
          tooltip: {
            ...tip,
            trigger: 'item',
            formatter: function (p: any) {
              if (!p) return ''
              return p.name + String.fromCharCode(10) + p.value.toLocaleString() + ' tokens（' + p.percent + '%）'
            }
          },
          legend: { bottom: 0, left: 'center', textStyle: { color: textColor, fontSize: 10.5 }, itemWidth: 12, itemHeight: 8, type: 'scroll' },
          color: CHART_PALETTE,
          series: [{
            name: '模型占比',
            type: 'pie',
            radius: ['38%', '66%'],
            center: ['50%', '44%'],
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 5, borderColor: cssVar('--card', '#ffffff'), borderWidth: 2 },
            label: { show: false },
            emphasis: { label: { show: true, color: textColor, fontSize: 12, formatter: '{b}\n{d}%' } },
            data: share.map((m) => ({ name: m.name + (total > 0 ? ' · ' + ((m.value / total) * 100).toFixed(1) + '%' : ''), value: m.value }))
          }]
        } as echarts.EChartsOption)
      }
    }

    rebuild()
    const onResize = (): void => {
      periodChartRef.current?.resize()
      trendChartRef.current?.resize()
      shareChartRef.current?.resize()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      periodChartRef.current?.dispose()
      trendChartRef.current?.dispose()
      shareChartRef.current?.dispose()
      periodChartRef.current = null
      trendChartRef.current = null
      shareChartRef.current = null
    }
  }, [open, tab, usage, periodMode, trendDays, theme])
  const [chatAgentSize, setChatAgentSizeNum] = useState(28)
  const [chatUserSize, setChatUserSizeNum] = useState(38)
  const [chatFontSize, setChatFontSizeNum] = useState(13.5)
  const [chatSpacing, setChatSpacingNum] = useState(0)

  /** 打开设置时只从配置同步一次表单。
   *  之后 current 变化（自动保存等）不再回填，否则会把用户正在拖动/输入的
   *  调节值强制覆盖回去（表现为滑块"调的时候又变回去"）。 */
  const formSyncedRef = useRef(false)
  // 打开弹窗时从当前配置回填
  useEffect(() => {
    if (!open) {
      openedOnce.current = false
      formSyncedRef.current = false
      return
    }
    // 配置尚未加载（current 为 null）时先不同步，等 current 就绪后本 effect 会再跑一次
    if (!current) return
    if (formSyncedRef.current) return
    formSyncedRef.current = true
    setBaseURL(current?.baseURL ?? '')
    setApiKey(current?.apiKey ?? '')
    setModel(current?.model ?? '')
    setName(current?.displayName ?? '')
    setProfiles(current?.profiles ?? [])
    setDefaultProfileId(current?.defaultProfileId ?? '')
    setTimeoutSec(current?.timeoutSec ?? 120)
    setMaxRetries(current?.maxRetries ?? 3)
    setCtxTokens(current?.contextWindowTokens ?? 131072)
    setMsg('')
    setAdvancedOpen(false)
    setModelOptions([])
    setFetchState(null)
    setFetching(false)
    // 语音 / 常规设置回填：这些字段保存是显式的，每次打开都读最新值，
    // 否则 state 只保留首次挂载时的初值（挂载时 config 可能尚未加载），重启后参考音频等会显示为空
    setTtsURL(current?.ttsURL ?? 'http://localhost:9872')
    setTtsRefAudio(current?.ttsRefAudio ?? '')
    setTtsPromptText(current?.ttsPromptText ?? '')
    setIndexttsRefAudio(current?.indexttsRefAudio ?? '')
    setIndexttsUseRoleRef(current?.indexttsUseRoleRef !== false)
    setIndexttsDevice(current?.indexttsDevice ?? 'cuda')
    setIndexttsSpeed(current?.indexttsSpeed ?? 1.0)
    setIndexttsPitch(current?.indexttsPitch ?? 0)
    setIndexttsVolume(current?.indexttsVolume ?? 100)
    setIndexttsSTTEnabled(current?.indexttsSTTEnabled ?? false)
    setIndexttsSTTModelDir(current?.indexttsSTTModelDir ?? '')
    setCloseBehavior(current?.closeBehavior ?? 'ask')
    setSkipCloseConfirm(Boolean(current?.skipCloseConfirm))
    setConfirmDangerous(current?.confirmDangerousTools !== false)
    setTrayEnabled(current?.trayEnabled !== false)
    setAutoLaunch(Boolean(current?.autoLaunch))
    setScEnabled(current?.globalShortcutEnabled !== false)
    setScAccel(current?.globalShortcut ?? 'CommandOrControl+Shift+S')
    // 已有 Key：默认锁定并以 * 显示（真实值保留，二次连接无需重输）；空 Key 才明文输入
    setKeyLocked(Boolean(current?.apiKey))
    setMaskedKey(Boolean(current?.apiKey))
    // 回显预设：优先按 baseURL 匹配
    const url = (current?.baseURL ?? '').trim().toLowerCase()
    const matched =
      VENDOR_PRESETS.find((v) => v.baseURL && url.startsWith(v.baseURL.toLowerCase())) ??
      VENDOR_PRESETS.find((v) => v.id === 'custom')
    setPresetId(matched?.id ?? 'custom')
    // 外观回填
    setThemeMode(getTheme())
    setChatAgentSizeNum(getChatAgentSize())
    setChatUserSizeNum(getChatUserSize())
    setChatFontSizeNum(getChatFontSize())
    setChatSpacingNum(getChatSpacing())
    const sc = getSplashConfig()
    setSplashEnabled(sc.enabled)
    setSplashVideo(sc.video)
    setSplashSound(sc.sound)
    const bc = getAppBgConfig()
    setBgEnabled(bc.enabled)
    setBgType(bc.type)
    setBgSource(bc.source)
    setBgOpacity(bc.opacity)
    setBgVeil(bc.veil)
    setBgBlur(bc.blur)
    setBgVeilColor(bc.veilColor)
    setBgFit(bc.fit)
    if (!openedOnce.current) {
      openedOnce.current = true
      setTab('model')
      // MiMo TTS 首次打开回填（之后 current 变化——例如选完参考音频触发保存——
      // 不再重置引擎选择，避免 MiMo 表单被跳回本地 GPT-SoVITS）
      setTtsProvider(current?.ttsProvider ?? 'local')
      setMimoTTSKey(current?.mimoTTSKey ?? '')
      setMimoKeyLocked(Boolean(current?.mimoTTSKey))
      setMimoTTSModel(current?.mimoTTSModel ?? 'mimo-v2.5-tts')
      setMimoTTSVoice(current?.mimoTTSVoice ?? 'mimo_default')
      setMimoTTSBaseURL(current?.mimoTTSBaseURL ?? 'https://api.xiaomimimo.com/v1')
      setMimoStylePrompt(current?.mimoStylePrompt ?? '')
    }
    // 语音缓存统计（即便当前不在语音 tab，也保持数值新鲜）
    void refreshCacheStats()
  }, [open, current])

  const activePreset = useMemo(() => VENDOR_PRESETS.find((v) => v.id === presetId) ?? VENDOR_PRESETS[VENDOR_PRESETS.length - 1], [presetId])

    function splashVideoName(url: string): string {
    try {
      return decodeURIComponent(url.split('/').pop() || '')
    } catch {
      return url
    }
  }
  function pushBg(patch: Partial<{ enabled: boolean; type: 'image' | 'video'; source: string; opacity: number; veil: number; blur: number; veilColor: string; fit: 'cover' | 'contain' | 'stretch' }>): void {
    setAppBgConfig({
      enabled: patch.enabled ?? bgEnabled,
      type: patch.type ?? bgType,
      source: patch.source ?? bgSource,
      opacity: patch.opacity ?? bgOpacity,
      veil: patch.veil ?? bgVeil,
      blur: patch.blur ?? bgBlur,
      veilColor: patch.veilColor ?? bgVeilColor,
      fit: patch.fit ?? bgFit
    })
  }
  async function pickSplashCustom(): Promise<void> {
    const r = await window.shorekeeper.assetsPickCustom()
    if (!r) return
    if ('error' in r) return
    setSplashVideo(r.url)
    setSplashConfig({ enabled: true, video: r.url, sound: splashSound })
  }
  async function pickBgCustom(): Promise<void> {
    const r = await window.shorekeeper.assetsPickCustom()
    if (!r) return
    if ('error' in r) return
    setBgSource(r.url)
    setBgType(r.kind === 'video' ? 'video' : 'image')
    pushBg({ source: r.url, type: r.kind === 'video' ? 'video' : 'image' })
  }

  function applyPreset(id: string) {
    setPresetId(id)
    const p = VENDOR_PRESETS.find((v) => v.id === id)
    if (p && id !== 'custom') {
      setBaseURL(p.baseURL)
      setModel(p.defaultModel)
    }
    setFetchState(null)
    setModelOptions([])
  }

  // 保存当前表单为档案（同凭据去重，参照 Shorekeeper sameModelCredential）
  function saveAsProfile() {
    if (!baseURL.trim() || !model.trim()) {
      setMsg('请先填写接口地址与模型名，再保存档案')
      return
    }
    const profile: ModelProfile = {
      id: uid(),
      name: name.trim() || model.trim(),
      provider: activePreset.name,
      baseURL: baseURL.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      createdAt: Date.now()
    }
    const existing = profiles.find((p) => sameCredential(p, profile))
    if (existing) {
      setMsg('该配置已存在于档案列表，无需重复保存')
      return
    }
    const next = [...profiles, profile]
    setProfiles(next)
    if (!defaultProfileId) setDefaultProfileId(profile.id)
    setMsg('已加入档案列表，点击「保存」后生效')
  }

  function loadProfile(p: ModelProfile) {
    setPresetId(VENDOR_PRESETS.find((v) => v.name === p.provider)?.id ?? 'custom')
    setName(p.name)
    setBaseURL(p.baseURL)
    setApiKey(p.apiKey)
    setModel(p.model)
    setFetchState(null)
    setModelOptions([])
  }

  // 连接并获取模型（已合并测试连接）：拉取模型列表后，自动用当前模型（或列表第一个）测试聊天接口
  function fetchModels() {
    if (!baseURL.trim() || !apiKey.trim()) {
      setFetchState({ ok: false, text: '请先填写接口地址与 API Key，再获取模型列表' })
      return
    }
    setFetching(true)
    setFetchState(null)
    const cfg = { baseURL: baseURL.trim(), apiKey: apiKey.trim(), provider: activePreset.name, timeoutSec }
    window.shorekeeper
      .listModels(cfg)
      .then((r) => {
        if (r.ok) {
          const models = r.models ?? []
          setModelOptions(models)
          // 连接成功：锁定 API Key，全部以 * 显示（值保留，二次连接无需重输）
          setKeyLocked(true)
          setShowKey(false)
          setMaskedKey(true)
          const testModel = model.trim() || models[0] || ''
          if (!testModel) {
            setFetchState({ ok: true, text: `已连接（${r.count ?? models.length} 个模型），可在下方选择或手填` })
            return
          }
          // 顺带测试聊天接口（404 时主进程已自动回退兼容模式地址）
          return window.shorekeeper
            .testConfig({ ...cfg, model: testModel })
            .then((t) => {
              if (t.ok) {
                setFetchState({
                  ok: true,
                  text: `已连接（${r.count ?? models.length} 个模型）· 聊天接口正常（${t.latencyMs ?? '-'}ms）`
                })
              } else {
                setFetchState({
                  ok: false,
                  text: `已连接（${r.count ?? models.length} 个模型），但聊天接口不可用：${t.error ?? '未知错误'}`
                })
              }
            })
            .catch((e) => {
              setFetchState({ ok: false, text: `已连接（${r.count ?? models.length} 个模型），但聊天接口测试失败：${(e as Error).message}` })
            })
        } else {
          setModelOptions([])
          setFetchState({ ok: false, text: r.error ?? '获取失败' })
          return undefined
        }
      })
      .catch((e) => {
        setModelOptions([])
        setFetchState({ ok: false, text: (e as Error).message })
      })
      .finally(() => setFetching(false))
  }

  function deleteProfile(id: string) {
    const next = profiles.filter((p) => p.id !== id)
    setProfiles(next)
    if (defaultProfileId === id) setDefaultProfileId(next[0]?.id ?? '')
  }

  async function save() {
    if (!baseURL.trim() || !model.trim()) {
      setMsg('请填写接口地址和模型名')
      return
    }
    setSaving(true)
    setMsg('')
    try {
      const cfg: Partial<LlmConfig> = {
        baseURL: baseURL.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
        provider: activePreset.name,
        displayName: name.trim(),
        profiles,
        defaultProfileId,
        timeoutSec,
        maxRetries,
        contextWindowTokens: ctxTokens
      }
      const info = await window.shorekeeper.saveConfig(cfg)
      onSaved(info)
      setMsg('已保存，守岸人现在可以真正回应你了。')
    } catch (e) {
      setMsg('保存失败：' + (e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** 底部右下角「保存」键：按当前页签分派动作（其余页签改动均已即时自动保存） */
  function saveCurrentTab(): void {
    if (tab === 'model') {
      void save()
    } else if (tab === 'voice') {
      saveVoice()
    } else {
      setMsg('当前页面的改动已自动保存')
    }
  }

  // ---------- 外观交互 ----------
  function pickTheme(t: ThemeMode) {
    setThemeMode(t)
    // 用户手动选主题：与当前角色默认主题不同 → manual（记住用户选择，切角色不再跟随）；
    // 恰好等于当前角色默认主题 → auto（保持"跟随角色"）。
    const role = getAgentRole()
    setTheme(t, { manual: t !== role.defaultTheme })
  }

  if (!open) return null

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal settings-modal settings-full panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <button className="btn-back" onClick={onClose} aria-label="返回">
            ← 返回
          </button>
          <h3>设置</h3>
        </div>

        <div className="settings-layout">
          {/* 左侧导航栏 */}
          <nav className="settings-nav">
            <button
              className={'settings-nav-item' + (tab === 'general' ? ' on' : '')}
              onClick={() => setTab('general')}
            >
              <span className="sn-ic" aria-hidden="true">☰</span>常规设置
            </button>
            <button
              className={'settings-nav-item' + (tab === 'model' ? ' on' : '')}
              onClick={() => setTab('model')}
            >
              <span className="sn-ic" aria-hidden="true">⚙</span>模型设置
            </button>
            <button
              className={'settings-nav-item' + (tab === 'agent' ? ' on' : '')}
              onClick={() => setTab('agent')}
            >
              <span className="sn-ic" aria-hidden="true">✦</span>Agent 能力
            </button>
            <button
              className={'settings-nav-item' + (tab === 'appearance' ? ' on' : '')}
              onClick={() => setTab('appearance')}
            >
              <span className="sn-ic" aria-hidden="true">◐</span>外观
            </button>
            <button
              className={'settings-nav-item' + (tab === 'usage' ? ' on' : '')}
              onClick={() => setTab('usage')}
            >
              <span className="sn-ic" aria-hidden="true">▤</span>用量统计
            </button>
            <button
              className={'settings-nav-item' + (tab === 'voice' ? ' on' : '')}
              onClick={() => setTab('voice')}
            >
              <span className="sn-ic" aria-hidden="true">♪</span>语音合成
            </button>
            <button
              className={'settings-nav-item' + (tab === 'profile' ? ' on' : '')}
              onClick={() => setTab('profile')}
            >
              <span className="sn-ic" aria-hidden="true">◉</span>用户信息
            </button>
          </nav>

          {/* 右侧内容 */}
          <div className="settings-body">
            {tab === 'general' && (
              <>
                <div className="settings-section-title">关闭按钮行为</div>
                <p className="appearance-hint">
                  点击窗口右上角 ✕ 时，应用按下面的选择执行。
                </p>
                <div className="cb-list">
                  {(
                    [
                      { id: 'ask', label: '每次询问', desc: '弹出选择：最小化到托盘 / 直接退出 / 取消' },
                      { id: 'tray', label: '最小化到托盘', desc: '隐藏到系统托盘，后台继续运行（需托盘可用）' },
                      { id: 'quit', label: '直接退出', desc: '直接退出应用' }
                    ] as const
                  ).map((o) => (
                    <label
                      key={o.id}
                      className={'cb-item' + (closeBehavior === o.id ? ' on' : '')}
                      onClick={() => void saveCloseBehavior(o.id)}
                    >
                      <span className="cb-dot" aria-hidden="true" />
                      <span className="cb-text">
                        <span className="cb-label">{o.label}</span>
                        <span className="cb-desc">{o.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>

                <label
                  className="sw-row"
                  onClick={() => void saveSkipConfirm(!skipCloseConfirm)}
                >
                  <span className="sw-text">
                    <span className="sw-label">不再显示关闭确认</span>
                    <span className="sw-desc">勾选后点关闭直接按上面的选择执行，不再弹窗</span>
                  </span>
                  <span className={'switch' + (skipCloseConfirm ? ' on' : '')}>
                    <span className="switch-knob" aria-hidden="true" />
                  </span>
                </label>

                <label
                  className="sw-row"
                  onClick={() => void saveConfirmDangerous(!confirmDangerous)}
                >
                  <span className="sw-text">
                    <span className="sw-label">高危操作执行前需确认</span>
                    <span className="sw-desc">agent 要执行命令、模拟输入、启动应用等危险动作时，先在聊天输入框上方征求你的允许；本机权限为「完全权限」时直接执行不再询问</span>
                  </span>
                  <span className={'switch' + (confirmDangerous ? ' on' : '')}>
                    <span className="switch-knob" aria-hidden="true" />
                  </span>
                </label>

                <div className="settings-section-title gen-spacer">启动</div>
                <label
                  className="sw-row"
                  onClick={() => void toggleAutoLaunch(!autoLaunch)}
                >
                  <span className="sw-text">
                    <span className="sw-label">开机自启</span>
                    <span className="sw-desc">登录 Windows 后自动启动守岸人</span>
                  </span>
                  <span className={'switch' + (autoLaunch ? ' on' : '')}>
                    <span className="switch-knob" aria-hidden="true" />
                  </span>
                </label>
              </>
            )}

            {tab === 'model' && (
              <>
                <div className="settings-section-title">模型设置</div>

                <label className="field">
                  <span>服务商预设</span>
                  <select value={presetId} onChange={(e) => applyPreset(e.target.value)}>
                    {VENDOR_PRESETS.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>配置名称（可选，用于档案管理）</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：我的 DeepSeek" />
                </label>

                <label className="field">
                  <span>接口地址（Base URL）</span>
                  <input
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder="https://api.deepseek.com"
                  />
                </label>

                <label className="field">
                  <span>API Key{keyLocked ? '（已连接，Key 已隐藏；点 ✎ 可修改）' : ''}</span>
                  <div className="key-row">
                    <input
                      type="text"
                      value={maskedKey ? '*'.repeat(Math.max(8, apiKey.length)) : apiKey}
                      onChange={(e) => {
                        // 星号态只读，Key 不会被误触破坏；未连接时明文可编辑
                        if (maskedKey) return
                        setApiKey(e.target.value)
                      }}
                      readOnly={maskedKey}
                      placeholder="sk-……"
                    />
                    {!keyLocked && (
                      <button
                        type="button"
                        className="key-toggle"
                        onClick={() => setShowKey((v) => !v)}
                        title={showKey ? '隐藏' : '显示'}
                      >
                        {showKey ? '🙈' : '👁'}
                      </button>
                    )}
                    {keyLocked && (
                      <button
                        type="button"
                        className="key-toggle"
                        onClick={() => {
                          setKeyLocked(false)
                          setMaskedKey(false)
                          setShowKey(true)
                        }}
                        title="修改 API Key"
                      >
                        ✎
                      </button>
                    )}
                  </div>
                </label>

                {/* 连接并获取模型（参照参考图交互） */}
                <div className="fetch-row">
                  <button className="btn-primary btn-sm" onClick={fetchModels} disabled={fetching}>
                    {fetching ? '获取中……' : '连接并获取模型'}
                  </button>
                  {modelOptions.length > 0 && (
                    <button className="btn-ghost btn-sm" onClick={fetchModels} disabled={fetching}>
                      刷新列表
                    </button>
                  )}
                  {fetchState && (
                    <span className={fetchState.ok ? 'fetch-ok' : 'fetch-err'}>{fetchState.text}</span>
                  )}
                </div>

                {modelOptions.length > 0 && (
                  <label className="field">
                    <span>从列表选择（{modelOptions.length} 个可选）</span>
                    <select
                      value={modelOptions.includes(model) ? model : ''}
                      onChange={(e) => setModel(e.target.value)}
                    >
                      <option value="">—— 请选择模型 ——</option>
                      {modelOptions.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="field">
                  <span>MODEL ID（可手填，或从上方列表选择）</span>
                  <input
                    list="vendor-models"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={activePreset.defaultModel || 'deepseek-chat'}
                  />
                  <datalist id="vendor-models">
                    {activePreset.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </label>

                {activePreset.note && <p className="preset-note">提示：{activePreset.note}</p>}

                {/* 档案管理 */}
                <div className="section-title">
                  <span>已保存的模型档案</span>
                  <button className="btn-ghost btn-sm" onClick={saveAsProfile}>
                    ＋ 保存当前配置为档案
                  </button>
                </div>
                {profiles.length === 0 ? (
                  <p className="empty-hint">还没有档案。填入配置后点「＋ 保存当前配置为档案」，下次一键切换。</p>
                ) : (
                  <ul className="profile-list">
                    {profiles.map((p) => (
                      <li
                        key={p.id}
                        className={'profile-item' + (p.id === defaultProfileId ? ' is-default' : '')}
                        onClick={() => loadProfile(p)}
                      >
                        <span className="profile-star" title={p.id === defaultProfileId ? '当前默认' : '设为默认'}>
                          {p.id === defaultProfileId ? '★' : '☆'}
                        </span>
                        <span className="profile-main">
                          <span className="profile-name">
                            {p.name}
                            <em>{p.provider}</em>
                          </span>
                          <span className="profile-model">
                            {p.model} · {p.baseURL}
                          </span>
                        </span>
                        <span className="profile-ops" onClick={(e) => e.stopPropagation()}>
                          {p.id !== defaultProfileId && (
                            <button className="btn-ghost btn-xs" onClick={() => setDefaultProfileId(p.id)}>
                              设为默认
                            </button>
                          )}
                          <button
                            className="btn-ghost btn-xs danger"
                            onClick={() => deleteProfile(p.id)}
                            disabled={profiles.length === 1}
                            title={profiles.length === 1 ? '至少保留一个档案' : '删除'}
                          >
                            删除
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* 高级参数 */}
                <button className="advanced-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
                  {advancedOpen ? '▾' : '▸'} 高级参数
                </button>
                {advancedOpen && (
                  <div className="advanced-box">
                    <label className="field">
                      <span>请求超时（秒，30–1800）</span>
                      <input type="number" min={30} max={1800} value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value) || 120)} />
                    </label>
                    <label className="field">
                      <span>最大重试次数（0–10）</span>
                      <input type="number" min={0} max={10} value={maxRetries} onChange={(e) => setMaxRetries(Number(e.target.value) || 0)} />
                    </label>
                    <label className="field">
                      <span>上下文窗口（tokens）</span>
                      <input type="number" min={4096} value={ctxTokens} onChange={(e) => setCtxTokens(Number(e.target.value) || 131072)} />
                    </label>
                  </div>
                )}
              </>
            )}

            {tab === 'agent' && (
              <>
                <div className="settings-section-title">Agent 能力</div>
                {/* Agent 能力 · 工具开关（复刻 Shorekeeper ToolToggleSettingsPanel） */}
                <div className="tools-entry">
                  <div className="tools-entry-info">
                    <span className="tools-entry-title">工具开关</span>
                    <span className="tools-entry-desc">
                      按模式（工作 / 代码 / 学习 / 聊天）管理守岸人可调用的工具。
                    </span>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={() => setToolOpen(true)}>
                    打开工具开关
                  </button>
                </div>
              </>
            )}

            {tab === 'appearance' && (
              <>
                <div className="settings-section-title">外观</div>

                {/* 界面主题 */}
                <div className="appearance-block">
                  <div className="appearance-label">界面主题</div>
                  <div className="theme-grid">
                    {THEME_OPTIONS.map((t) => (
                      <button
                        key={t.id}
                        className={'theme-card' + (theme === t.id ? ' on' : '')}
                        onClick={() => pickTheme(t.id)}
                      >
                        <span className={`theme-swatch sw-${t.id}`} aria-hidden="true" />
                        <span className="theme-main">
                          <span className="theme-name">{t.label}</span>
                          <span className="theme-desc">{t.desc}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>


                  {/* 对话界面预览：参考对话布局，两方各一句长句，随下方滑块实时变化 */}
                  <div className="chat-preview chat-preview-lg" aria-hidden="true">
                    <div className="cp-row">
                      <span
                        className="cp-avatar cp-ai"
                        style={{ width: chatAgentSize + 10, height: chatAgentSize + 10 }}
                      >
                        <img
                          src={getEffectiveAgentAvatar(getAgentRole().id)}
                          alt=""
                          width={chatAgentSize}
                          height={chatAgentSize}
                          className="cp-img"
                        />
                      </span>
                      <span
                        className="cp-bubble cp-bubble-ai"
                        style={{ fontSize: chatFontSize, letterSpacing: chatSpacing }}
                      >
                        潮声渐息，海雾漫过礁石的边缘，我听见你的脚步踏过细碎的浪花，今晚的月色也为你停驻。
                      </span>
                    </div>
                    <div className="cp-row cp-row-user">
                      <span
                        className="cp-avatar cp-user"
                        style={{
                          width: chatUserSize,
                          height: chatUserSize,
                          fontSize: Math.max(9, chatUserSize * 0.42),
                          lineHeight: chatUserSize + 'px'
                        }}
                      >
                        你
                      </span>
                      <span
                        className="cp-bubble cp-bubble-user"
                        style={{ fontSize: chatFontSize, letterSpacing: chatSpacing }}
                      >
                        今天工作了一天有些疲惫，想找你说说话，最近总感觉时间过得很快，很多事情还没来得及做完一天就结束了。
                      </span>
                    </div>
                  </div>

                  {/* 对话界面显示设置：与对话页「⚙ 显示设置」弹窗同步 */}
                  <div className="appearance-block chat-display-block">
                    <div className="appearance-label">对话界面显示</div>

                    <label className="field range-field">
                      <span>Agent 头像大小：{chatAgentSize}px</span>
                      <input
                        type="range"
                        min={14}
                        max={56}
                        step={1}
                        value={chatAgentSize}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setChatAgentSizeNum(n)
                          setChatAgentSize(n)
                        }}
                      />
                    </label>

                    <label className="field range-field">
                      <span>你的头像大小：{chatUserSize}px</span>
                      <input
                        type="range"
                        min={14}
                        max={56}
                        step={1}
                        value={chatUserSize}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setChatUserSizeNum(n)
                          setChatUserSize(n)
                        }}
                      />
                    </label>

                    <label className="field range-field">
                      <span>字体大小：{chatFontSize}px</span>
                      <input
                        type="range"
                        min={11}
                        max={22}
                        step={0.5}
                        value={chatFontSize}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setChatFontSizeNum(n)
                          setChatFontSize(n)
                        }}
                      />
                    </label>

                    <label className="field range-field">
                      <span>字间距：{chatSpacing}px</span>
                      <input
                        type="range"
                        min={0}
                        max={4}
                        step={0.5}
                        value={chatSpacing}
                        onChange={(e) => {
                          const n = Number(e.target.value)
                          setChatSpacingNum(n)
                          setChatSpacing(n)
                        }}
                      />
                    </label>

                    <p className="appearance-hint">与对话页左下角「⚙ 显示设置」弹窗完全同步，即时生效并自动保存。</p>
                  </div>

                  {/* 开屏动画 */}
                  <div className="appearance-block">
                    <div className="appearance-switch-row">
                      <div className="role-ref-title">开屏动画</div>
                      <label className="switch-wrap">
                        <span
                          className={'switch' + (splashEnabled ? ' on' : '')}
                          onClick={() => {
                            const next = !splashEnabled
                            setSplashEnabled(next)
                            setSplashConfig({ enabled: next, video: next ? splashVideo : '', sound: splashSound })
                          }}
                        >
                          <span className="switch-knob" aria-hidden="true" />
                        </span>
                      </label>
                    </div>
                    <p className="appearance-hint">
                      {splashEnabled
                        ? '开启：每次启动应用全屏播放视频，播完自动进入主界面，点击任意处可跳过。'
                        : '关闭：启动后直接进入主界面。'}
                    </p>
                    {splashEnabled && (
                      <>
                        <div className="appearance-switch-row">
                          <div className="role-ref-title">开屏声音</div>
                          <label className="switch-wrap">
                            <span
                              className={'switch' + (splashSound ? ' on' : '')}
                              onClick={() => {
                                const next = !splashSound
                                setSplashSound(next)
                                setSplashConfig({ enabled: splashEnabled, video: splashVideo, sound: next })
                              }}
                            >
                              <span className="switch-knob" aria-hidden="true" />
                            </span>
                          </label>
                        </div>
                        <div className="appearance-row">
                          <button className="btn-ghost btn-sm" onClick={() => setSplashPicker(true)}>从素材库选择视频</button>
                          <button className="btn-ghost btn-sm" onClick={() => void pickSplashCustom()}>选择文件</button>
                          <button className="btn-ghost btn-sm" onClick={() => void window.shorekeeper.assetsOpenDir()}>打开素材库文件夹</button>
                          {splashVideo && (
                            <button className="btn-ghost btn-sm" onClick={() => { setSplashVideo(''); setSplashConfig({ enabled: true, video: '', sound: splashSound }) }}>清除</button>
                          )}
                        </div>
                        <p className="appearance-hint">
                          {splashVideo ? '当前视频：' + splashVideoName(splashVideo) : '未设置视频。建议 16:9（1920×1080）横屏视频；播放时会全屏铺满，多余部分自动裁切，时长任意（过长可点跳过）。'}
                        </p>
                      </>
                    )}
                  </div>

                  {/* 自定义界面背景 */}
                  <div className="appearance-block">
                    <div className="appearance-switch-row">
                      <div className="role-ref-title">自定义界面背景</div>
                      <label className="switch-wrap">
                        <span
                          className={'switch' + (bgEnabled ? ' on' : '')}
                          onClick={() => {
                            const next = !bgEnabled
                            setBgEnabled(next)
                            pushBg({ enabled: next })
                          }}
                        >
                          <span className="switch-knob" aria-hidden="true" />
                        </span>
                      </label>
                    </div>
                    <p className="appearance-hint">{bgEnabled ? '已启用：自定义背景覆盖默认海面背景，即时生效并自动保存。' : '关闭：使用默认主题背景。'}</p>
                    {bgEnabled && (
                      <>
                        <div className="appearance-row">
                          <span className="appearance-hint" style={{ margin: 0 }}>类型：</span>
                          <button className={'seg-btn' + (bgType === 'image' ? ' on' : '')} onClick={() => { setBgType('image'); pushBg({ type: 'image' }) }}>图片</button>
                          <button className={'seg-btn' + (bgType === 'video' ? ' on' : '')} onClick={() => { setBgType('video'); pushBg({ type: 'video' }) }}>视频</button>
                        </div>
                        <div className="appearance-row">
                          <button className="btn-ghost btn-sm" onClick={() => setBgPicker(true)}>从素材库选择{bgType === 'video' ? '视频' : '图片'}</button>
                          <button className="btn-ghost btn-sm" onClick={() => void pickBgCustom()}>选择文件（不导入素材库）</button>
                          <button className="btn-ghost btn-sm" onClick={() => void window.shorekeeper.assetsOpenDir()}>打开素材库文件夹</button>
                          {bgSource && (
                            <button className="btn-ghost btn-sm" onClick={() => { setBgSource(''); pushBg({ source: '' }) }}>清除</button>
                          )}
                        </div>
                        {bgSource && (
                          <p className="appearance-hint">当前：{splashVideoName(bgSource)}</p>
                        )}
                        <label className="field range-field">
                          <span>遮罩浓度（越高文字越清晰）：{bgVeil}%</span>
                          <input type="range" min={0} max={100} step={1} value={bgVeil} onChange={(e) => { const n = Number(e.target.value); setBgVeil(n); pushBg({ veil: n }) }} />
                        </label>
                        <label className="field range-field">
                          <span>媒体透明度（100=完全显示，0=完全不见）：{bgOpacity}%</span>
                          <input type="range" min={0} max={100} step={1} value={bgOpacity} onChange={(e) => { const n = Number(e.target.value); setBgOpacity(n); pushBg({ opacity: n }) }} />
                        </label>
                        <label className="field range-field">
                          <span>模糊：{bgBlur}px</span>
                          <input type="range" min={0} max={60} step={1} value={bgBlur} onChange={(e) => { const n = Number(e.target.value); setBgBlur(n); pushBg({ blur: n }) }} />
                        </label>
                        <div className="appearance-row">
                          <span className="appearance-hint" style={{ margin: 0 }}>遮罩颜色：</span>
                          <input type="color" value={bgVeilColor} onChange={(e) => { const v = e.target.value; setBgVeilColor(v); pushBg({ veilColor: v }) }} />
                          <span className="appearance-hint" style={{ margin: 0 }}>填充方式：</span>
                          <button className={'seg-btn' + (bgFit === 'cover' ? ' on' : '')} onClick={() => { setBgFit('cover'); pushBg({ fit: 'cover' }) }}>铺满（裁剪）</button>
                          <button className={'seg-btn' + (bgFit === 'contain' ? ' on' : '')} onClick={() => { setBgFit('contain'); pushBg({ fit: 'contain' }) }}>完整显示</button>
                          <button className={'seg-btn' + (bgFit === 'stretch' ? ' on' : '')} onClick={() => { setBgFit('stretch'); pushBg({ fit: 'stretch' }) }}>拉伸</button>
                        </div>
                        <div className="appearance-row">
                          <button className="btn-ghost btn-sm" onClick={() => { resetAppBgConfig(); const d = getAppBgConfig(); setBgEnabled(d.enabled); setBgType(d.type); setBgSource(d.source); setBgOpacity(d.opacity); setBgVeil(d.veil); setBgBlur(d.blur); setBgVeilColor(d.veilColor); setBgFit(d.fit) }}>恢复默认背景</button>
                        </div>
                        <p className="appearance-hint">图片/视频只在本机读取，不会上传。</p>
                      </>
                    )}
                  </div>
              </>
            )}
            {tab === 'voice' && (
              <>
                <div className="settings-section-title">语音合成</div>

                {/* 合成引擎选择 */}
                <label className="field">
                  <span className="field-label">合成引擎</span>
                  <select
                    className="field-input"
                    value={ttsProvider}
                    onChange={(e) => setTtsProvider(e.target.value as 'local' | 'mimo' | 'indextts')}
                  >
                    <option value="local">本地 GPT-SoVITS（免费、离线）</option>
                    <option value="mimo">小米 MiMo（云端、音色丰富）</option>
                    <option value="indextts">IndexTTS 本地克隆（零样本音色克隆）</option>
                  </select>
                </label>

                {/* 每个角色的参考音频：切换角色时自动应用（自定义优先，留空=默认文件） */}
                <div className="role-ref-card">
                  <div className="role-ref-title-row">
                    <div className="role-ref-title">角色参考音频（切换角色自动应用）</div>
                    <label className="switch-wrap">
                      <span
                        className={'switch' + (indexttsUseRoleRef ? ' on' : '')}
                        onClick={() => {
                          const next = !indexttsUseRoleRef
                          setIndexttsUseRoleRef(next)
                          if (next) {
                            // 打开时立即应用当前角色的参考音频
                            const roleRef = getTtsRefForRole(getAgentRole().id)
                            if (roleRef) setIndexttsRefAudio(roleRef)
                          }
                          queueVoiceSave()
                        }}
                      >
                        <span className="switch-knob" aria-hidden="true" />
                      </span>
                    </label>
                  </div>
                  <p className="appearance-hint">
                    {indexttsUseRoleRef
                      ? '开启：切换角色时自动应用对应角色的参考音频。下方按当前全部角色列出，可逐个设置；留空表示使用该角色的默认参考音频。'
                      : '关闭：不使用角色参考音频，改用下方「自定义参考音频」，切换角色不改变它。'}
                  </p>
                  {AGENT_ROLE_LIST.map((ar) => {
                    const rid = ar.id
                    const label = ar.name
                    const avatar = getEffectiveAgentAvatar(rid)
                    return (
                      <div className="tts-row role-ref-row" key={rid}>
                        <span
                          className="role-ref-avatar"
                          style={{ backgroundImage: avatar ? `url(${avatar})` : undefined }}
                          aria-hidden="true"
                        />
                        <span className="role-ref-name">{label}</span>
                        <input
                          className="field-input"
                          value={refByRole[rid] ?? ''}
                          spellCheck={false}
                          disabled={!indexttsUseRoleRef}
                          placeholder={DEFAULT_TTS_REFS[rid]}
                          onChange={(e) =>
                            setRefByRole((m) => ({ ...m, [rid]: e.target.value }))
                          }
                        />
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={!indexttsUseRoleRef}
                          onClick={async () => {
                            const next = await window.shorekeeper.ttsPickRef()
                            if (next?.ttsRefAudio) {
                              setRefByRole((m) => ({ ...m, [rid]: next.ttsRefAudio }))
                              setTtsRefForRole(rid, next.ttsRefAudio)
                              setMsg(`${label} 的参考音频已保存，切换角色时自动应用`)
                            }
                          }}
                        >
                          浏览…
                        </button>
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          disabled={!indexttsUseRoleRef}
                          onClick={() => {
                            setTtsRefForRole(rid, refByRole[rid] ?? '')
                            setMsg(`${label} 的参考音频已保存，切换角色时自动应用`)
                          }}
                        >
                          保存
                        </button>
                      </div>
                    )
                  })}
                </div>

                {ttsProvider === 'mimo' ? (
                  <>
                    <p className="appearance-hint">
                      小米 MiMo 云端 TTS（OpenAI 兼容协议，官方文档
                      mimo.mi.com/docs/zh-CN/api/audio/tts）。需要小米开放平台（platform.xiaomimimo.com）的
                      API Key；TTS 系列当前限时免费。语音在云端合成，不消耗本地 GPT-SoVITS。
                    </p>

                    <label className="field">
                      <span className="field-label">MiMo API Key</span>
                      <div className="tts-row">
                        <input
                          className="field-input"
                          type={mimoKeyVisible ? 'text' : 'password'}
                          value={mimoKeyLocked ? '' : mimoTTSKey}
                          spellCheck={false}
                          placeholder={mimoKeyLocked ? `已配置（${mimoTTSKey || 'sk-****'}），换 Key 请点「更换」` : '粘贴小米 MiMo API Key'}
                          disabled={mimoKeyLocked}
                          onChange={(e) => setMimoTTSKey(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-ghost btn-sm"
                          onClick={() => {
                            if (mimoKeyLocked) {
                              setMimoKeyLocked(false)
                              setMimoTTSKey('')
                            } else {
                              setMimoKeyVisible((v) => !v)
                            }
                          }}
                        >
                          {mimoKeyLocked ? '更换' : mimoKeyVisible ? '隐藏' : '显示'}
                        </button>
                      </div>
                    </label>
                    <p className="appearance-hint">
                      保存后 Key 会隐藏（只显示掩码），但一直保持可用，关窗重开也无需再填。
                    </p>

                    <label className="field">
                      <span className="field-label">模型</span>
                      <select
                        className="field-input"
                        value={mimoTTSModel}
                        onChange={(e) => setMimoTTSModel(e.target.value)}
                      >
                        <option value="mimo-v2.5-tts">mimo-v2.5-tts（预置音色，无需参考音频）</option>
                        <option value="mimo-v2.5-tts-voiceclone">mimo-v2.5-tts-voiceclone（克隆参考音频）</option>
                      </select>
                    </label>

                    {mimoTTSModel === 'mimo-v2.5-tts' ? (
                      <label className="field">
                        <span className="field-label">预置音色</span>
                        <select
                          className="field-input"
                          value={mimoTTSVoice}
                          onChange={(e) => setMimoTTSVoice(e.target.value)}
                        >
                          {[
                            ['mimo_default', '默认音色'],
                            ['冰糖', '冰糖'],
                            ['茉莉', '茉莉'],
                            ['苏打', '苏打'],
                            ['白桦', '白桦'],
                            ['Mia', 'Mia'],
                            ['Chloe', 'Chloe'],
                            ['Milo', 'Milo'],
                            ['Dean', 'Dean']
                          ].map(([id, label]) => (
                            <option key={id} value={id}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <label className="field">
                        <span className="field-label">克隆用的参考音频</span>
                        <div className="tts-row">
                          <input
                            className="field-input"
                            value={ttsRefAudio}
                            spellCheck={false}
                            placeholder="选择一段 3~10 秒、干净的 wav/mp3"
                            onChange={(e) => {
                              setTtsRefAudio(e.target.value)
                              queueVoiceSave()
                            }}
                          />
                          <button type="button" className="btn-ghost btn-sm" onClick={pickRef}>
                            浏览…
                          </button>
                        </div>
                      </label>
                    )}

                    <label className="field">
                      <span className="field-label">语气描述（可选，输入后自动保存）</span>
                      <textarea
                        className="field-input tts-textarea"
                        value={mimoStylePrompt}
                        rows={4}
                        spellCheck={false}
                        placeholder="例如：温柔地说，尾音轻一些；带一点叹息感；情绪更饱满"
                        onChange={(e) => onStylePromptChange(e.target.value)}
                      />
                    </label>
                    <p className="appearance-hint">
                      作为风格指令传给 MiMo：克隆模式与预置音色都生效。留空时，克隆模式不带风格指令，预置音色用默认朗读风格。
                    </p>

                    <label className="field">
                      <span className="field-label">API 地址（一般不用改）</span>
                      <input
                        className="field-input"
                        value={mimoTTSBaseURL}
                        spellCheck={false}
                        placeholder="https://api.xiaomimimo.com/v1"
                        onChange={(e) => setMimoTTSBaseURL(e.target.value)}
                      />
                    </label>
                  </>
                ) : ttsProvider === 'indextts' ? (
                  <>
                    <p className="appearance-hint">
                      IndexTTS 1.5 本地引擎：零样本音色克隆，模型已随项目拷贝（IndexTTSRuntime）。完全离线，首次朗读会加载模型（约
                      1–5 分钟），之后复用常驻进程。参考音频与运行设备来自 D:\shorekeeper-agent 同款配置。
                    </p>

                    <div className={'tts-state' + (indexStatus?.ok ? ' ok' : ' bad')}>
                      {indexStatus?.message ?? '正在检测引擎…'}
                    </div>


                    <label className="field">
                      <span className="field-label">参考音频（决定克隆音色，必填；开关开启时随角色）</span>
                      <div className="tts-row">
                        <input
                          className="field-input"
                          value={indexttsRefAudio}
                          readOnly
                          disabled={indexttsUseRoleRef}
                          spellCheck={false}
                          placeholder="选择 5–15 秒、单人、无背景音乐的 WAV/MP3"
                        />
                        <button type="button" className="btn-ghost btn-sm" onClick={() => void pickIndexRef()} disabled={indexttsUseRoleRef}>
                          选择…
                        </button>
                      </div>
                    </label>
                    <p className="appearance-hint">建议 5–15 秒、单人、无背景音乐的 WAV/MP3；生成音色将模仿它。</p>

                    <label className="field">
                      <span className="field-label">运行设备</span>
                      <select
                        className="field-input"
                        value={indexttsDevice}
                        onChange={(e) => {
                          setIndexttsDevice(e.target.value as 'cuda' | 'cpu')
                          queueVoiceSave()
                        }}
                      >
                        <option value="cuda">NVIDIA GPU（推荐）</option>
                        <option value="cpu">CPU（速度很慢）</option>
                      </select>
                    </label>

                    <div className="field">
                      <span className="field-label">细节调整</span>
                      <label className="field range-field">
                        <span>语速：{indexttsSpeed.toFixed(2)}x</span>
                        <input
                          type="range"
                          min={0.5}
                          max={2}
                          step={0.05}
                          value={indexttsSpeed}
                          onChange={(e) => {
                            setIndexttsSpeed(Number(e.target.value))
                            queueVoiceSave()
                          }}
                        />
                      </label>
                      <label className="field range-field">
                        <span>音调：{indexttsPitch}</span>
                        <input
                          type="range"
                          min={-50}
                          max={50}
                          step={1}
                          value={indexttsPitch}
                          onChange={(e) => {
                            setIndexttsPitch(Number(e.target.value))
                            queueVoiceSave()
                          }}
                        />
                      </label>
                      <label className="field range-field">
                        <span>音量：{indexttsVolume}</span>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={1}
                          value={indexttsVolume}
                          onChange={(e) => {
                            setIndexttsVolume(Number(e.target.value))
                            queueVoiceSave()
                          }}
                        />
                      </label>
                    </div>
                    <p className="appearance-hint">
                      语速、音量在播放时生效；音调参数已保存，引擎 1.5 的合成接口不支持变调，仅作预留。
                      以上调节输入后自动保存，切走或重开设置都不会丢。
                    </p>

                  </>
                ) : (
                  <>
                    <p className="appearance-hint">
                      语音在本机合成，不经过任何云服务，也不消耗对话 token。填 GPT-SoVITS 服务地址即可：支持 WebUI（如
                      http://localhost:9872）与 api_v2（如 http://127.0.0.1:9880），应用会自动识别。
                    </p>

                    <label className="field">
                      <span className="field-label">接口地址</span>
                      <input
                        className="field-input"
                        value={ttsURL}
                        spellCheck={false}
                        placeholder="http://localhost:9872"
                        onChange={(e) => {
                          setTtsURL(e.target.value)
                          queueVoiceSave()
                        }}
                      />
                    </label>
                    <p className="appearance-hint">
                      一般填 WebUI 地址（默认 http://localhost:9872）即可，无需额外启动接口；若单独跑过
                      api_v2（<code>python api_v2.py -a 127.0.0.1 -p 9880</code>）也可填 9880。
                    </p>

                    <label className="field">
                      <span className="field-label">参考音频（决定音色，必填）</span>
                      <div className="tts-row">
                        <input
                          className="field-input"
                          value={ttsRefAudio}
                          spellCheck={false}
                          placeholder="选择一段 3~10 秒、干净的 wav"
                          onChange={(e) => {
                            setTtsRefAudio(e.target.value)
                            queueVoiceSave()
                          }}
                        />
                        <button type="button" className="btn-ghost btn-sm" onClick={pickRef}>
                          浏览…
                        </button>
                      </div>
                    </label>
                    <p className="appearance-hint">
                      GPT-SoVITS 用这段音频的音色来合成；时长 3~10 秒、无背景音乐、单人说话效果最好。
                    </p>

                    <label className="field">
                      <span className="field-label">参考音频对应的文本</span>
                      <textarea
                        className="field-input tts-textarea"
                        value={ttsPromptText}
                        rows={2}
                        spellCheck={false}
                        placeholder="这段音频里念的是什么，就填什么（越准音质越稳）"
                        onChange={(e) => {
                          setTtsPromptText(e.target.value)
                          queueVoiceSave()
                        }}
                      />
                    </label>
                    <p className="appearance-hint">
                      填写音频里实际说的内容能明显提升音质；留空也能合成，但可能不稳定。
                    </p>
                  </>
                )}

                <div className="tts-actions">
                  <button type="button" className="btn-ghost btn-sm" onClick={testVoice} disabled={ttsState === 'busy'}>
                    测试连接
                  </button>
                  <button type="button" className="btn-ghost btn-sm" onClick={previewVoice} disabled={ttsState === 'busy'}>
                    试听一句
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={rePreviewVoice}
                    disabled={ttsState === 'busy'}
                    title="跳过本地缓存，强制重新合成（不用清空整个缓存）"
                  >
                    重新生成
                  </button>
                  <button type="button" className="btn-primary btn-sm" onClick={saveVoice}>
                    保存
                  </button>
                </div>
                {ttsState !== 'idle' && (
                  <p className={'tts-state' + (ttsState === 'ok' ? ' ok' : ttsState === 'busy' ? '' : ' bad')}>
                    {ttsState === 'busy'
                      ? '处理中…'
                      : ttsState === 'ok'
                        ? '成功（已连接）'
                        : ttsState === 'ok-cached'
                          ? '成功（已从本地缓存播放，未重新合成）'
                          : ttsState}
                  </p>
                )}

                <p className="appearance-hint">
                  自动朗读的开关在标题栏的「自动朗读」胶囊上；开启后，每轮回复结束会自动朗读正文
                  （代码块与 Markdown 标记会在朗读前自动去掉，界面显示不受影响）。
                </p>

                <div className="tts-cache-row">
                  <span>
                    语音缓存：{cacheCount} 条 · {fmtBytes(cacheBytes)}（同一句话第二次点朗读秒播）
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={clearCache}
                    disabled={cacheCount === 0}
                  >
                    清空缓存
                  </button>
                </div>
              </>
            )}

            {tab === 'agent' && (
              <>
                <div className="settings-section-title">定时提醒</div>
                <p className="appearance-hint">
                  到点会弹系统通知（进 Windows 操作中心）。这是应用内提醒：守岸人没在运行时不会响——
                  若关闭窗口时选择了「最小化到托盘」，它会继续在后台运行，提醒照常。
                  <br />
                  时间可以直接写：<code>09:30</code>、<code>今晚8点</code>、<code>明早9点</code>、
                  <code>3天后</code>、<code>下周一</code>、<code>30分钟后</code>。
                </p>

                <div className="rem-add">
                  <input
                    className="field-input"
                    value={remText}
                    maxLength={120}
                    placeholder="提醒内容，例如：起来活动一下"
                    onChange={(e) => setRemText(e.target.value)}
                  />
                  <input
                    className="field-input rem-time"
                    value={remTime}
                    maxLength={20}
                    placeholder="今晚8点"
                    onChange={(e) => setRemTime(e.target.value)}
                  />
                  <select
                    className="field-input rem-repeat"
                    value={remRepeat}
                    onChange={(e) => setRemRepeat(e.target.value === 'daily' ? 'daily' : 'once')}
                  >
                    <option value="once">一次</option>
                    <option value="daily">每天</option>
                  </select>
                  <button type="button" className="btn-primary btn-sm" onClick={() => void addReminder()}>
                    添加
                  </button>
                </div>
                {remMsg && <p className="tts-state">{remMsg}</p>}

                {reminders.length === 0 ? (
                  <p className="prof-empty">还没有提醒</p>
                ) : (
                  <ul className="rem-list">
                    {reminders.map((r) => (
                      <li key={r.id} className={'rem-item' + (r.enabled ? '' : ' is-off')}>
                        <label className="prof-check" title={r.enabled ? '点击停用' : '点击启用'}>
                          <input
                            type="checkbox"
                            checked={r.enabled}
                            onChange={(e) => void toggleReminderItem(r.id, e.target.checked)}
                          />
                        </label>
                        <span className="rem-text">{r.text}</span>
                        <span className="rem-when">
                          {r.repeat === 'daily' ? '每天 ' : ''}
                          {new Date(r.at).toLocaleString('zh-CN', {
                            month: 'numeric',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </span>
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          title="删除"
                          onClick={() => void removeReminder(r.id)}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}

            {tab === 'usage' && (
              <>
                <div className="settings-section-title">用量统计</div>
                <p className="appearance-hint">查看本机的模型 Token 用量、请求次数与缓存效率。数据仅保存在本地。</p>

                {!usage ? (
                  <div className="usage-empty">加载中……</div>
                ) : usage.totalCalls === 0 ? (
                  <div className="usage-empty">
                    <div className="usage-empty-ic">▤</div>
                    <p>还没有用量数据</p>
                    <p className="usage-empty-sub">和守岸人聊几句后，这里会显示每次模型调用的 Token 用量与缓存命中情况。</p>
                  </div>
                ) : (
                  <>
                    <div className="usage-cards">
                      <div className="usage-card">
                        <div className="usage-card-label">请求次数</div>
                        <div className="usage-card-num">{usage.totalCalls.toLocaleString()}</div>
                      </div>
                      <div className="usage-card">
                        <div className="usage-card-label">累计输入 Tokens</div>
                        <div className="usage-card-num">{usage.promptTokens.toLocaleString()}</div>
                      </div>
                      <div className="usage-card">
                        <div className="usage-card-label">累计输出 Tokens</div>
                        <div className="usage-card-num">{usage.completionTokens.toLocaleString()}</div>
                      </div>
                      <div className="usage-card">
                        <div className="usage-card-label">累计总量</div>
                        <div className="usage-card-num">{usage.totalTokens.toLocaleString()}</div>
                      </div>
                    </div>

                    <div className="usage-block">
                      <div className="usage-block-title">今日（本地日期）</div>
                      {(() => {
                        const d = new Date()
                        const p2 = (n: number) => String(n).padStart(2, '0')
                        const tk = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate())
                        const td = usage.daily?.[tk]
                        return (
                          <div className="usage-cards">
                            <div className="usage-card">
                              <div className="usage-card-label">今日请求</div>
                              <div className="usage-card-num">{td ? td.calls.toLocaleString() : 0}</div>
                            </div>
                            <div className="usage-card">
                              <div className="usage-card-label">今日输入 Tokens</div>
                              <div className="usage-card-num">{td ? td.promptTokens.toLocaleString() : 0}</div>
                            </div>
                            <div className="usage-card">
                              <div className="usage-card-label">今日输出 Tokens</div>
                              <div className="usage-card-num">{td ? td.completionTokens.toLocaleString() : 0}</div>
                            </div>
                            <div className="usage-card">
                              <div className="usage-card-label">今日总量</div>
                              <div className="usage-card-num">{td ? td.totalTokens.toLocaleString() : 0}</div>
                            </div>
                          </div>
                        )
                      })()}
                    </div>

                    <div className="usage-charts">
                      <div className="usage-chart-card">
                        <div className="usage-chart-head">
                          <span className="usage-chart-title">Token 统计</span>
                          <div className="usage-seg">
                            {(['daily', 'weekly', 'monthly', 'total'] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                className={'usage-seg-btn' + (periodMode === m ? ' on' : '')}
                                onClick={() => setPeriodMode(m)}
                              >
                                {m === 'daily' ? '每日' : m === 'weekly' ? '每周' : m === 'monthly' ? '每月' : '累计'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div ref={periodElRef} className="usage-chart-box" />
                      </div>

                      <div className="usage-chart-card">
                        <div className="usage-chart-head">
                          <span className="usage-chart-title">用量趋势（按模型）</span>
                          <div className="usage-seg">
                            {([7, 30, 90] as const).map((d) => (
                              <button
                                key={d}
                                type="button"
                                className={'usage-seg-btn' + (trendDays === d ? ' on' : '')}
                                onClick={() => setTrendDays(d)}
                              >
                                近{d}天
                              </button>
                            ))}
                          </div>
                        </div>
                        <div ref={trendElRef} className="usage-chart-box" />
                      </div>

                      <div className="usage-chart-card">
                        <div className="usage-chart-head">
                          <span className="usage-chart-title">模型 Token 占比</span>
                        </div>
                        <div ref={shareElRef} className="usage-chart-box usage-chart-box-pie" />
                      </div>
                    </div>

                    <div className="usage-block">
                      <div className="usage-block-title">缓存效率</div>
                      {usage.cacheHitTokens + usage.cacheMissTokens > 0 ? (
                        <>
                          <div className="usage-cache">
                            <div className="usage-cache-num">
                              {Math.round((usage.cacheHitTokens / (usage.cacheHitTokens + usage.cacheMissTokens)) * 100)}%
                            </div>
                            <div className="usage-cache-bar">
                              <div
                                className="usage-cache-fill"
                                style={{
                                  width: `${(usage.cacheHitTokens / (usage.cacheHitTokens + usage.cacheMissTokens)) * 100}%`
                                }}
                              />
                            </div>
                          </div>
                          <div className="usage-cache-detail">
                            命中 {usage.cacheHitTokens.toLocaleString()} · 未命中 {usage.cacheMissTokens.toLocaleString()} tokens
                          </div>
                        </>
                      ) : (
                        <p className="usage-empty-sub">当前接口未返回缓存命中数据（部分服务商不提供 prompt cache 统计）。</p>
                      )}
                    </div>

                    <div className="usage-block">
                      <div className="usage-block-title">按模型</div>
                      <div className="usage-model-list">
                        {Object.entries(usage.byModel)
                          .sort((a, b) => b[1].lastAt - a[1].lastAt)
                          .map(([model, m]) => {
                            const rate =
                              m.cacheHitTokens + m.cacheMissTokens > 0
                                ? `${Math.round((m.cacheHitTokens / (m.cacheHitTokens + m.cacheMissTokens)) * 100)}%`
                                : '—'
                            const last = new Date(m.lastAt)
                            const p2 = (n: number) => String(n).padStart(2, '0')
                            return (
                              <div className="usage-model-row" key={model}>
                                <div className="usage-model-name">{model}</div>
                                <div className="usage-model-meta">
                                  {m.calls} 次请求 · 输入 {m.promptTokens.toLocaleString()} · 输出{' '}
                                  {m.completionTokens.toLocaleString()} · 缓存 {rate} · 最近{' '}
                                  {`${p2(last.getMonth() + 1)}-${p2(last.getDate())} ${p2(last.getHours())}:${p2(last.getMinutes())}`}
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>

                    <div className="usage-actions">
                      <button className="btn-ghost btn-sm" onClick={refreshUsage}>
                        刷新
                      </button>
                      <button className="btn-ghost btn-sm usage-clear" onClick={clearUsage}>
                        清空统计
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
            {tab === 'profile' && (
              <>
                <div className="settings-section-title">用户信息</div>
                <p className="appearance-hint">头像与名称显示在界面左下角用户区；数据仅保存在本机。</p>

                <div className="appearance-block">
                  <div className="appearance-label">用户头像</div>
                  <div className="avatar-editor">
                    <div className="avatar-preview-wrap">
                      {userAvatar ? (
                        <img className="avatar-preview-img" src={userAvatar} alt="用户头像" />
                      ) : (
                        <span className="avatar-preview-empty profile-avatar-d-lg">👤</span>
                      )}
                    </div>
                    <div className="avatar-editor-ops">
                      <button className="btn-ghost btn-sm" onClick={() => userFileRef.current?.click()}>
                        更换头像
                      </button>
                      {userAvatar && (
                        <button className="btn-ghost btn-sm" onClick={() => setUserAvatar('')}>
                          恢复默认
                        </button>
                      )}
                      <input ref={userFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onUserAvatarFile} />
                    </div>
                  </div>
                </div>

                <label className="field">
                  <span>名称</span>
                  <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder={DEFAULT_USER_NAME} maxLength={24} />
                </label>

                <label className="field">
                  <span>签名</span>
                  <textarea
                    className="field-textarea"
                    value={userBio}
                    onChange={(e) => setUserBio(e.target.value)}
                    placeholder="写一句签名，例如：潮汐之间，回声未歇……"
                    rows={3}
                    maxLength={80}
                  />
                </label>

                <div className="usage-actions">
                  <button className="btn-primary btn-sm" onClick={saveUserProfile}>
                    保存
                  </button>
                </div>

                {/* ---------- C1 关于用户的事实 ---------- */}
                <div className="prof-sec">
                  <div className="prof-sec-head">
                    <span className="prof-sec-title">关于你的事实（C1）</span>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() => setUserFacts((v) => [...v, ''])}
                      disabled={userFacts.length >= 20}
                    >
                      ＋ 添加
                    </button>
                  </div>
                  <p className="prof-sec-desc">
                    每条一句，例如「在做守岸人终端项目」。会在对话时提供给守岸人参考；留空则不占任何上下文。
                  </p>
                  {userFacts.length === 0 && <p className="prof-empty">还没有添加任何事实</p>}
                  {userFacts.map((f, i) => (
                    <div className="prof-row" key={i}>
                      <input
                        className="prof-input"
                        value={f}
                        maxLength={80}
                        placeholder="例如：习惯在深夜写代码"
                        onChange={(e) =>
                          setUserFacts((v) => v.map((x, k) => (k === i ? e.target.value : x)))
                        }
                      />
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        title="删除这条"
                        onClick={() => setUserFacts((v) => v.filter((_, k) => k !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* ---------- C4 重要日期 ---------- */}
                <div className="prof-sec">
                  <div className="prof-sec-head">
                    <span className="prof-sec-title">重要日期（C4）</span>
                    <button
                      type="button"
                      className="btn-ghost btn-xs"
                      onClick={() =>
                        setUserDates((v) => [
                          ...v,
                          { id: `d${Date.now().toString(36)}`, label: '', date: '', yearly: true }
                        ])
                      }
                      disabled={userDates.length >= 12}
                    >
                      ＋ 添加
                    </button>
                  </div>
                  <p className="prof-sec-desc">
                    生日、纪念日、截止日等。到期当天或前 7 天，守岸人会在合适的时机自然提一句。
                    日期填 <code>M-D</code>（如 <code>3-14</code>）表示每年重复，或 <code>YYYY-M-D</code> 表示一次性。
                  </p>
                  {userDates.length === 0 && <p className="prof-empty">还没有添加任何日期</p>}
                  {userDates.map((d, i) => (
                    <div className="prof-row" key={d.id}>
                      <input
                        className="prof-input prof-input-sm"
                        value={d.label}
                        maxLength={24}
                        placeholder="名称，如 生日"
                        onChange={(e) =>
                          setUserDates((v) => v.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))
                        }
                      />
                      <input
                        className="prof-input prof-input-date"
                        value={d.date}
                        maxLength={12}
                        placeholder="3-14"
                        onChange={(e) =>
                          setUserDates((v) => v.map((x, k) => (k === i ? { ...x, date: e.target.value } : x)))
                        }
                      />
                      <label className="prof-check" title="每年重复">
                        <input
                          type="checkbox"
                          checked={d.yearly}
                          onChange={(e) =>
                            setUserDates((v) => v.map((x, k) => (k === i ? { ...x, yearly: e.target.checked } : x)))
                          }
                        />
                        每年
                      </label>
                      <button
                        type="button"
                        className="btn-ghost btn-xs"
                        title="删除这个日期"
                        onClick={() => setUserDates((v) => v.filter((_, k) => k !== i))}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>

                {/* ---------- 画像注入开关 ---------- */}
                <label className="prof-toggle">
                  <input
                    type="checkbox"
                    checked={profileEnabled}
                    onChange={(e) => setProfileEnabled(e.target.checked)}
                  />
                  <span>
                    把画像提供给守岸人
                    <em className="prof-toggle-hint">
                      （关掉后上面这些内容都不会进入对话，可省下上下文开销）
                    </em>
                  </span>
                </label>
              </>
            )}
          </div>
        </div>

        {msg && <p className="modal-msg">{msg}</p>}

        <div className="modal-actions">
          <button className="btn-ghost" onClick={onClose}>
            关闭
          </button>
          <button className="btn-primary" onClick={saveCurrentTab} disabled={saving}>
            {saving ? '保存中……' : '保存'}
          </button>
        </div>

        <ToolSettingsModal open={toolOpen} onClose={() => setToolOpen(false)} />
        <AvatarCropModal
          open={userCropOpen}
          image={userCropImage}
          onClose={() => {
            setUserCropOpen(false)
            setUserCropImage(null)
          }}
          onConfirm={onUserCropConfirm}
        />
        <AssetPickerModal
          open={splashPicker}
          kind="video"
          title="素材库 · 选择开屏视频"
          onClose={() => setSplashPicker(false)}
          onPick={(item) => {
            setSplashVideo(item.url)
            setSplashConfig({ enabled: true, video: item.url, sound: splashSound })
            setSplashPicker(false)
          }}
        />
        <AssetPickerModal
          open={bgPicker}
          kind={bgType === 'video' ? 'video' : 'image'}
          title={'素材库 · 选择背景' + (bgType === 'video' ? '视频' : '图片')}
          onClose={() => setBgPicker(false)}
          onPick={(item) => {
            setBgSource(item.url)
            setBgType(item.kind)
            pushBg({ source: item.url, type: item.kind })
            setBgPicker(false)
          }}
        />
      </div>
    </div>
  )
}
