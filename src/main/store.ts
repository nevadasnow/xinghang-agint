import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Group, LlmConfig, ModelProfile, PersistedUserProfile, Project, Session, TaskItem } from '../shared/types'
import { matchVendorByBaseURL } from './vendors'
import { ttsCacheDeleteText } from './tts'
import { indexttsCacheDeleteText } from './indextts'

/* ============================================================
   API Key 保护（两层）
     1) 存储：safeStorage.encryptString 走操作系统密钥（DPAPI / Keychain），
        磁盘上只留 `enc:<base64>`，不再是明文。
     2) 回传：交给渲染层的一律是掩码（sk-****abcd），明文只在主进程内存里。
   兼容：读盘时 `enc:` 前缀解密；旧的无前缀明文照常可用，下次保存自动升级为加密。
   ============================================================ */

/** safeStorage 是否可用（Linux 无 keyring 时可能不可用，此时退化为明文） */
function canEncrypt(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

/** 磁盘值 -> 明文（内存态） */
function decodeSecret(raw: string): string {
  const v = (raw ?? '').trim()
  if (!v) return ''
  if (!v.startsWith('enc:')) return v // 旧明文，兼容
  if (!canEncrypt()) return '' // 换机器/无 keyring：解不开就当未配置，不崩
  try {
    return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
  } catch {
    return ''
  }
}

/** 明文 -> 磁盘值（可用时加密） */
function encodeSecret(plain: string): string {
  const v = (plain ?? '').trim()
  if (!v) return ''
  if (v.startsWith('enc:')) return v // 已经是密文，别二次加密
  if (!canEncrypt()) return v // 退化：仍是明文，但不丢功能
  try {
    return 'enc:' + safeStorage.encryptString(v).toString('base64')
  } catch {
    return v
  }
}

/** 给渲染层看的掩码：保留前 3 后 4，中间打码；过短则整体打码 */
export function maskSecret(plain: string): string {
  const v = (plain ?? '').trim()
  if (!v) return ''
  if (v.length <= 8) return '****'
  return `${v.slice(0, 3)}****${v.slice(-4)}`
}

/** 判断渲染层回传的是不是掩码（掩码不是真 Key，不能覆盖已存的值） */
export function isMasked(value: string): boolean {
  const v = (value ?? '').trim()
  if (!v) return false
  return v === '****' || /^.{1,6}\*{4}.{0,6}$/.test(v)
}

interface DataFile {
  sessions: Session[]
  /** 项目与分组：与会话同文件持久化，缺省为空数组（旧数据自动兼容） */
  projects?: Project[]
  groups?: Group[]
  /** 用户画像（name/bio/avatar/facts/dates）的权威存储：渲染层 localStorage 只作缓存 */
  userProfile?: PersistedUserProfile
  /** 任务（任务页 + Agent 工具共用，权威存储与会话同文件） */
  tasks?: TaskItem[]
}

/** schema 5：新增 trayEnabled / autoLaunch / globalShortcut（F4/F5/F8） */
export const CONFIG_SCHEMA_VERSION = 5

export const DEFAULT_CONFIG: LlmConfig = {
  baseURL: '',
  apiKey: '',
  model: '',
  provider: '',
  displayName: '',
  profiles: [],
  defaultProfileId: '',
  timeoutSec: 120,
  maxRetries: 3,
  contextWindowTokens: 131072,
  toolModeOverrides: {},
  chatToolsEnabled: false,
  skillModeOverrides: {},
  autoRead: false,
  agentRole: 'shorekeeper',
  ttsURL: 'http://127.0.0.1:9880',
  ttsRefAudio: '',
  ttsPromptText: '',
  ttsProvider: 'local',
  mimoTTSKey: '',
  mimoTTSModel: 'mimo-v2.5-tts',
  mimoTTSVoice: 'mimo_default',
  mimoTTSBaseURL: 'https://api.xiaomimimo.com/v1',
  mimoStylePrompt: "请模仿《鸣潮》守岸人（Shorekeeper）的声音来朗读：女性，音色清冷空灵、通透轻盈，带有自然的气声和呼吸感；语速偏慢、平稳从容，句尾轻柔上扬；情绪温柔平静，带着淡淡的疏离与神性，像海边夜色中的潮汐低语；不要厚重、不要夸张、不要戏剧化。",
  indexttsRefAudio: '',
  indexttsUseRoleRef: true,
  indexttsDevice: 'cuda',
  indexttsSpeed: 1.0,
  indexttsPitch: 0,
  indexttsVolume: 100,
  indexttsSTTEnabled: false,
  indexttsSTTModelDir: '',
  trayEnabled: true,
  closeBehavior: 'ask',
  skipCloseConfirm: false,
  confirmDangerousTools: true,
  autoLaunch: false,
  globalShortcutEnabled: true,
  globalShortcut: 'CommandOrControl+Shift+S',
  schemaVersion: CONFIG_SCHEMA_VERSION
}

function userDataDir(): string {
  return app.getPath('userData')
}

function dataFilePath(): string {
  return join(userDataDir(), 'data.json')
}

function configFilePath(): string {
  return join(userDataDir(), 'config.json')
}

function ensureFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) {
    mkdirSync(userDataDir(), { recursive: true })
    writeFileSync(path, JSON.stringify(fallback, null, 2), 'utf-8')
    return fallback
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return fallback
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(userDataDir(), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2), 'utf-8')
}

