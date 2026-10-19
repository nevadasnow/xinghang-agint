import { useEffect, useState } from 'react'
import Butterfly from './Butterfly'
import { getAgentAvatar } from '../utils/uiPrefs'
import { AGENT_ROLES, getAgentRole, type AgentRoleId } from '../utils/agentRoles'

/** 对话界面消息头像：优先显示用户在「外观」里自定义的头像，
 *  没有自定义时按 roleId 显示对应角色的默认头像（存档消息固定显示存档角色）。 */
export default function ChatAvatar({
  size = 28,
  className,
  roleId
}: {
  size?: number
  className?: string
  roleId?: AgentRoleId
}) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const onRole = () => setTick((t) => t + 1)
    const onAvatar = () => setTick((t) => t + 1)
    window.addEventListener('sk:agent-role', onRole)
    window.addEventListener('sk:agent-avatar-changed', onAvatar)
    return () => {
      window.removeEventListener('sk:agent-role', onRole)
      window.removeEventListener('sk:agent-avatar-changed', onAvatar)
    }
  }, [])
  const custom = getAgentAvatar(roleId ?? getAgentRole().id)
  const cls = 'chat-avatar-img' + (className ? ' ' + className : '')
  if (custom) {
    return (
      <img
        src={custom}
        alt="守岸人"
        width={size}
        height={size}
        draggable={false}
        className={'sk-avatar-img ' + cls}
      />
    )
  }
  if (roleId && AGENT_ROLES[roleId]) {
    return (
      <img
        src={AGENT_ROLES[roleId].avatar}
        alt={AGENT_ROLES[roleId].name}
        width={size}
        height={size}
        draggable={false}
        className={'sk-avatar-img ' + cls}
      />
    )
  }
  return <Butterfly size={size} className={cls} />
}
