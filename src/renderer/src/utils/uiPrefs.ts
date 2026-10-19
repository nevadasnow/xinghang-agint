/* 界面偏好：主题 + Agent 头像（localStorage 持久化） */

import type { ImportantDate } from '../../../shared/types'

export type ThemeMode = 'sky' | 'dark' | 'light' | 'system' | 'sakura' | 'bamboo' | 'mornye' | 'mita' | 'silverwolf'
export type AvatarShape = 'circle' | 'square'

const THEME_KEY = 'sk-theme'
/** 主题来源：'auto' = 跟随当前 agent 角色默认主题；'manual' = 用户手动选择过主题（优先记忆） */
const THEME_SOURCE_KEY = 'sk-theme-source'
const AVATAR_KEY = 'sk-avatar-custom'
const CHAT_AVATAR_KEY = 'sk-chat-avatar'
const AVATAR_SIZE_KEY = 'sk-avatar-size'
const AVATAR_OFFSET_KEY = 'sk-avatar-offset'
const AVATAR_SHAPE_KEY = 'sk-avatar-shape'

/* ---------- 主题 ---------- */
export function getTheme(): ThemeMode {
  const v = localStorage.getItem(THEME_KEY)
  // 白名单必须与 ThemeMode 的取值完全一致：原先漏了 'sky'，
  // 导致存进 'sky' 时走到默认分支（结果虽然也是 sky，但校验形同虚设，
  // 且以后新增主题时很容易忘记同步这里）
  return v === 'sky' || v === 'dark' || v === 'light' || v === 'system' || v === 'sakura' || v === 'bamboo' || v === 'mornye' || v === 'mita' || v === 'silverwolf'
    ? (v as ThemeMode)
    : 'sky'
}

/**
 * 应用主题：
 * - 'system' 不做独立主题，而是跟随系统深浅，只映射到正式「纯黑 dark」或「纯白 light」
 *   （这样跟随系统深色时用的就是完整的纯黑主题，而不是一套容易漏改的 system 副本变量）
 */