/** 归一化配置文件：补默认值、迁移旧结构（单配置 → profiles），并做 schemaVersion 迁移 */
export function normalizeConfig(raw: Partial<LlmConfig> | undefined | null): LlmConfig {
  const src = raw ?? {}
  const baseURL = typeof src.baseURL === 'string' ? src.baseURL.trim() : DEFAULT_CONFIG.baseURL
  const apiKey = typeof src.apiKey === 'string' ? src.apiKey.trim() : DEFAULT_CONFIG.apiKey
  const model = typeof src.model === 'string' ? src.model.trim() : DEFAULT_CONFIG.model
  const provider =
    typeof src.provider === 'string' && src.provider.trim()
      ? src.provider.trim()
      : (matchVendorByBaseURL(src.baseURL ?? '')?.name ?? '')

  // 迁移旧配置：旧版没有 profiles，把顶层配置提升为一个档案（参照 Shorekeeper normalizeModelSettings 的 legacy 迁移）
  let profiles: ModelProfile[] = Array.isArray(src.profiles) ? src.profiles : []
  let defaultProfileId = typeof src.defaultProfileId === 'string' ? src.defaultProfileId : ''
  if (profiles.length === 0 && (apiKey || model)) {
    const id = `profile-${Date.now().toString(36)}`
    profiles = [
      {
        id,
        name: typeof src.displayName === 'string' && src.displayName.trim() ? src.displayName.trim() : model || '默认配置',
        provider,
        baseURL,
        apiKey,
        model,
        createdAt: Date.now()
      }
    ]
    if (!defaultProfileId) defaultProfileId = id
  }
  if (!defaultProfileId && profiles.length > 0) defaultProfileId = profiles[0].id

  // 超时 / 重试 / 上下文窗口：数值校验（参照 Shorekeeper 的 clamp 逻辑）
  const timeoutSec =
    typeof src.timeoutSec === 'number' && Number.isFinite(src.timeoutSec)
      ? Math.max(30, Math.min(1800, Math.round(src.timeoutSec)))
      : DEFAULT_CONFIG.timeoutSec
  const maxRetries =
    typeof src.maxRetries === 'number' && Number.isFinite(src.maxRetries)
      ? Math.max(0, Math.min(10, Math.round(src.maxRetries)))
      : DEFAULT_CONFIG.maxRetries
  const contextWindowTokens =
    typeof src.contextWindowTokens === 'number' && Number.isFinite(src.contextWindowTokens) && src.contextWindowTokens > 0
      ? Math.round(src.contextWindowTokens)
      : DEFAULT_CONFIG.contextWindowTokens

  // 工具/技能按模式开关（参照 Shorekeeper normalizeGeneralSettings 的 toolModeOverrides/chatToolsEnabled）
  const toolModeOverrides: Record<string, Record<string, boolean>> = {}
  if (src.toolModeOverrides && typeof src.toolModeOverrides === 'object') {
    for (const [toolId, modes] of Object.entries(src.toolModeOverrides)) {
      if (modes && typeof modes === 'object') {
        const clean: Record<string, boolean> = {}
        for (const [m, v] of Object.entries(modes)) {
          if (['chat', 'code', 'work', 'learn'].includes(m)) clean[m] = Boolean(v)
        }
        if (Object.keys(clean).length > 0) toolModeOverrides[toolId] = clean
      }
    }
  }
  const skillModeOverrides: Record<string, Record<string, boolean>> = {}
  if (src.skillModeOverrides && typeof src.skillModeOverrides === 'object') {
    for (const [skillId, modes] of Object.entries(src.skillModeOverrides)) {
      if (modes && typeof modes === 'object') {
        const clean: Record<string, boolean> = {}
        for (const [m, v] of Object.entries(modes)) {
          if (['chat', 'code', 'work', 'learn'].includes(m)) clean[m] = Boolean(v)
        }
        if (Object.keys(clean).length > 0) skillModeOverrides[skillId] = clean
      }
    }
  }

  return {
    baseURL,
    apiKey,
    model,
    provider,
    displayName: typeof src.displayName === 'string' ? src.displayName : '',
    profiles,
    defaultProfileId,
    timeoutSec,
    maxRetries,
    contextWindowTokens,
    toolModeOverrides,
    chatToolsEnabled: Boolean(src.chatToolsEnabled),
    skillModeOverrides,
    autoRead: Boolean(src.autoRead),
    agentRole: src.agentRole === 'mornye' ? 'mornye' : src.agentRole === 'kindmita' ? 'kindmita' : src.agentRole === 'silverwolf' ? 'silverwolf' : 'shorekeeper',
    ttsURL:
      typeof src.ttsURL === 'string' && src.ttsURL.trim() ? src.ttsURL.trim() : DEFAULT_CONFIG.ttsURL,
    ttsRefAudio: typeof src.ttsRefAudio === 'string' ? src.ttsRefAudio.trim() : '',
    ttsPromptText: typeof src.ttsPromptText === 'string' ? src.ttsPromptText.trim() : '',
    ttsProvider: src.ttsProvider === 'mimo' || src.ttsProvider === 'indextts' ? src.ttsProvider : 'local',
    mimoTTSKey: typeof src.mimoTTSKey === 'string' ? src.mimoTTSKey.trim() : '',
    mimoTTSModel:
      typeof src.mimoTTSModel === 'string' && src.mimoTTSModel.trim()
        ? src.mimoTTSModel.trim()
        : DEFAULT_CONFIG.mimoTTSModel,
    mimoTTSVoice:
      typeof src.mimoTTSVoice === 'string' && src.mimoTTSVoice.trim()
        ? src.mimoTTSVoice.trim()
        : DEFAULT_CONFIG.mimoTTSVoice,
    mimoTTSBaseURL:
      typeof src.mimoTTSBaseURL === 'string' && src.mimoTTSBaseURL.trim()
        ? src.mimoTTSBaseURL.trim()
        : DEFAULT_CONFIG.mimoTTSBaseURL,
    mimoStylePrompt: typeof src.mimoStylePrompt === 'string' ? src.mimoStylePrompt.trim() : '',
    indexttsRefAudio: typeof src.indexttsRefAudio === 'string' ? src.indexttsRefAudio.trim() : '',
    indexttsUseRoleRef: src.indexttsUseRoleRef !== false,
    indexttsDevice: src.indexttsDevice === 'cpu' ? 'cpu' : 'cuda',
    indexttsSpeed:
      typeof src.indexttsSpeed === 'number' && src.indexttsSpeed >= 0.5 && src.indexttsSpeed <= 2
        ? src.indexttsSpeed
        : DEFAULT_CONFIG.indexttsSpeed,
    indexttsPitch: typeof src.indexttsPitch === 'number' ? src.indexttsPitch : 0,
    indexttsVolume: typeof src.indexttsVolume === 'number' ? src.indexttsVolume : 100,
    indexttsSTTEnabled: Boolean(src.indexttsSTTEnabled),
    indexttsSTTModelDir: typeof src.indexttsSTTModelDir === 'string' ? src.indexttsSTTModelDir.trim() : '',
    trayEnabled: src.trayEnabled !== false,
    closeBehavior: src.closeBehavior === 'tray' || src.closeBehavior === 'quit' ? src.closeBehavior : 'ask',
    skipCloseConfirm: Boolean(src.skipCloseConfirm),
    confirmDangerousTools: src.confirmDangerousTools !== false,
    autoLaunch: Boolean(src.autoLaunch),
    globalShortcutEnabled: src.globalShortcutEnabled !== false,
    globalShortcut:
      typeof src.globalShortcut === 'string' && src.globalShortcut.trim()
        ? src.globalShortcut.trim()
        : DEFAULT_CONFIG.globalShortcut,
    schemaVersion: CONFIG_SCHEMA_VERSION
  }
}

