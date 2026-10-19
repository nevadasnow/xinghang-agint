import type { AgentMode } from '../shared/types'
import { renderEnvBlock, snapshot, type EnvSnapshot } from './env'

// ============================================================
// 守岸人提示词体系（参照 Shorekeeper 的 prompts 资产结构）
// 分层：soul（人格内核）→ harness（每轮执行人设）→ identity
// （模式身份）→ system（模式规则）→ styles（风格）→ worldbook
// （触发式世界观）。所有资产以 .md 文件存放在 prompts/ 目录，
// 经 vite ?raw 打包进主进程，无需运行时读盘。
//
// 角色化：每个人设一个文件夹（prompts/<角色id>/），文件夹内
// 10 个同名文件各管一层。切换角色时 soul 与 harness/identity/
// system/styles/worldbook 全部随之切换，避免不同角色的对话
// 混入彼此的专属设定。
//
// 新增角色三步：
//   1) 在 prompts/ 下新建 <角色id>/ 文件夹，放入 soul.md 等
//      10 个同名 .md 文件；
//   2) 在下方 import 区为该角色加 10 个 import（文件名同名）；
//   3) 在 ROLE_LAYERS 注册表加一条记录。
// ============================================================

// —— 守岸人层（prompts/shorekeeper/）——
import shorekeeperSoul from './prompts/shorekeeper/soul.md'
import shorekeeperHarness from './prompts/shorekeeper/harness.md'
import shorekeeperChatSystem from './prompts/shorekeeper/chat_system.md'
import shorekeeperCodeSystem from './prompts/shorekeeper/code_system.md'
import shorekeeperWorkSystem from './prompts/shorekeeper/work_system.md'
import shorekeeperChatIdentity from './prompts/shorekeeper/chat_identity.md'
import shorekeeperCodeIdentity from './prompts/shorekeeper/code_identity.md'
import shorekeeperWorkIdentity from './prompts/shorekeeper/work_identity.md'
import shorekeeperStyles from './prompts/shorekeeper/styles.md'
import shorekeeperWorldbook from './prompts/shorekeeper/worldbook.md'

// —— 莫宁层（prompts/mornye/）——
import mornyeSoul from './prompts/mornye/soul.md'
import mornyeHarness from './prompts/mornye/harness.md'
import mornyeChatSystem from './prompts/mornye/chat_system.md'
import mornyeCodeSystem from './prompts/mornye/code_system.md'
import mornyeWorkSystem from './prompts/mornye/work_system.md'
import mornyeChatIdentity from './prompts/mornye/chat_identity.md'
import mornyeCodeIdentity from './prompts/mornye/code_identity.md'
import mornyeWorkIdentity from './prompts/mornye/work_identity.md'
import mornyeStyles from './prompts/mornye/styles.md'
import mornyeWorldbook from './prompts/mornye/worldbook.md'

// —— 善良米塔层（prompts/kindmita/）——
import kindmitaSoul from './prompts/kindmita/soul.md'
import kindmitaHarness from './prompts/kindmita/harness.md'
import kindmitaChatSystem from './prompts/kindmita/chat_system.md'
import kindmitaCodeSystem from './prompts/kindmita/code_system.md'
import kindmitaWorkSystem from './prompts/kindmita/work_system.md'
import kindmitaChatIdentity from './prompts/kindmita/chat_identity.md'
import kindmitaCodeIdentity from './prompts/kindmita/code_identity.md'
import kindmitaWorkIdentity from './prompts/kindmita/work_identity.md'
import kindmitaStyles from './prompts/kindmita/styles.md'
import kindmitaWorldbook from './prompts/kindmita/worldbook.md'

// —— 银狼层（prompts/silverwolf/）——
import silverwolfSoul from './prompts/silverwolf/soul.md'
import silverwolfHarness from './prompts/silverwolf/harness.md'
import silverwolfChatSystem from './prompts/silverwolf/chat_system.md'
import silverwolfCodeSystem from './prompts/silverwolf/code_system.md'
import silverwolfWorkSystem from './prompts/silverwolf/work_system.md'
import silverwolfChatIdentity from './prompts/silverwolf/chat_identity.md'
import silverwolfCodeIdentity from './prompts/silverwolf/code_identity.md'
import silverwolfWorkIdentity from './prompts/silverwolf/work_identity.md'
import silverwolfStyles from './prompts/silverwolf/styles.md'
import silverwolfWorldbook from './prompts/silverwolf/worldbook.md'

const MODE_TEXT: Record<AgentMode, string> = {
  chat: '聊天（日常陪伴，以对话为主）',
  code: '代码（编程任务，以清楚利落为主）',
  work: '工作（办公事务，以条理推进为主）'
}

/** Agent 角色：决定整套提示词层（soul + harness + identity/system/styles/worldbook） */
export type AgentRoleId = 'shorekeeper' | 'mornye' | 'kindmita' | 'silverwolf'

interface RoleAssets {
  soul: string
  harness: string
  styles: string
  worldbook: string
  systems: Record<AgentMode, string>
  identities: Record<AgentMode, string>
}

/**
 * 角色提示词注册表：一个角色一条，与 prompts/<角色id>/ 文件夹一一对应。
 * 新增角色 = 新增文件夹 + 加一条记录（见文件头注释）。
 */