export function resolveTheme(t: ThemeMode): 'dark' | 'light' | ThemeMode {
  if (t !== 'system') return t
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(t: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(t)
}

export function setTheme(t: ThemeMode, opts?: { manual?: boolean }): void {
  localStorage.setItem(THEME_KEY, t)
  // 来源标记：用户手动选了与当前角色默认主题不同的主题 → manual（之后切角色不再跟随）；
  // 用户选的就是当前角色默认主题 → auto（保持"跟随角色"活性，下次切角色照常跟随）；
  // 缺省不改来源（内部调用如启动恢复、跟随角色时保留原状）。
  if (opts) localStorage.setItem(THEME_SOURCE_KEY, opts.manual ? 'manual' : 'auto')
  applyTheme(t)
  // 广播主题变更：标题栏主题切换 chip、设置页等组件据此实时刷新文字
  window.dispatchEvent(new CustomEvent('sk:theme', { detail: t }))
}

/** 主题来源：'auto'（跟随当前角色默认主题）或 'manual'（用户手动选择过主题） */
export type ThemeSource = 'auto' | 'manual'
export function getThemeSource(): ThemeSource {
  return localStorage.getItem(THEME_SOURCE_KEY) === 'manual' ? 'manual' : 'auto'
}

/** 启动时注册：系统深浅变化时，若用户选的是「跟随系统」则实时切换 纯黑/纯白 */
export function initSystemThemeWatch(): void {
  if (!window.matchMedia) return
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (): void => {
    if (getTheme() === 'system') applyTheme('system')
  }
  if (mq.addEventListener) mq.addEventListener('change', onChange)
  else (mq as MediaQueryList).addListener?.(onChange)
}

/* ---------- 对话界面专属头像（自定义只作用于对话消息气泡） ---------- */
export function getChatAvatar(): string {
  return localStorage.getItem(CHAT_AVATAR_KEY) || ''
}

export function setChatAvatar(data: string): void {
  if (data) localStorage.setItem(CHAT_AVATAR_KEY, data)
  else localStorage.removeItem(CHAT_AVATAR_KEY)
}

/* ---------- 对话界面显示偏好（头像大小 / 字号 / 字间距，设置与对话页弹窗共用） ---------- */
const CHAT_AGENT_SIZE_KEY = 'sk-chat-agent-size'
const CHAT_USER_SIZE_KEY = 'sk-chat-user-size'
const CHAT_FONT_KEY = 'sk-chat-font-size'
const CHAT_SPACING_KEY = 'sk-chat-letter-spacing'

function clampNum(v: string | null, def: number, min: number, max: number): number {
  if (v === null || v === '') return def
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

export function getChatAgentSize(): number {
  return clampNum(localStorage.getItem(CHAT_AGENT_SIZE_KEY), 28, 14, 56)
}
export function setChatAgentSize(n: number): void {
  localStorage.setItem(CHAT_AGENT_SIZE_KEY, String(n))
  document.documentElement.style.setProperty('--sk-chat-agent-size', `${n}px`)
}

export function getChatUserSize(): number {
  return clampNum(localStorage.getItem(CHAT_USER_SIZE_KEY), 38, 14, 56)
}
export function setChatUserSize(n: number): void {
  localStorage.setItem(CHAT_USER_SIZE_KEY, String(n))
  document.documentElement.style.setProperty('--sk-chat-user-size', `${n}px`)
}

export function getChatFontSize(): number {
  return clampNum(localStorage.getItem(CHAT_FONT_KEY), 13.5, 11, 22)
}
export function setChatFontSize(n: number): void {
  localStorage.setItem(CHAT_FONT_KEY, String(n))
  document.documentElement.style.setProperty('--sk-chat-font-size', `${n}px`)
}

export function getChatSpacing(): number {
  return clampNum(localStorage.getItem(CHAT_SPACING_KEY), 0, 0, 4)
}
export function setChatSpacing(n: number): void {
  localStorage.setItem(CHAT_SPACING_KEY, String(n))
  document.documentElement.style.setProperty('--sk-chat-letter-spacing', `${n}px`)
}

/** 启动时应用对话显示 CSS 变量 */
export function applyChatStyle(): void {
  document.documentElement.style.setProperty('--sk-chat-agent-size', `${getChatAgentSize()}px`)
  document.documentElement.style.setProperty('--sk-chat-font-size', `${getChatFontSize()}px`)
  document.documentElement.style.setProperty('--sk-chat-letter-spacing', `${getChatSpacing()}px`)
  document.documentElement.style.setProperty('--sk-chat-user-size', `${getChatUserSize()}px`)
}

/* ---------- Agent 头像 ---------- */
export function getCustomAvatar(): string {
  return localStorage.getItem(AVATAR_KEY) || ''
}

export function setCustomAvatar(data: string): void {
  if (data) localStorage.setItem(AVATAR_KEY, data)
  else localStorage.removeItem(AVATAR_KEY)
}

/* ---------- 角色自定义头像（Agent 页设置，每个角色独立，覆盖角色默认头像） ---------- */
const AGENT_AVATAR_PREFIX = 'sk-agent-avatar-'

export function getAgentAvatar(roleId: string): string {
  return localStorage.getItem(AGENT_AVATAR_PREFIX + roleId) || ''
}

export function setAgentAvatar(roleId: string, data: string): void {
  if (data) localStorage.setItem(AGENT_AVATAR_PREFIX + roleId, data)
  else localStorage.removeItem(AGENT_AVATAR_PREFIX + roleId)
  // 对话界面等监听点据此刷新头像
  window.dispatchEvent(new CustomEvent('sk:agent-avatar-changed', { detail: { roleId, has: Boolean(data) } }))
}

/* ---------- 角色自定义背景卡（Agent 页设置，每个角色独立，覆盖首页角色卡背景图） ---------- */
const AGENT_HERO_PREFIX = 'sk-agent-hero-'

export function getAgentHero(roleId: string): string {
  return localStorage.getItem(AGENT_HERO_PREFIX + roleId) || ''
}

export function setAgentHero(roleId: string, data: string): void {
  if (data) localStorage.setItem(AGENT_HERO_PREFIX + roleId, data)
  else localStorage.removeItem(AGENT_HERO_PREFIX + roleId)
  // 首页等监听点据此刷新角色卡背景
  window.dispatchEvent(new CustomEvent('sk:agent-hero-changed', { detail: { roleId, has: Boolean(data) } }))
}

export function getAvatarSize(): number {
  const n = Number(localStorage.getItem(AVATAR_SIZE_KEY))
  return Number.isFinite(n) && n >= 14 && n <= 56 ? n : 28
}

export function setAvatarSize(n: number): void {
  localStorage.setItem(AVATAR_SIZE_KEY, String(n))
}

export function getAvatarOffset(): number {
  const n = Number(localStorage.getItem(AVATAR_OFFSET_KEY))
  return Number.isFinite(n) ? n : 2
}

export function setAvatarOffset(n: number): void {
  localStorage.setItem(AVATAR_OFFSET_KEY, String(n))
  document.documentElement.style.setProperty('--sk-avatar-offset', `${n}px`)
}

export function getAvatarShape(): AvatarShape {
  return localStorage.getItem(AVATAR_SHAPE_KEY) === 'square' ? 'square' : 'circle'
}

export function setAvatarShape(s: AvatarShape): void {
  localStorage.setItem(AVATAR_SHAPE_KEY, s)
  document.documentElement.style.setProperty('--sk-avatar-radius', s === 'square' ? '8px' : '50%')
}

/** 启动时应用头像位置/形状 CSS 变量 */
export function applyAvatarStyle(): void {
  document.documentElement.style.setProperty('--sk-avatar-offset', `${getAvatarOffset()}px`)
  document.documentElement.style.setProperty('--sk-avatar-radius', getAvatarShape() === 'square' ? '8px' : '50%')
}


/* ---------- 当前时段（D2 分时段朗读语气用） ---------- */

/**
 * 与主进程 env.ts 的 partOf 保持同一套边界。
 * 这里刻意只做**时段**不带节日/假期：那些主进程已有权威实现，
 * 在渲染层重复一份只会导致两边不一致。
 */
export function currentDayPart(now: Date = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'latenight'
  if (h < 8) return 'dawn'
  if (h < 11) return 'morning'
  if (h < 13) return 'noon'
  if (h < 17) return 'afternoon'
  if (h < 19) return 'evening'
  if (h < 23) return 'night'
  return 'latenight'
}

/* ---------- 用户信息（左栏左下角用户区 + 设置「用户信息」共用） ---------- */
export interface UserProfile {
  name: string
  bio: string
  /** 自定义头像 dataURL；空串表示使用默认头像 */
  avatar: string
  /** 关于用户的事实，每条一句（C1）；注入 prompt，为空时不占 token */
  facts: string[]
  /** 重要日期（C4）：生日/纪念日/截止日等，到期或 7 天内会在对话中被自然提及 */
  dates: ImportantDate[]
  /** 是否把画像注入对话（关掉就不进 prompt，省 token） */
  profileEnabled: boolean
}

const USER_PROFILE_KEY = 'sk-user-profile'

export const DEFAULT_USER_NAME = '守岸人用户'

/**
 * 内存缓存：getUserProfile 是同步 API（很多调用点同步读），
 * 启动时 loadUserProfileFromMain 从主进程 data.json 读回权威值并填充这里。
 * 写入路径统一走 setUserProfile（内存 + localStorage + 主进程三重）。
 */
let cachedProfile: UserProfile | null = null

function sanitizeProfile(raw: Partial<UserProfile> | null | undefined): UserProfile {
  if (!raw || typeof raw !== 'object') {
    return { name: DEFAULT_USER_NAME, bio: '', avatar: '', facts: [], dates: [], profileEnabled: true }
  }
  const facts = Array.isArray(raw.facts)
    ? raw.facts.map((f) => (typeof f === 'string' ? f.trim() : '')).filter(Boolean).slice(0, 20)
    : []
  const dates: ImportantDate[] = Array.isArray(raw.dates)
    ? raw.dates
        .map((d, i) => ({
          id: typeof d?.id === 'string' && d.id ? d.id : `d${i}`,
          label: typeof d?.label === 'string' ? d.label.trim().slice(0, 24) : '',
          date: typeof d?.date === 'string' ? d.date.trim().slice(0, 12) : '',
          yearly: d?.yearly !== false
        }))
        .filter((d) => d.label && /^\d{1,4}-\d{1,2}(-\d{1,2})?$/.test(d.date))
        .slice(0, 12)
    : []
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : DEFAULT_USER_NAME,
    bio: typeof raw.bio === 'string' ? raw.bio : '',
    avatar: typeof raw.avatar === 'string' ? raw.avatar : '',
    facts,
    dates,
    // 旧数据没有这个字段：默认开启（画像为空时本来就不占 token）
    profileEnabled: raw.profileEnabled !== false
  }
}

export function getUserProfile(): UserProfile {
  if (cachedProfile) return cachedProfile
  try {
    const raw = JSON.parse(localStorage.getItem(USER_PROFILE_KEY) || '{}') as Partial<UserProfile>
    cachedProfile = sanitizeProfile(raw)
  } catch {
    cachedProfile = sanitizeProfile(null)
  }
  return cachedProfile
}

export function setUserProfile(p: UserProfile): void {
  const next = sanitizeProfile(p)
  cachedProfile = next
  localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(next))
  // 权威存储落 data.json（fire-and-forget：失败不阻塞 UI，下次启动从主进程读回）
  window.shorekeeper.saveUserProfile(next).catch(() => undefined)
}

