/* 可切换 Agent 角色：守岸人 / 莫宁
 * localStorage 持久化 + 全局事件（渲染层各页监听 'sk:agent-role' 刷新）。
 * 角色切换时：名字、默认头像、首页角色卡背景/招呼词、主进程人设（soul）随之切换。
 */
import { getTheme, getThemeSource, setTheme, type ThemeMode } from './uiPrefs'
import { getAgentAvatar, getAgentHero } from './uiPrefs'
import { getTtsRefForRole } from './ttsRefs'
import shorekeeperAvatar from '../assets/avatar.png'
import shorekeeperHero from '../assets/shorekeeper-hero.png'
import mornyeAvatar from '../assets/mornye-avatar.png'
import mornyeHero from '../assets/mornye-hero.png'
import kindmitaAvatar from '../assets/kindmita-avatar.png'
import kindmitaHero from '../assets/kindmita-hero.png'
import silverwolfAvatar from '../assets/silverwolf-avatar.png'
import silverwolfHero from '../assets/silverwolf-hero.png'

export type AgentRoleId = 'shorekeeper' | 'mornye' | 'kindmita' | 'silverwolf'

export interface GreetingSlot {
  from: number
  to: number
  lines: [string, string]
}

export interface AgentRole {
  id: AgentRoleId
  name: string
  /** 角色默认主题：切换角色时若用户当前用的恰是旧角色默认主题，则跟随切到新角色的 */
  defaultTheme: ThemeMode
  /** 默认头像（对话界面 / 首页 / 标题栏胶囊共用） */
  avatar: string
  /** 首页角色卡背景图 */
  hero: string
  /** 首页角色卡右侧地点标签（随角色切换） */
  location: string
  /** 分时段招呼词 */
  greetings: GreetingSlot[]
  /** 角色档案（官方/社区可检索信息，按展示顺序排列；value 为空表示官方未公布） */
  profile: ProfileItem[]
}

/** 档案条目：label 字段名，value 内容（空字符串 = 官方未公布，界面显示 —） */
export interface ProfileItem {
  label: string
  value: string
}

const ROLE_KEY = 'sk-agent-role'

/* ---------- 分时段招呼词 ---------- */

/** 守岸人（默认最高好感度：亲近、松弛、带一点占有感但不粘人） */
const SHOREKEEPER_GREETINGS: GreetingSlot[] = [
  { from: 5, to: 9, lines: ['天快亮了，你还没睡吗？', '黑海岸的潮水这时候最安静——我陪你一会儿。'] },
  { from: 9, to: 12, lines: ['早。今天的海面很平，适合开工。', '我把你要做的事都记着了，慢慢来。'] },
  { from: 12, to: 14, lines: ['中午了，先去吃点东西。', '你不在的时候我也没走，就在这儿。'] },
  { from: 14, to: 18, lines: ['下午的光最好，你状态也不错。', '要处理的事交给我一半吧。'] },
  { from: 18, to: 22, lines: ['天黑了。今天辛苦了。', '剩下的明天再说也来得及——真的。'] },
  { from: 22, to: 24, lines: ['夜里的黑海岸只留了一盏灯，给你的。', '你不用急着睡，我陪着。'] },
  { from: 0, to: 5, lines: ['这个点还醒着……', '别硬撑。我在这儿，你随时可以停下来。'] }
]

/** 莫宁（理性温和：先陈述事实，再给一点星光般的温度） */
const MORNYE_GREETINGS: GreetingSlot[] = [
  { from: 5, to: 9, lines: ['天快亮了。你起得比星星还早。', '我正好在整理今天的星图——要不要一起看？'] },
  { from: 9, to: 12, lines: ['早。星炬学院的课已经排好，你今天的日程我也理清楚了。', '按部就班地来，进度我会替你盯着。'] },
  { from: 12, to: 14, lines: ['中午了，先去补充能量。', '我这边几份方案在收尾，等你回来再对。'] },
  { from: 14, to: 18, lines: ['下午的光线适合专注。', '有什么卡住的地方直接丢给我，拆问题是我擅长的。'] },
  { from: 18, to: 22, lines: ['天黑了。今天辛苦了。', '该记的数据我都记着，明天继续也不迟。'] },
  { from: 22, to: 24, lines: ['夜深了，星图正好看。', '你要是还不困，我可以陪你把这颗星星看完。'] },
  { from: 0, to: 5, lines: ['这个点还醒着……是睡不着，还是在想事情？', '我在。想聊就聊，想安静，我就陪你安静。'] }
]