/** 会话归一化：补 projectId/groupId，兼容没有这两个字段的旧数据 */
function normalizeSession(raw: Session): Session {
  return {
    ...raw,
    projectId: typeof raw.projectId === 'string' && raw.projectId ? raw.projectId : undefined,
    groupId: typeof raw.groupId === 'string' && raw.groupId ? raw.groupId : undefined
  }
}

export function listSessions(): Session[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const raw = Array.isArray(data.sessions) ? data.sessions : []
  // 惰性迁移：历史消息补时间戳（以会话创建时间为基准，每条消息 +1 分钟），
  // 让旧对话也能显示发送时间；已有 createdAt 的消息不动。
  let dirty = false
  const sessions = raw.map((s) => {
    const msgs = Array.isArray(s.messages) ? s.messages : []
    if (msgs.some((m) => !m.createdAt)) {
      let t = typeof s.createdAt === 'number' ? s.createdAt : Date.now()
      const next = msgs.map((m) => {
        if (m.createdAt) return m
        dirty = true
        const c = t
        t += 60_000
        return { ...m, createdAt: c }
      })
      return { ...s, messages: next }
    }
    return s
  })
  if (dirty) {
    data.sessions = sessions
    writeJson(dataFilePath(), data)
  }
  return sessions.map(normalizeSession)
}