/**
 * 启动时调用：把主进程 data.json 里的权威画像读回渲染层。
 * 若主进程还没有画像（首次迁移），把 localStorage 现有值推上去，保证两处一致。
 */
export async function loadUserProfileFromMain(): Promise<void> {
  try {
    const persisted = await window.shorekeeper.getUserProfile()
    if (persisted) {
      cachedProfile = sanitizeProfile(persisted)
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(cachedProfile))
    } else {
      // 迁移：localStorage 里有就存进主进程；没有就保持默认（用户设置后即生效）
      const local = sanitizeProfile(cachedProfile ?? JSON.parse(localStorage.getItem(USER_PROFILE_KEY) || '{}'))
      cachedProfile = local
      await window.shorekeeper.saveUserProfile(local).catch(() => undefined)
    }
  } catch {
    /* 主进程不可达时保持本地行为，不阻塞启动 */
  }
}

// 启动即触发：preload（contextBridge）先于页面脚本执行，window.shorekeeper 一定可用。
// 幂等操作；App 挂载后即便再调用也只是重复读一次，无副作用。
void loadUserProfileFromMain()

/* ---------- 开屏动画（启动全屏播放；设置·外观可开关并自定义视频） ---------- */
const SPLASH_KEY = 'sk-splash'

export interface SplashConfig {
  enabled: boolean
  /** skmedia:// 视频地址（素材库或自定义媒体） */
  video: string
  /** 是否带声音播放（默认静音，与旧数据兼容） */
  sound: boolean
}

