// @ts-nocheck
/* 从 out/renderer 构建产物恢复的源文件（自动重建，保留原始逻辑；全局角色头像同步由 getEffectiveAgentAvatar 提供） */
import * as reactExports from 'react'
import * as jsxRuntimeExports from 'react/jsx-runtime'
import { getAgentRole } from '../utils/agentRoles'
import { getEffectiveAgentAvatar } from '../utils/agentRoles'
export default Butterfly

function Butterfly({ size = 32, className }) {
  const [tick, setTick] = reactExports.useState(0);
  reactExports.useEffect(() => {
    const onRole = () => setTick((t2) => t2 + 1);
    const onAvatar = () => setTick((t2) => t2 + 1);
    window.addEventListener("sk:agent-role", onRole);
    window.addEventListener("sk:agent-avatar-changed", onAvatar);
    return () => {
      window.removeEventListener("sk:agent-role", onRole);
      window.removeEventListener("sk:agent-avatar-changed", onAvatar);
    };
  }, []);
  const role = getAgentRole();
  return /* @__PURE__ */ jsxRuntimeExports.jsx(
    "img",
    {
      src: getEffectiveAgentAvatar(role.id),
      alt: role.name,
      width: size,
      height: size,
      draggable: false,
      className: "sk-avatar-img" + (className ? " " + className : "")
    }
  );
}