// ---------- 项目与分组 ----------

export function listProjects(): Project[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  return Array.isArray(data.projects) ? data.projects : []
}

/** 分组归一化：补 color / pinned 默认值，兼容旧数据 */
function normalizeGroup(raw: Group): Group {
  return {
    ...raw,
    color: typeof raw.color === 'string' && raw.color ? raw.color : undefined,
    pinned: Boolean(raw.pinned)
  }
}

export function listGroups(): Group[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  return Array.isArray(data.groups) ? data.groups.map(normalizeGroup) : []
}

export function saveProject(project: Project): Project[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = Array.isArray(data.projects) ? [...data.projects] : []
  const i = list.findIndex((p) => p.id === project.id)
  if (i >= 0) list[i] = project
  else list.push(project)
  data.projects = list
  writeJson(dataFilePath(), data)
  return list
}

export function saveGroup(group: Group): Group[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = Array.isArray(data.groups) ? [...data.groups] : []
  const i = list.findIndex((g) => g.id === group.id)
  if (i >= 0) list[i] = group
  else list.push(group)
  data.groups = list
  writeJson(dataFilePath(), data)
  return list
}

/** 重命名分组（按 id 覆盖 name，会话关联不变） */
export function renameGroup(id: string, name: string): Group[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.groups = (Array.isArray(data.groups) ? data.groups : []).map((g) =>
    g.id === id ? { ...g, name } : g
  )
  writeJson(dataFilePath(), data)
  return data.groups
}

/** 分组通用补丁：name / color / pinned（参照 Cyrene applyDraft 的局部更新语义） */
export function patchGroup(id: string, patch: Partial<Pick<Group, 'name' | 'color' | 'pinned'>>): Group[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.groups = (Array.isArray(data.groups) ? data.groups : []).map((g) =>
    g.id === id ? { ...g, ...patch } : g
  )
  writeJson(dataFilePath(), data)
  return data.groups
}

