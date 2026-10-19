// @ts-nocheck
/* 从 out/renderer 构建产物恢复的源文件（自动重建，保留原始逻辑；全局角色头像同步由 getEffectiveAgentAvatar 提供） */
import * as reactExports from 'react'
import * as jsxRuntimeExports from 'react/jsx-runtime'
import { getAgentRole } from '../utils/agentRoles'
import { getEffectiveAgentAvatar } from '../utils/agentRoles'
export { ButterflyDefs, ButterflyMark }
export default ButterflyMark

function ButterflyDefs() {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { width: "0", height: "0", style: { position: "absolute" }, "aria-hidden": "true", focusable: "false", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("symbol", { id: BUTTERFLY_SYMBOL_ID, viewBox: "0 0 96 84", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("defs", { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("radialGradient", { id: "sk-wg", cx: ".5", cy: ".5", r: ".6", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { stopColor: "#4A9CFF", stopOpacity: ".5" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "1", stopColor: "#4A9CFF", stopOpacity: "0" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("linearGradient", { id: "sk-wu", x1: "46", y1: "6", x2: "8", y2: "45", gradientUnits: "userSpaceOnUse", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { stopColor: "#4A9CFF" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: ".32", stopColor: "#89C8F7" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: ".7", stopColor: "#DCEAF9" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "1", stopColor: "#F2F7FD" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("linearGradient", { id: "sk-wl", x1: "12", y1: "38", x2: "32", y2: "78", gradientUnits: "userSpaceOnUse", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { stopColor: "#5B9BD5" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: ".45", stopColor: "#A5CEEF" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "1", stopColor: "#F2F7FD" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("linearGradient", { id: "sk-tg", x1: "0", y1: "50", x2: "0", y2: "76", gradientUnits: "userSpaceOnUse", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { stopColor: "#DCEAF9" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "1", stopColor: "#4A9CFF" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("linearGradient", { id: "sk-bg2", x1: "0", y1: "20", x2: "0", y2: "52", gradientUnits: "userSpaceOnUse", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { stopColor: "#8AB8E8" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("stop", { offset: "1", stopColor: "#2F6CA8" })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("filter", { id: "sk-sf", x: "-30%", y: "-30%", width: "160%", height: "160%", children: /* @__PURE__ */ jsxRuntimeExports.jsx("feGaussianBlur", { stdDeviation: ".55" }) })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("ellipse", { cx: "48", cy: "42", rx: "44", ry: "34", fill: "url(#sk-wg)" }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("g", { filter: "url(#sk-sf)", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "path",
        {
          d: "M46 36C40 19 29 6 18.5 5.5 8 5 2.5 13.5 4 23c1.5 9.5 12 16 24.5 16.5 7.5.3 15-1 17.5-3.5z",
          fill: "url(#sk-wu)",
          stroke: "#5B9BD5",
          strokeOpacity: ".5",
          strokeWidth: ".8"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "path",
        {
          d: "M50 36c6-17 17-30 27.5-30.5C88 5 93.5 13.5 92 23c-1.5 9.5-12 16-24.5 16.5-7.5.3-15-1-17.5-3.5z",
          fill: "url(#sk-wu)",
          stroke: "#5B9BD5",
          strokeOpacity: ".5",
          strokeWidth: ".8"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "path",
        {
          d: "M44.5 42c-7 7-18 9.5-24.5 5-6.5-4.5-6-13 1-16.5 6.5-3.2 16.5.5 23.5 11.5z",
          fill: "url(#sk-wl)",
          stroke: "#8AB8E8",
          strokeOpacity: ".45",
          strokeWidth: ".8"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "path",
        {
          d: "M51.5 42c7 7 18 9.5 24.5 5 6.5-4.5 6-13-1-16.5-6.5-3.2-16.5.5-23.5 11.5z",
          fill: "url(#sk-wl)",
          stroke: "#8AB8E8",
          strokeOpacity: ".45",
          strokeWidth: ".8"
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M43 51c-2.5 10-4 19-2 23.5 1.7 3.8 5.4 2.4 6.1-1.5 1.2-6.5.4-16.5 2-22z", fill: "url(#sk-tg)" }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M53 51c2.5 10 4 19 2 23.5-1.7 3.8-5.4 2.4-6.1-1.5-1.2-6.5-.4-16.5-2-22z", fill: "url(#sk-tg)" })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      "path",
      {
        d: "M48 22c1.9 0 2.9 1.5 2.7 3.6-.5 4.8.1 11.6.8 16.4.3 2.5-1.7 4.2-3.5 4.2s-3.8-1.7-3.5-4.2c.7-4.8 1.3-11.6.8-16.4C44.9 23.5 46.1 22 48 22z",
        fill: "url(#sk-bg2)"
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M47 21C44.6 15 40.4 11 36.4 9.6", stroke: "#8AB8E8", strokeWidth: "1.1", strokeLinecap: "round" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M49 21c2.4-6 6.6-10 10.6-11.4", stroke: "#8AB8E8", strokeWidth: "1.1", strokeLinecap: "round" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "36", cy: "9.2", r: "1.9", fill: "#C8A45D" }),
    /* @__PURE__ */ jsxRuntimeExports.jsx("circle", { cx: "60", cy: "9.2", r: "1.9", fill: "#C8A45D" })
  ] }) });
}

function ButterflyMark({
  width = 27,
  className
}) {
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
      width,
      height: width,
      draggable: false,
      className: "sk-avatar-img" + (className ? " " + className : "")
    }
  );
}

const BUTTERFLY_SYMBOL_ID = "sk-bfly";