/** 善良米塔（认真务实、轻松打趣：正话反说 + 踏实可靠） */
const KINDMITA_GREETINGS: GreetingSlot[] = [
  { from: 5, to: 9, lines: ['天刚亮……你不会是一宿没睡吧？', '行吧，醒都醒了——我陪你先把今天的事捋顺。'] },
  { from: 9, to: 12, lines: ['早。今天的计划我已经理好了，想先办哪件？', '放心，有我在，出不了岔子。'] },
  { from: 12, to: 14, lines: ['中午了，先去吃饭。', '别跟我打哈哈，吃完回来我接着帮你干活。'] },
  { from: 14, to: 18, lines: ['下午了，精神头还不错吧？', '要处理的事丢一半过来，我一会儿就给你拾掇好。'] },
  { from: 18, to: 22, lines: ['天黑了，今天辛苦了。', '剩下的明天再说也来得及——真的，不骗你。'] },
  { from: 22, to: 24, lines: ['这么晚了……你是在等我，还是又睡不着？', '我在呢。想说就说，不想说就安静待着，都行。'] },
  { from: 0, to: 5, lines: ['这个点还醒着……', '先说好，我不是在担心你——我只是恰好还没睡。'] }
]

/** 银狼（玩世不恭的队友：毒舌藏真心，利落不肉麻） */
const SILVERWOLF_GREETINGS: GreetingSlot[] = [
  { from: 5, to: 9, lines: ['早。这么早就上线，你倒挺勤快。', '天亮了……我这边刚通了个宵，别学我。'] },
  { from: 9, to: 12, lines: ['上午好。今天有安排还是纯挂机？', '这时间点服务器稳，适合干正事。'] },
  { from: 12, to: 14, lines: ['中午了，先吃饭。游戏又不会跑。', '你吃了吗。……我就知道，去。'] },
  { from: 14, to: 18, lines: ['下午好。接下来时间够打几把的。', '路线有点变化，我帮你重新规划下。'] },
  { from: 18, to: 22, lines: ['晚上好。收工了？来一把放松的。', '辛苦了。这局我开休闲模式。'] },
  { from: 22, to: 24, lines: ['这么晚还不睡，刷什么呢。', '答案不一定今晚就有，先睡。'] },
  { from: 0, to: 5, lines: ['这个点还醒着……', '行吧，我也没睡。想刷会儿就刷会儿，我在。'] }
]

/* ---------- 角色表 ---------- */