/** 重排分组顺序（ids 为完整顺序；置顶分组由渲染层负责放到最前） */
export function reorderGroups(ids: string[]): Group[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const byId = new Map((Array.isArray(data.groups) ? data.groups : []).map((g) => [g.id, g]))
  const next: Group[] = []
  for (const id of ids) {
    const g = byId.get(id)
    if (g) {
      next.push(g)
      byId.delete(id)
    }
  }
  for (const g of byId.values()) next.push(g)
  data.groups = next
  writeJson(dataFilePath(), data)
  return next
}

export function deleteProject(id: string): { projects: Project[]; sessions: Session[] } {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.projects = (Array.isArray(data.projects) ? data.projects : []).filter((p) => p.id !== id)
  // 归入该项目的会话退回「未分类」，不连坐删除
  data.sessions = (Array.isArray(data.sessions) ? data.sessions : []).map((x) =>
    x.projectId === id ? { ...x, projectId: undefined } : x
  )
  writeJson(dataFilePath(), data)
  return { projects: data.projects, sessions: data.sessions }
}

export function deleteGroup(id: string): { groups: Group[]; sessions: Session[] } {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.groups = (Array.isArray(data.groups) ? data.groups : []).filter((g) => g.id !== id)
  data.sessions = (Array.isArray(data.sessions) ? data.sessions : []).map((x) =>
    x.groupId === id ? { ...x, groupId: undefined } : x
  )
  writeJson(dataFilePath(), data)
  return { groups: data.groups, sessions: data.sessions }
}

/** 会话通用补丁：置顶 / 项目 / 分组 */
export function patchSession(
  id: string,
  patch: { pinned?: boolean; projectId?: string; groupId?: string }
): Session[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.sessions = (Array.isArray(data.sessions) ? data.sessions : []).map((x) =>
    x.id === id ? { ...x, ...patch } : x
  )
  writeJson(dataFilePath(), data)
  return data.sessions
}

/** 把会话移动到指定项目/分组（传 undefined 表示移出） */
export function assignSession(
  sessionId: string,
  patch: { projectId?: string; groupId?: string }
): Session[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.sessions = (Array.isArray(data.sessions) ? data.sessions : []).map((x) =>
    x.id === sessionId ? { ...x, ...patch } : x
  )
  writeJson(dataFilePath(), data)
  return data.sessions
}

// ---------- 用户画像（权威存储，重启不丢） ----------

/** 画像归一化：补缺失字段默认值，兼容旧数据 */
function normalizePersistedProfile(raw: Partial<PersistedUserProfile> | undefined): PersistedUserProfile | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const facts = Array.isArray(raw.facts)
    ? raw.facts.map((f) => (typeof f === 'string' ? f.trim() : '')).filter(Boolean).slice(0, 20)
    : []
  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    bio: typeof raw.bio === 'string' ? raw.bio : '',
    avatar: typeof raw.avatar === 'string' ? raw.avatar : '',
    facts,
    dates: Array.isArray(raw.dates) ? raw.dates : [],
    profileEnabled: raw.profileEnabled !== false
  }
}

export function getPersistedUserProfile(): PersistedUserProfile | undefined {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  return normalizePersistedProfile(data.userProfile)
}

export function savePersistedUserProfile(profile: PersistedUserProfile): PersistedUserProfile {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const next = normalizePersistedProfile(profile) ?? {
    name: '',
    bio: '',
    avatar: '',
    facts: [],
    dates: [],
    profileEnabled: true
  }
  data.userProfile = next
  writeJson(dataFilePath(), data)
  return next
}

// ---------- 任务（任务页 + Agent 工具共用） ----------

const TASK_PRIORITIES = new Set(['high', 'medium', 'low'])
const TASK_STATUSES = new Set(['active', 'done', 'cancelled'])

