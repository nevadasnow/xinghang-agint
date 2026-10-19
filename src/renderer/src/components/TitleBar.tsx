// @ts-nocheck
/* 从 out/renderer 构建产物恢复的源文件（自动重建，保留原始逻辑；全局角色头像同步由 getEffectiveAgentAvatar 提供） */
import * as reactExports from 'react'
import * as jsxRuntimeExports from 'react/jsx-runtime'
import { getTheme } from '../utils/uiPrefs'
import { setTheme } from '../utils/uiPrefs'
import { getAgentRole } from '../utils/agentRoles'
import { AGENT_ROLES } from '../utils/agentRoles'
import { AGENT_ROLE_LIST } from '../utils/agentRoles'
import { setAgentRole } from '../utils/agentRoles'
import { getEffectiveAgentAvatar } from '../utils/agentRoles'
export default TitleBar

function TitleBar({
  config,
  onMinimize,
  onToggleMaximize,
  onClose,
  onConfigChange,
  onOpenSettings
}) {
  const [maximized, setMaximized] = reactExports.useState(false);
  const [now, setNow] = reactExports.useState(() => /* @__PURE__ */ new Date());
  const [popOpen, setPopOpen] = reactExports.useState(false);
  const [models, setModels] = reactExports.useState([]);
  const [connecting, setConnecting] = reactExports.useState(false);
  const [conn, setConn] = reactExports.useState(null);
  const [picking, setPicking] = reactExports.useState(null);
  const [themeOpen, setThemeOpen] = reactExports.useState(false);
  const [theme, setThemeState] = reactExports.useState(() => getTheme());
  const themeRef = reactExports.useRef(null);
  const THEME_ITEMS = [
    { id: "sky", label: "经典颜色（守岸蓝）" },
    { id: "dark", label: "纯黑" },
    { id: "light", label: "纯白" },
    { id: "system", label: "跟随系统" },
    { id: "sakura", label: "绯樱" },
    { id: "bamboo", label: "青竹" },
    { id: "mornye", label: "莫宁紫" },
    { id: "mita", label: "米塔粉" },
    { id: "silverwolf", label: "银狼紫" }
  ];
  reactExports.useEffect(() => {
    const onTheme = () => setThemeState(getTheme());
    window.addEventListener("sk:theme", onTheme);
    window.addEventListener("storage", onTheme);
    return () => {
      window.removeEventListener("sk:theme", onTheme);
      window.removeEventListener("storage", onTheme);
    };
  }, []);
  function pickTheme(t2) {
    // 用户手动选主题：与当前角色默认主题不同 → manual（记住用户选择，切角色不再跟随）；
    // 恰好等于当前角色默认主题 → auto（保持"跟随角色"，下次切角色照常跟随）。
    setTheme(t2, { manual: t2 !== getAgentRole().defaultTheme });
    setThemeState(t2);
    setThemeOpen(false);
  }
  const rootRef = reactExports.useRef(null);
  const seqRef = reactExports.useRef(0);
  reactExports.useEffect(() => {
    const t2 = window.setInterval(() => setNow(/* @__PURE__ */ new Date()), 3e4);
    return () => window.clearInterval(t2);
  }, []);
  reactExports.useEffect(() => {
    if (!popOpen) return;
    function onDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setPopOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popOpen]);
  reactExports.useEffect(() => {
    if (!themeOpen) return;
    function onDown(e) {
      if (themeRef.current && !themeRef.current.contains(e.target)) setThemeOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [themeOpen]);
  const [roleOpen, setRoleOpen] = reactExports.useState(false);
  const [role, setRoleState] = reactExports.useState(() => getAgentRole().id);
  const [roleTick, setRoleTick] = reactExports.useState(0);
  const roleRef = reactExports.useRef(null);
  // 角色切换 / 自定义头像变更时实时跟随（Agent 页「使用」也走 sk:agent-role）
  reactExports.useEffect(() => {
    const onRole = () => setRoleState(getAgentRole().id);
    const onAvatar = () => setRoleTick((t2) => t2 + 1);
    window.addEventListener("sk:agent-role", onRole);
    window.addEventListener("sk:agent-avatar-changed", onAvatar);
    return () => {
      window.removeEventListener("sk:agent-role", onRole);
      window.removeEventListener("sk:agent-avatar-changed", onAvatar);
    };
  }, []);
  reactExports.useEffect(() => {
    if (!roleOpen) return;
    function onDown(e) {
      if (roleRef.current && !roleRef.current.contains(e.target)) setRoleOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [roleOpen]);
  reactExports.useEffect(() => {
    if (!popOpen) return;
    function onKey(e) {
      if (e.key === "Escape") setPopOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popOpen]);
  const hh2 = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const configured = Boolean(config?.configured);
  const modelLabel = config?.model?.trim() || "未配置";
  const roleMeta = AGENT_ROLES[role];
  const autoRead = Boolean(config?.autoRead);
  function connect() {
    if (!config) {
      setModels([]);
      setConn({ kind: "fail", text: "配置尚未加载完成，请稍后再试" });
      return;
    }
    const seq = ++seqRef.current;
    setConn({ kind: "loading", text: "获取中…" });
    setConnecting(true);
    setModels([]);
    const cfg = {
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      provider: config.provider,
      timeoutSec: config.timeoutSec
    };
    const current = config.model.trim();
    window.shorekeeper.listModels(cfg).then((r2) => {
      if (seq !== seqRef.current) return;
      if (!r2.ok) {
        setModels([]);
        setConn({ kind: "fail", text: r2.error ?? "获取失败" });
        return void 0;
      }
      const list = r2.models ?? [];
      setModels(list);
      const testModel = current || list[0] || "";
      if (!testModel) {
        setConn({
          kind: "ok",
          text: `已连接（${r2.count ?? list.length} 个模型），可在列表中选择或手填`
        });
        return void 0;
      }
      return window.shorekeeper.testConfig({ ...cfg, model: testModel }).then((t2) => {
        if (seq !== seqRef.current) return;
        if (t2.ok) {
          setConn({ kind: "ok", text: `已连接（${r2.count ?? list.length} 个模型）· 聊天接口正常（${t2.latencyMs ?? "-"}ms）` });
        } else {
          setConn({ kind: "fail", text: `已连接（${r2.count ?? list.length} 个模型），但聊天接口不可用：${t2.error ?? "未知错误"}` });
        }
      }).catch((e) => {
        if (seq !== seqRef.current) return;
        setConn({ kind: "fail", text: `已连接（${r2.count ?? list.length} 个模型），但聊天接口测试失败：${e.message}` });
      });
    }).catch((e) => {
      if (seq !== seqRef.current) return;
      setModels([]);
      setConn({ kind: "fail", text: e.message });
    }).finally(() => {
      if (seq === seqRef.current) setConnecting(false);
    });
  }
  function togglePop() {
    if (popOpen) {
      seqRef.current++;
      setPopOpen(false);
      setConnecting(false);
      return;
    }
    setPopOpen(true);
    connect();
  }
  function pickModel(m2) {
    if (!config || picking) return;
    setPicking(m2);
    setConn({ kind: "loading", text: `正在切换到 ${m2}…` });
    window.shorekeeper.saveConfig({ ...config, model: m2 }).then((info) => {
      onConfigChange?.(info);
      setConn({ kind: "ok", text: `已切换到 ${m2}` });
      seqRef.current++;
      setPopOpen(false);
    }).catch((e) => {
      setConn({ kind: "fail", text: `切换失败：${e.message}` });
    }).finally(() => setPicking(null));
  }
  function toggleAutoRead() {
    if (!config) return;
    window.shorekeeper.saveConfig({ ...config, autoRead: !autoRead }).then((info) => onConfigChange?.(info)).catch((e) => console.error("[titlebar] 自动朗读开关保存失败：", e));
  }
  const rowModels = models.length > 0 ? models : config?.model ? [config.model] : [];
  function stop(e) {
    e.stopPropagation();
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "titlebar", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-pills", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-role-wrap", ref: roleRef, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            className: "pill-tab tb-pick tb-role" + (roleOpen ? " open" : ""),
            type: "button",
            title: "角色",
            "aria-haspopup": "listbox",
            "aria-expanded": roleOpen,
            onClick: () => setRoleOpen((v2) => !v2),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("img", { className: "tb-role-avatar", src: getEffectiveAgentAvatar(roleMeta.id), alt: roleMeta.name, draggable: false }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: roleMeta.name }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-cv", children: "▾" })
            ]
          }
        ),
        roleOpen && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tb-role-pop", role: "listbox", "aria-label": "角色选择", children: AGENT_ROLE_LIST.map((r2) => {
          const on = r2.id === role;
          return /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              role: "option",
              "aria-selected": on,
              className: "tb-role-row" + (on ? " on" : ""),
              onClick: (e) => {
                e.stopPropagation();
                setAgentRole(r2.id);
                setRoleState(r2.id);
                setRoleOpen(false);
              },
              children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("img", { className: "tb-role-row-avatar", src: getEffectiveAgentAvatar(r2.id), alt: r2.name, draggable: false }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-role-row-name", children: r2.name }),
                on && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-role-row-ck", "aria-hidden": "true", children: "✓" })
              ]
            },
            r2.id
          );
        }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-model-wrap", ref: rootRef, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            className: "pill-tab tb-pick tb-model" + (popOpen ? " open" : ""),
            type: "button",
            title: configured ? `当前模型：${modelLabel}` : "模型未配置，点击展开",
            "aria-haspopup": "listbox",
            "aria-expanded": popOpen,
            onClick: togglePop,
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-ic", children: "◆" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-model-name", children: modelLabel }),
              /* @__PURE__ */ jsxRuntimeExports.jsx(
                "span",
                {
                  className: "tb-status-dot" + (configured ? " ok" : ""),
                  title: configured ? "模型已配置" : "模型未配置",
                  "aria-hidden": "true"
                }
              ),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-cv", children: "▾" })
            ]
          }
        ),
        popOpen && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-model-pop", role: "listbox", "aria-label": "模型选择", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-pop-head", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "t", children: "模型" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "tb-pop-reload",
                title: "重新连接并获取模型",
                "aria-label": "重新连接并获取模型",
                disabled: connecting,
                onClick: (e) => {
                  stop(e);
                  connect();
                },
                children: "⟳"
              }
            )
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-pop-status" + (conn?.kind === "fail" ? " bad" : ""), children: [
            conn?.kind === "loading" && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-spin", "aria-hidden": "true" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: conn?.text ?? "尚未连接" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-model-list", children: [
            rowModels.length === 0 && conn?.kind !== "loading" && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "tb-model-empty", children: "没有拿到模型列表，可在设置里手填模型名" }),
            rowModels.map((m2) => {
              const on = m2 === modelLabel;
              return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "button",
                {
                  type: "button",
                  role: "option",
                  "aria-selected": on,
                  className: "tb-model-row" + (on ? " on" : ""),
                  disabled: picking !== null,
                  onClick: (e) => {
                    stop(e);
                    pickModel(m2);
                  },
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-model-row-name", title: m2, children: m2 }),
                    picking === m2 ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-spin", "aria-hidden": "true" }) : on && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-model-row-ck", "aria-hidden": "true", children: "✓" })
                  ]
                },
                m2
              );
            })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tb-pop-foot", children: /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "tb-pop-settings",
              onClick: (e) => {
                stop(e);
                seqRef.current++;
                setPopOpen(false);
                onOpenSettings?.();
              },
              children: "⚙ 打开模型设置"
            }
          ) })
        ] })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-theme-wrap", ref: themeRef, children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            className: "pill-tab tb-pick tb-theme" + (themeOpen ? " open" : ""),
            type: "button",
            title: "界面主题",
            "aria-haspopup": "listbox",
            "aria-expanded": themeOpen,
            onClick: () => setThemeOpen((v2) => !v2),
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-ic", children: "◐" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-theme-name", children: THEME_ITEMS.find((t2) => t2.id === theme)?.label ?? "主题" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-cv", children: "▾" })
            ]
          }
        ),
        themeOpen && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tb-theme-pop", role: "listbox", "aria-label": "界面主题", children: THEME_ITEMS.map((t2) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "button",
          {
            type: "button",
            role: "option",
            "aria-selected": theme === t2.id,
            className: "tb-theme-row" + (theme === t2.id ? " on" : ""),
            onClick: (e) => {
              e.stopPropagation();
              pickTheme(t2.id);
            },
            children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: `tb-theme-swatch st-${t2.id}`, "aria-hidden": "true" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-theme-row-label", children: t2.label }),
              theme === t2.id && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-theme-row-ck", "aria-hidden": "true", children: "✓" })
            ]
          },
          t2.id
        )) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs(
        "button",
        {
          className: "pill-tab tb-pick tb-pill" + (autoRead ? " on" : ""),
          type: "button",
          title: autoRead ? "自动朗读已开启，点击关闭" : "自动朗读已关闭，点击开启",
          "aria-pressed": autoRead,
          onClick: toggleAutoRead,
          children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-ic", children: "🔊" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: autoRead ? "自动朗读·已开启" : "自动朗读·已关闭" })
          ]
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { className: "pill-tab tb-pick", type: "button", title: "工作区", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tb-ic tb-ic-folder", children: "▮" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { children: "workspace" })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tb-right", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "tb-clock", children: [
        hh2,
        ":",
        mm
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "titlebar-btn", type: "button", "aria-label": "最小化", onClick: onMinimize, children: /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { width: "11", height: "11", viewBox: "0 0 12 12", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M2 6h8", stroke: "currentColor", strokeWidth: "1.1", strokeLinecap: "round" }) }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "button",
        {
          className: "titlebar-btn",
          type: "button",
          "aria-label": maximized ? "还原" : "最大化",
          onClick: () => {
            onToggleMaximize?.();
            setMaximized((v2) => !v2);
          },
          children: maximized ? /* @__PURE__ */ jsxRuntimeExports.jsxs("svg", { width: "11", height: "11", viewBox: "0 0 12 12", "aria-hidden": "true", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "2.5", y: "3.5", width: "6", height: "6", rx: "1", stroke: "currentColor", strokeWidth: "1.1", fill: "none" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M4.5 3.5V2.5h5v5h-1", stroke: "currentColor", strokeWidth: "1.1", fill: "none" })
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { width: "11", height: "11", viewBox: "0 0 12 12", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("rect", { x: "2.5", y: "2.5", width: "7", height: "7", rx: "1.2", stroke: "currentColor", strokeWidth: "1.1", fill: "none" }) })
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "titlebar-btn close", type: "button", "aria-label": "关闭", onClick: onClose, children: /* @__PURE__ */ jsxRuntimeExports.jsx("svg", { width: "11", height: "11", viewBox: "0 0 12 12", "aria-hidden": "true", children: /* @__PURE__ */ jsxRuntimeExports.jsx("path", { d: "M3 3l6 6M9 3l-6 6", stroke: "currentColor", strokeWidth: "1.1", strokeLinecap: "round" }) }) })
    ] })
  ] });
}