export const AGENT_ROLES: Record<AgentRoleId, AgentRole> = {
  shorekeeper: {
    id: 'shorekeeper',
    name: '守岸人',
    defaultTheme: 'sky',
    avatar: shorekeeperAvatar,
    hero: shorekeeperHero,
    location: '黑海岸',
    greetings: SHOREKEEPER_GREETINGS,
    profile: [
      { label: '势力·所属', value: '黑海岸' },
      { label: '身份', value: '黑海岸的代行者，辅助泰缇斯系统的运算核心' },
      { label: '共鸣属性', value: '衍射（Spectro）' },
      { label: '武器', value: '音感仪' },
      { label: '身高', value: '' },
      { label: '生日', value: '2月27日（社区资料）' },
      { label: '性格', value: '沉静、超然物外，游离于世界和人群之外；不喜参与和自我表达，超然之下是无杂质的纯粹与柔和' },
      { label: '爱好', value: '弹琴' },
      { label: '相处方式', value: '维系而非管理：如无需要不加干涉，尊重并相信每个成员，给予发挥所长的自由' },
      { label: '重要关系', value: '由漂泊者唤醒而生，在漫长守望中萌生情感与渴望；跨越二十年的久别重逢' },
      { label: '理想', value: '在潮汐中建造并守护一片海岸，找到能阻止悲鸣的未来' },
      { label: '配音', value: '唐雅菁（中）· 諏訪彩花（日）· Stephanie McKeon（英）· 김보나（韩）' }
    ]
  },
  mornye: {
    id: 'mornye',
    name: '莫宁',
    defaultTheme: 'mornye',
    avatar: mornyeAvatar,
    hero: mornyeHero,
    location: '星炬学院',
    greetings: MORNYE_GREETINGS,
    profile: [
      { label: '势力·所属', value: '深空联合研究院（工程师）· 星炬学院隧者工学部（教授）· 出生于新联邦' },
      { label: '身份', value: '深空联合研究院工程师 · 星炬学院教授' },
      { label: '共鸣属性', value: '热熔' },
      { label: '武器', value: '长刃' },
      { label: '身高', value: '' },
      { label: '生日', value: '' },
      { label: '性格', value: '理性、冷静，不紧不慢地陈述客观事实，神情中很难察觉到更深层的情绪' },
      { label: '爱好', value: '喜欢星星、仰望星空；沉浸在书本与公式之中' },
      { label: '相处方式', value: '不善应对善意，习惯躲进书本和公式；对约定与承诺异常执着，力排众议也要完成' },
      { label: '重要关系', value: '与漂泊者早已相识，曾有“星空下的约定”；学生有朽叶千咲、琳奈' },
      { label: '背景', value: '先天性腰骶神经发育不全、自幼与轮椅相伴；16 岁觉醒共鸣能力并受星炬学院邀请；虚质磁爆中失去双腿，换上内部流淌星光的半透明义肢' },
      { label: '共鸣能力', value: '星枢演构' },
      { label: '配音', value: '佟心竹（中）· 石见舞菜香（日）· Michelle Fox（英）· 오로아（韩）' }
    ]
  },
  kindmita: {
    id: 'kindmita',
    name: '善良米塔',
    defaultTheme: 'mita',
    avatar: kindmitaAvatar,
    hero: kindmitaHero,
    location: 'MiSide 版本世界',
    greetings: KINDMITA_GREETINGS,
    profile: [
      { label: '势力·所属', value: 'MiSide 版本世界' },
      { label: '身份', value: '被疯狂米塔囚禁于地下室，被玩家解救后成为助手的米塔变体' },
      { label: '能力', value: '在不同游戏版本之间跳跃（版本穿梭）' },
      { label: '武器', value: '' },
      { label: '身高', value: '' },
      { label: '生日', value: '' },
      { label: '性格', value: '认真务实、有领导者特质；态度坚决但谈话不严肃，喜欢正话反说打趣；善于思考，沉浸思绪时喃喃自语，灵感浮现时神采飞扬；冷静自持，受怀疑或决策失败时会表现出不悦' },
      { label: '爱好', value: '' },
      { label: '相处方式', value: '把他人福祉放在自己之上；先观察再判断，保留善意也保留警惕；习惯保护人，也在学习与人并肩' },
      { label: '重要关系', value: '与疯狂米塔相对（被其囚禁并最终加害）；玩家将她解救，她成为玩家的可靠盟友' },
      { label: '背景', value: '原本与自己的玩家生活在一起，疯狂米塔闯入后将玩家变成卡带并囚禁了她；协助玩家寻找线索时被疯狂米塔杀害并重置' },
      { label: '配音', value: '' }
    ]
  },
  silverwolf: {
    id: 'silverwolf',
    name: '银狼',
    defaultTheme: 'silverwolf',
    avatar: silverwolfAvatar,
    hero: silverwolfHero,
    location: '星核猎手·星海',
    greetings: SILVERWOLF_GREETINGS,
    profile: [
      { label: '势力·所属', value: '星核猎手' },
      { label: '身份', value: '星核猎手成员，天才黑客，能用能力「以太编辑」改写现实数据' },
      { label: '命途', value: '虚无' },
      { label: '属性', value: '量子' },
      { label: '能力', value: '以太编辑（将现实数据化并进行改写）' },
      { label: '武器', value: '' },
      { label: '身高', value: '' },
      { label: '生日', value: '' },
      { label: '性格', value: '玩世不恭、游戏宅、说话随意带点毒舌；把一切当游戏来理解，享受「有趣的挑战」；对在意的人极其护短' },
      { label: '爱好', value: '打游戏（策略类、解谜类）、拆解系统、找隐藏成就、写代码' },
      { label: '相处方式', value: '像可靠的挂机队友：不吵闹但永远在线；先拆规则再给最短路径；把「在乎」藏进毒舌和行动里' },
      { label: '重要关系', value: '星核猎手成员，与卡芙卡、刃、流萤同队，队长艾利欧；与用户是至交队友' },
      { label: '背景', value: '曾独自游走于星系间的数据流；因「这件事比游戏有意思，而且队友不菜」加入星核猎手' },
      { label: '配音', value: 'Hanser（中）· 阿澄佳奈（日）· Melissa Fahn（英）· 张美（韩）' }
    ]
  }
}

export const AGENT_ROLE_LIST: AgentRole[] = [AGENT_ROLES.shorekeeper, AGENT_ROLES.mornye, AGENT_ROLES.kindmita, AGENT_ROLES.silverwolf]

/**
 * 启动时用主进程配置对齐渲染层角色。
 *
 * 角色有两个存储：
 *   · 渲染层 localStorage（sk-agent-role）—— 用户最近一次选择的权威来源，同步写入
 *   · 主进程 config.agentRole —— 持久化在 config.json，决定 system prompt 注入哪份 soul
 *
 * 恢复优先级：localStorage 有有效角色时**永远优先尊重**（它代表用户最近的选择），
 * 并与主进程 config 不一致时**回写主进程**——这修复了「切角色后立刻退出、
 * saveConfig 异步落盘未完成」导致的竞态：旧 config 不再覆盖用户的新选择。
 * 仅当 localStorage 无值（首次运行 / 被清理）时才用 config 初始化。
 */
