/* 每个角色的语音合成参考音频（本地持久化，切换角色时自动应用） */

import type { AgentRoleId } from './agentRoles'

/** 默认参考音频（未自定义时使用；切换角色自动设为对应文件） */
export const DEFAULT_TTS_REFS: Record<AgentRoleId, string> = {
  shorekeeper: 'D:\\Shorekeeper-Agent-Dev\\IndexTTSRuntime\\参考语音\\守岸人-vocals.mp3',
  mornye: 'D:\\Shorekeeper-Agent-Dev\\IndexTTSRuntime\\参考语音\\莫宁.wav',
  kindmita: 'D:\\Shorekeeper-Agent-Dev\\IndexTTSRuntime\\参考语音\\善良米塔.wav',
  silverwolf: 'D:\\Shorekeeper-Agent-Dev\\IndexTTSRuntime\\参考语音\\银狼.wav'
}

const REFS_KEY = 'sk-tts-ref-by-role'

/** 读取所有角色的自定义参考音频（localStorage JSON） */
export function getTtsRefByRole(): Partial<Record<AgentRoleId, string>> {
  try {
    const v = localStorage.getItem(REFS_KEY)
    if (!v) return {}
    const o = JSON.parse(v) as Partial<Record<AgentRoleId, string>>
    return o && typeof o === 'object' ? o : {}
  } catch {
    return {}
  }
}

/** 某角色当前生效的参考音频：自定义优先，否则默认文件 */
export function getTtsRefForRole(id: AgentRoleId): string {
  return getTtsRefByRole()[id] || DEFAULT_TTS_REFS[id]
}

/** 保存某角色的自定义参考音频（空串 = 清除自定义，回到默认） */
export function setTtsRefForRole(id: AgentRoleId, path: string): void {
  const map = getTtsRefByRole()
  if (path && path.trim()) map[id] = path.trim()
  else delete map[id]
  try {
    localStorage.setItem(REFS_KEY, JSON.stringify(map))
  } catch {
    /* 忽略 */
  }
}