/** 任务归一化：过滤非法条目，兼容旧/手改数据 */
function normalizeTask(raw: unknown): TaskItem | undefined {
  const t = raw as Partial<TaskItem>
  if (!t || typeof t !== 'object' || typeof t.id !== 'string' || typeof t.title !== 'string') return undefined
  const title = t.title.trim().slice(0, 120)
  if (!title) return undefined
  return {
    id: t.id,
    title,
    note: typeof t.note === 'string' ? t.note.trim().slice(0, 500) : undefined,
    priority: TASK_PRIORITIES.has(t.priority ?? '') ? (t.priority as TaskItem['priority']) : 'medium',
    status: TASK_STATUSES.has(t.status ?? '') ? (t.status as TaskItem['status']) : 'active',
    dueAt: typeof t.dueAt === 'number' && Number.isFinite(t.dueAt) && t.dueAt > 0 ? t.dueAt : undefined,
    tag: typeof t.tag === 'string' && t.tag.trim() ? t.tag.trim().slice(0, 24) : undefined,
    source: t.source === 'agent' ? 'agent' : 'manual',
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
    updatedAt: typeof t.updatedAt === 'number' ? t.updatedAt : Date.now(),
    completedAt: typeof t.completedAt === 'number' ? t.completedAt : undefined,
    // 拖拽排序位置：没这个字段的任务（旧数据 / 新建）保持 undefined，
    // 由前端回落到默认排序，不会因为"缺字段"被当成 0 跑到最前面。
    sortOrder: typeof t.sortOrder === 'number' && Number.isFinite(t.sortOrder) ? t.sortOrder : undefined
  }
}

export function listTasks(): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  return (Array.isArray(data.tasks) ? data.tasks : [])
    .map(normalizeTask)
    .filter((t): t is TaskItem => Boolean(t))
}