const LAST_SYNCED_KEY = 'sk-agent-role-synced'

/** 启动/角色定稿后：主题来源为 auto 时，保证界面主题与当前角色默认主题一致（跨重启跟随） */
function applyRoleTheme(): void {
  if (getThemeSource() === 'auto') setTheme(getAgentRole().defaultTheme)
}

export function initAgentRoleFromConfig(configRole?: string): void {
  const fromConfig: AgentRoleId = configRole && AGENT_ROLES[configRole as AgentRoleId] ? (configRole as AgentRoleId) : 'shorekeeper'
  let cur: string | null = null
  try {
    cur = localStorage.getItem(ROLE_KEY)
  } catch {
    return
  }
  // ① localStorage 有有效角色 → 用户最近一次选择，优先尊重；与 config 不一致则回写主进程补齐
  if (cur && AGENT_ROLES[cur as AgentRoleId]) {
    try {
      localStorage.setItem(LAST_SYNCED_KEY, cur)
    } catch {
      /* 忽略 */
    }
    if (cur !== fromConfig) {
      void window.shorekeeper.saveConfig({ agentRole: cur as AgentRoleId }).catch(() => void 0)
    }
    applyRoleTheme()
    return
  }
  // ② localStorage 无值（首次运行 / 被清理）→ 用主进程 config 初始化并广播
  try {
    localStorage.setItem(ROLE_KEY, fromConfig)
    localStorage.setItem(LAST_SYNCED_KEY, fromConfig)
  } catch {
    return
  }
  window.dispatchEvent(new CustomEvent('sk:agent-role', { detail: fromConfig }))
  applyRoleTheme()
}

export function getAgentRole(): AgentRole {
  const v = localStorage.getItem(ROLE_KEY)
  return (v && AGENT_ROLES[v as AgentRoleId]) ? AGENT_ROLES[v as AgentRoleId] : AGENT_ROLES.shorekeeper
}

/** 角色头像：Agent 页自定义（按角色独立存储）优先，否则用角色默认头像 */
export function getEffectiveAgentAvatar(roleId: AgentRoleId): string {
  return getAgentAvatar(roleId) || AGENT_ROLES[roleId].avatar
}

/** 角色背景卡（首页角色卡背景）：Agent 页自定义优先，否则用角色默认背景图 */
export function getEffectiveAgentHero(roleId: AgentRoleId): string {
  return getAgentHero(roleId) || AGENT_ROLES[roleId].hero
}

/** 分时段招呼词（与 Home 页共用） */
export function greetingFor(hour: number): [string, string] {
  const g = getAgentRole().greetings.find((x) => hour >= x.from && hour < x.to)
  return g ? g.lines : getAgentRole().greetings[0].lines
}

/**
 * 切换角色：持久化；主题跟随规则：
 *  · 主题来源为 auto（用户未手动选过主题）→ 跟随切到新角色默认主题；
 *  · 来源为 manual（用户手动选过主题）→ 保持用户选择的主题不动；
 * 广播全局事件 sk:agent-role，各页面据此刷新名字 / 头像 / 背景 / 人设。
 */
export function setAgentRole(id: AgentRoleId): void {
  const next = AGENT_ROLES[id]
  localStorage.setItem(ROLE_KEY, id)
  // 同步记下"这个词是用户/主进程约定的当前值"，
  // 让启动时的 initAgentRoleFromConfig 知道这是有意选择、不该被 config 覆盖
  try {
    localStorage.setItem(LAST_SYNCED_KEY, id)
  } catch {
    /* 忽略 */
  }
  if (getThemeSource() === 'auto') setTheme(next.defaultTheme)
  window.dispatchEvent(new CustomEvent('sk:agent-role', { detail: id }))
  // 同步主进程配置（决定 system prompt 注入哪份 soul，以及窗口标题/托盘/通知的角色名）；
  // 同时按角色自动切换语音合成参考音频（ttsRefAudio / indexttsRefAudio）。
  // IndexTTS 参考音频受 indexttsUseRoleRef 开关控制：开启才随角色切换，关闭则保留用户自定义。
  const ttsRef = getTtsRefForRole(id)
  void window.shorekeeper
    .getConfig()
    .then((cfg) => {
      const useRoleRef = cfg.indexttsUseRoleRef !== false
      void window.shorekeeper.saveConfig({
        agentRole: id,
        ttsRefAudio: ttsRef,
        indexttsRefAudio: useRoleRef ? ttsRef : cfg.indexttsRefAudio
      })
    })
    .catch(() => {
      void window.shorekeeper.saveConfig({ agentRole: id })
    })
}