const DEFAULT_SPLASH: SplashConfig = { enabled: false, video: '', sound: false }

export function getSplashConfig(): SplashConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(SPLASH_KEY) || '{}')
    return {
      enabled: raw?.enabled === true,
      video: typeof raw?.video === 'string' ? raw.video : '',
      sound: raw?.sound === true
    }
  } catch {
    return { ...DEFAULT_SPLASH }
  }
}

export function setSplashConfig(c: SplashConfig): void {
  const next = { enabled: c?.enabled === true, video: typeof c?.video === 'string' ? c.video : '', sound: c?.sound === true }
  localStorage.setItem(SPLASH_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('sk:splash-changed', { detail: next }))
}

/* ---------- 自定义界面背景（全局图片/视频背景 + 美化调整，设置·外观） ---------- */
const APP_BG_KEY = 'sk-app-bg'

export type AppBgFit = 'cover' | 'contain' | 'stretch'

export interface AppBgConfig {
  enabled: boolean
  type: 'image' | 'video'
  source: string
  /** 媒体透明度：100=完全显示，0=完全不见 */
  opacity: number
  /** 遮罩浓度：越高文字越清晰 */
  veil: number
  /** 模糊（px） */
  blur: number
  /** 遮罩颜色（hex） */
  veilColor: string
  /** 填充方式：铺满(裁剪) / 完整显示 / 拉伸 */
  fit: AppBgFit
}

const DEFAULT_BG: AppBgConfig = {
  enabled: false,
  type: 'image',
  source: '',
  opacity: 100,
  veil: 30,
  blur: 0,
  veilColor: '#000000',
  fit: 'cover'
}

export function getAppBgConfig(): AppBgConfig {
  try {
    const raw = JSON.parse(localStorage.getItem(APP_BG_KEY) || '{}')
    return {
      enabled: raw?.enabled === true,
      type: raw?.type === 'video' ? 'video' : 'image',
      source: typeof raw?.source === 'string' ? raw.source : '',
      opacity: Number.isFinite(Number(raw?.opacity)) ? Math.min(100, Math.max(0, Number(raw.opacity))) : DEFAULT_BG.opacity,
      veil: Number.isFinite(Number(raw?.veil)) ? Math.min(100, Math.max(0, Number(raw.veil))) : DEFAULT_BG.veil,
      blur: Number.isFinite(Number(raw?.blur)) ? Math.min(60, Math.max(0, Number(raw.blur))) : DEFAULT_BG.blur,
      veilColor: typeof raw?.veilColor === 'string' && raw.veilColor ? raw.veilColor : DEFAULT_BG.veilColor,
      fit: raw?.fit === 'contain' || raw?.fit === 'stretch' ? raw.fit : 'cover'
    }
  } catch {
    return { ...DEFAULT_BG }
  }
}

export function setAppBgConfig(c: AppBgConfig): void {
  localStorage.setItem(APP_BG_KEY, JSON.stringify(c))
  window.dispatchEvent(new CustomEvent('sk:app-bg-changed', { detail: c }))
}

export function resetAppBgConfig(): void {
  localStorage.removeItem(APP_BG_KEY)
  window.dispatchEvent(new CustomEvent('sk:app-bg-changed', { detail: getAppBgConfig() }))
}