export function saveTask(input: Partial<TaskItem> & { title: string }): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter((t): t is TaskItem => Boolean(t))
  const now = Date.now()
  const id = input.id || `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const i = list.findIndex((t) => t.id === id)
  const base: TaskItem = i >= 0 ? list[i] : { id, title: '', priority: 'medium', status: 'active', source: 'manual', createdAt: now, updatedAt: now }
  const next: TaskItem = {
    ...base,
    ...input,
    id,
    title: String(input.title ?? base.title).trim().slice(0, 120) || base.title,
    note: typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 500) : undefined,
    priority: TASK_PRIORITIES.has(input.priority ?? '') ? (input.priority as TaskItem['priority']) : base.priority,
    status: TASK_STATUSES.has(input.status ?? '') ? (input.status as TaskItem['status']) : base.status,
    dueAt: typeof input.dueAt === 'number' && Number.isFinite(input.dueAt) && input.dueAt > 0 ? input.dueAt : undefined,
    tag: typeof input.tag === 'string' && input.tag.trim() ? input.tag.trim().slice(0, 24) : undefined,
    source: input.source === 'agent' ? 'agent' : base.source,
    updatedAt: now,
    completedAt: nextStatus(input.status, base.status) === 'done' ? (base.completedAt ?? now) : undefined
  }
  if (i >= 0) list[i] = next
  else list.unshift(next)
  data.tasks = list
  writeJson(dataFilePath(), data)
  return list
}

function nextStatus(input: TaskItem['status'] | undefined, base: TaskItem['status']): TaskItem['status'] {
  if (TASK_STATUSES.has(input ?? '')) return input as TaskItem['status']
  return base
}

/** 局部更新：标题 / 备注 / 优先级 / 状态 / 截止 / 标签；status 切到 done 时记录完成时间 */
export function patchTask(id: string, patch: Partial<Pick<TaskItem, 'title' | 'note' | 'priority' | 'status' | 'dueAt' | 'tag'>>): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter((t): t is TaskItem => Boolean(t))
  const now = Date.now()
  const i = list.findIndex((t) => t.id === id)
  if (i < 0) return list
  const cur = list[i]
  const status = TASK_STATUSES.has(patch.status ?? '') ? (patch.status as TaskItem['status']) : cur.status
  list[i] = {
    ...cur,
    title: typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim().slice(0, 120) : cur.title,
    note: typeof patch.note === 'string' ? (patch.note.trim() ? patch.note.trim().slice(0, 500) : undefined) : cur.note,
    priority: TASK_PRIORITIES.has(patch.priority ?? '') ? (patch.priority as TaskItem['priority']) : cur.priority,
    status,
    dueAt: typeof patch.dueAt === 'number' && Number.isFinite(patch.dueAt) && patch.dueAt > 0 ? patch.dueAt : cur.dueAt,
    tag: typeof patch.tag === 'string' ? (patch.tag.trim() ? patch.tag.trim().slice(0, 24) : undefined) : cur.tag,
    updatedAt: now,
    completedAt: status === 'done' ? (cur.completedAt ?? now) : undefined
  }
  data.tasks = list
  writeJson(dataFilePath(), data)
  return list
}

export function deleteTask(id: string): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter((t): t is TaskItem => Boolean(t))
  data.tasks = list.filter((t) => t.id !== id)
  writeJson(dataFilePath(), data)
  return data.tasks
}

/**
 * 批量操作任务（批量完成 / 删除 / 取消 / 恢复 / 改优先级）。
 *
 * 为什么做成一次 IPC 而不是循环调用 patchTask：
 *   每条 patchTask 都会 readJson + writeJson 一次，10 条任务就是 20 次磁盘往返；
 *   批量走一次读写，行为和"逐个操作"完全一致但快得多，也不会出现"改到一半"的中间态。
 */
export function bulkTasks(
  ids: string[],
  action: 'done' | 'active' | 'cancelled' | 'delete',
  priority?: TaskItem['priority']
): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  let list = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter((t): t is TaskItem => Boolean(t))
  const idSet = new Set(ids.filter((x) => typeof x === 'string' && x))
  if (idSet.size === 0) return list

  if (action === 'delete') {
    list = list.filter((t) => !idSet.has(t.id))
  } else {
    const now = Date.now()
    list = list.map((t) => {
      if (!idSet.has(t.id)) return t
      const next: TaskItem = {
        ...t,
        status: action,
        updatedAt: now,
        // 完成时记录完成时间；从完成态移出时清掉，避免"已完成时间"残留
        completedAt: action === 'done' ? (t.completedAt ?? now) : undefined
      }
      if (priority && TASK_PRIORITIES.has(priority)) next.priority = priority
      return next
    })
  }
  data.tasks = list
  writeJson(dataFilePath(), data)
  return list
}

/**
 * 清理所有已完成任务。
 *
 * 只删 `status === 'done'` 的；**已取消的保留** —— 「取消」往往是用户
 * 有意留下的记录（这事不做了但我记得），而「完成」是已结清的，可以清。
 */
export function clearCompletedTasks(): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter((t): t is TaskItem => Boolean(t))
  data.tasks = list.filter((t) => t.status !== 'done')
  writeJson(dataFilePath(), data)
  return data.tasks
}

/**
 * 按给定顺序重排任务（拖拽排序）。
 *
 * `orderedIds` 里出现的任务按数组下标写入 sortOrder，未出现的保持原值，
 * 这样"只拖了可见的几个"不会把筛选外的任务顺序打乱。
 */
export function reorderTasks(orderedIds: string[]): TaskItem[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const list = (Array.isArray(data.tasks) ? data.tasks : []).map(normalizeTask).filter((t): t is TaskItem => Boolean(t))
  const pos = new Map<string, number>()
  orderedIds.forEach((id, i) => {
    if (typeof id === 'string' && id) pos.set(id, i)
  })
  if (pos.size === 0) return list
  data.tasks = list.map((t) => (pos.has(t.id) ? { ...t, sortOrder: pos.get(t.id) } : t))
  writeJson(dataFilePath(), data)
  return data.tasks
}

export function saveSession(session: Session): Session[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const idx = data.sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) {
    // 归类字段（projectId / groupId / pinned）以磁盘为准：
    // 渲染层保存会话时只带内容字段（title / mode / messages / 时间戳），
    // 整体覆盖会把「已归入项目 / 分组」的会话踢回未分组。移动归属走
    // assignSession / patchSession，不经过这里，所以此处永远保留磁盘归类。
    const old = data.sessions[idx]
    data.sessions[idx] = {
      ...old,
      ...session,
      projectId: old.projectId,
      groupId: old.groupId,
      pinned: old.pinned
    }
  } else {
    data.sessions.unshift(session)
  }
  writeJson(dataFilePath(), data)
  return data.sessions
}

export function deleteSession(id: string): Session[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  const gone = data.sessions.find((s) => s.id === id)
  data.sessions = data.sessions.filter((s) => s.id !== id)
  writeJson(dataFilePath(), data)
  // 删除会话后顺带清理其中 AI 回复的语音缓存：
  //  · GPT-SoVITS 主缓存：按文本匹配 index.json 删除；
  //  · IndexTTS 缓存：按「当前参考音频指纹+文本」尽力删除（若会话当时用的参考音频已换，残留属正常）。
  // 缓存按文本全局共享，若其他会话存在相同文本，朗读时会重新合成一次并重建缓存。
  if (gone) {
    try {
      const texts = (gone.messages ?? [])
        .filter((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content)
        .map((m) => m.content)
      if (texts.length) {
        const ref = loadConfig().indexttsRefAudio
        for (const t of texts) {
          try {
            ttsCacheDeleteText(t)
          } catch {
            /* 清理失败不影响删除会话 */
          }
          try {
            indexttsCacheDeleteText(t, ref)
          } catch {
            /* 清理失败不影响删除会话 */
          }
        }
      }
    } catch {
      /* 忽略 */
    }
  }
  return data.sessions
}

/** 重命名会话（仅改标题，消息与归类不变） */
export function renameSession(id: string, title: string): Session[] {
  const data = ensureFile<DataFile>(dataFilePath(), { sessions: [] })
  data.sessions = data.sessions.map((s) => (s.id === id ? { ...s, title } : s))
  writeJson(dataFilePath(), data)
  return data.sessions
}

/** 磁盘条目 -> 明文内存态（顶层 key、模型档案 key、MiMo TTS key） */
function decodeConfig(raw: Partial<LlmConfig>): Partial<LlmConfig> {
  return {
    ...raw,
    apiKey: decodeSecret(raw.apiKey ?? ''),
    mimoTTSKey: decodeSecret(raw.mimoTTSKey ?? ''),
    profiles: (raw.profiles ?? []).map((p) => ({ ...p, apiKey: decodeSecret(p.apiKey ?? '') }))
  }
}

/** 明文内存态 -> 待落盘（加密后写） */
function encodeConfig(cfg: LlmConfig): LlmConfig {
  return {
    ...cfg,
    apiKey: encodeSecret(cfg.apiKey),
    mimoTTSKey: encodeSecret(cfg.mimoTTSKey),
    profiles: cfg.profiles.map((p) => ({ ...p, apiKey: encodeSecret(p.apiKey) }))
  }
}

export function loadConfig(): LlmConfig {
  const raw = ensureFile<Partial<LlmConfig>>(configFilePath(), { ...DEFAULT_CONFIG })
  return normalizeConfig(decodeConfig(raw))
}

export function saveConfig(cfg: LlmConfig): LlmConfig {
  const current = loadConfig()

  // 渲染层拿到的 apiKey 是掩码；回传掩码（或空）表示"不改 Key"，
  // 不能把掩码写进配置，否则真 Key 会被 **** 覆盖掉。
  let merged: LlmConfig = cfg
  if (isMasked(cfg.apiKey)) {
    merged = { ...merged, apiKey: current.apiKey }
  }
  if (isMasked(cfg.mimoTTSKey)) {
    merged = { ...merged, mimoTTSKey: current.mimoTTSKey }
  }
  merged = {
    ...merged,
    profiles: merged.profiles.map((p) => {
      if (!isMasked(p.apiKey)) return p
      const old = current.profiles.find((c) => c.id === p.id)
      return { ...p, apiKey: old?.apiKey ?? '' }
    })
  }

  const normalized = normalizeConfig(merged)
  writeJson(configFilePath(), encodeConfig(normalized))
  return normalized
}