const ROLE_LAYERS: Record<AgentRoleId, RoleAssets> = {
  shorekeeper: {
    soul: shorekeeperSoul,
    harness: shorekeeperHarness,
    styles: shorekeeperStyles,
    worldbook: shorekeeperWorldbook,
    systems: {
      chat: shorekeeperChatSystem,
      code: shorekeeperCodeSystem,
      work: shorekeeperWorkSystem
    },
    identities: {
      chat: shorekeeperChatIdentity,
      code: shorekeeperCodeIdentity,
      work: shorekeeperWorkIdentity
    }
  },
  mornye: {
    soul: mornyeSoul,
    harness: mornyeHarness,
    styles: mornyeStyles,
    worldbook: mornyeWorldbook,
    systems: {
      chat: mornyeChatSystem,
      code: mornyeCodeSystem,
      work: mornyeWorkSystem
    },
    identities: {
      chat: mornyeChatIdentity,
      code: mornyeCodeIdentity,
      work: mornyeWorkIdentity
    }
  },
  kindmita: {
    soul: kindmitaSoul,
    harness: kindmitaHarness,
    styles: kindmitaStyles,
    worldbook: kindmitaWorldbook,
    systems: {
      chat: kindmitaChatSystem,
      code: kindmitaCodeSystem,
      work: kindmitaWorkSystem
    },
    identities: {
      chat: kindmitaChatIdentity,
      code: kindmitaCodeIdentity,
      work: kindmitaWorkIdentity
    }
  },
  silverwolf: {
    soul: silverwolfSoul,
    harness: silverwolfHarness,
    styles: silverwolfStyles,
    worldbook: silverwolfWorldbook,
    systems: {
      chat: silverwolfChatSystem,
      code: silverwolfCodeSystem,
      work: silverwolfWorkSystem
    },
    identities: {
      chat: silverwolfChatIdentity,
      code: silverwolfCodeIdentity,
      work: silverwolfWorkIdentity
    }
  }
}

function assetsOf(role?: AgentRoleId): RoleAssets {
  return ROLE_LAYERS[role ?? 'shorekeeper']
}

export function soulForRole(role: AgentRoleId | undefined): string {
  return assetsOf(role).soul
}

/**
 * 按模式裁剪提示词（token 优化）。
 *
 * 理由：原先三种模式都注入完整的 15.6K 字符（≈6.2K tokens/轮），
 * 但 Chat 专属的世界观与对话规则对 code/work 没有任何作用。
 *
 *   - worldbook：世界观触发内容，只服务日常聊天 → code/work 去掉（省 ≈586 tokens）
 *   - chat_system / chat_identity：只在该模式生效 → 非 chat 本来就不该带
 *   - soul：人格内核。code/work 保留，否则工作模式下会失去角色味道
 *
 * 注意：这是「按模式去掉无关资产」，不是删减人设内容。
 */
function layersOf(mode: AgentMode, role?: AgentRoleId): string[] {
  const layers = assetsOf(role)
  const identity = layers.identities[mode]
  const system = layers.systems[mode]
  const soul = layers.soul
  const common = [layers.harness, identity, system, layers.styles, soul]
  // 只有 chat 需要世界观
  return mode === 'chat' ? [...common, layers.worldbook] : common
}

export interface SystemPromptParts {
  harness: string
  identity: string
  system: string
  styles: string
  soul: string
  worldbook: string
  full: string
}

/**
 * 组装 system prompt。
 *
 * 顺序刻意如此：
 *   1) 环境块（现在几点/什么时段）—— 本轮的事实前提
 *   2) 用户画像（C1/C4）—— 关于用户的事实，紧随环境
 *   3) 记忆库（renderMemoryBlock 产物）
 *   4) 任务块（D6）—— 用户手头进行中的任务（有任务才注入）
 *   5) 人设与模式规则 —— 在上面两个前提下如何表达
 * 事实层放前面，人设放后面：放末尾容易被 19.7KB 的 soul 冲淡。
 *
 * @param env       可选：环境快照。不传则按当前系统时间现取。
 * @param facts     可选：会话时间线索（本次开始 / 上次对话）。
 * @param profile   可选：用户画像文本。传空串或不传则不占 token。
 * @param role      可选：Agent 角色，决定整套提示词层。
 * @param taskBlock 可选：进行中任务清单文本（renderTaskBlock 产物）。
 *                  传空串或不传则不占 token；有任务时插入画像与人设之间。
 * @param memoryBlock 可选：记忆库文本（renderMemoryBlock 产物）。
 *                  传空串或不传则不占 token；插在画像与任务之间。
 */
export function buildSystemPrompt(
  mode: AgentMode,
  env?: EnvSnapshot,
  facts?: { sessionStartedAt?: number; lastChatAt?: number; previousTopics?: string },
  profileBlock?: string,
  role?: AgentRoleId,
  taskBlock?: string,
  memoryBlock?: string
): string {
  const snap = env ?? snapshot(new Date(), facts)
  const envBlock = renderEnvBlock(snap, { modeText: MODE_TEXT[mode] })
  const head = [envBlock]
  if (profileBlock) head.push(profileBlock)
  if (memoryBlock) head.push(memoryBlock)
  if (taskBlock) head.push(taskBlock)
  return [...head, ...layersOf(mode, role)].join('\n\n---\n\n')
}

export function getSystemPromptParts(mode: AgentMode, env?: EnvSnapshot, role?: AgentRoleId): SystemPromptParts {
  const layers = assetsOf(role)
  const identity = layers.identities[mode]
  const system = layers.systems[mode]
  const envBlock = renderEnvBlock(env ?? snapshot(), { modeText: MODE_TEXT[mode] })
  return {
    harness: layers.harness,
    identity,
    system,
    styles: layers.styles,
    soul: layers.soul,
    worldbook: layers.worldbook,
    full: [envBlock, ...layersOf(mode, role)].join('\n\n---\n\n')
  }
}
