// @ts-nocheck
/* 从 out/renderer 构建产物恢复的源文件（自动重建，保留原始逻辑；全局角色头像同步由 getEffectiveAgentAvatar 提供） */
import './workspace-pages.css'
import * as reactExports from 'react'
import * as jsxRuntimeExports from 'react/jsx-runtime'
import { getAgentRole } from '../utils/agentRoles'
import { AGENT_ROLES } from '../utils/agentRoles'
import { getTheme } from '../utils/uiPrefs'
import { getAgentAvatar, getAgentHero } from '../utils/uiPrefs'
import { setAgentAvatar, setAgentHero } from '../utils/uiPrefs'
import { ButterflyDefs } from '../components/ButterflySymbol'
import Motes from '../components/Motes'
import Rail from '../components/Rail'
import { getEffectiveAgentAvatar, getEffectiveAgentHero } from '../utils/agentRoles'
import { AGENT_ROLE_LIST } from '../utils/agentRoles'
import { setAgentRole } from '../utils/agentRoles'
import AvatarCropModal from '../components/AvatarCropModal'
import AssetPickerModal from '../components/AssetPickerModal'
export default AgentPage

function AgentPage({ onHome, onChat, onTasks, onOpenSettings, onOpenProfile, onDocs, onMemory, onCommand }) {
  const [roleId, setRoleId] = reactExports.useState(() => getAgentRole().id);
  const [selectedId, setSelectedId] = reactExports.useState(() => getAgentRole().id);
  const [, setTick] = reactExports.useState(0);
  const [cropOpen, setCropOpen] = reactExports.useState(false);
  const [cropImage, setCropImage] = reactExports.useState(null);
  const fileRef = reactExports.useRef(null);
  const [heroCropOpen, setHeroCropOpen] = reactExports.useState(false);
  const [heroCropImage, setHeroCropImage] = reactExports.useState(null);
  const heroFileRef = reactExports.useRef(null);
  const [assetAvatarOpen, setAssetAvatarOpen] = reactExports.useState(false);
  const [assetHeroOpen, setAssetHeroOpen] = reactExports.useState(false);
  reactExports.useEffect(() => {
    const onRole = () => {
      const rid = getAgentRole().id;
      setRoleId(rid);
      setSelectedId(rid);
      setTick((n2) => n2 + 1);
    };
    const onAvatar = () => setTick((n2) => n2 + 1);
    const onHero = () => setTick((n2) => n2 + 1);
    window.addEventListener("sk:agent-role", onRole);
    window.addEventListener("sk:agent-avatar-changed", onAvatar);
    window.addEventListener("sk:agent-hero-changed", onHero);
    return () => {
      window.removeEventListener("sk:agent-role", onRole);
      window.removeEventListener("sk:agent-avatar-changed", onAvatar);
      window.removeEventListener("sk:agent-hero-changed", onHero);
    };
  }, []);
  const current = AGENT_ROLES[roleId];
  const themeNow = getTheme();
  const hasCustom = Boolean(getAgentAvatar(roleId));
  const hasCustomHero = Boolean(getAgentHero(roleId));
  function onAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCropImage(String(reader.result ?? ""));
      setCropOpen(true);
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsDataURL(file);
  }
  function onCropConfirm(dataUrl) {
    setAgentAvatar(roleId, dataUrl);
    setCropOpen(false);
    setCropImage(null);
    setTick((n2) => n2 + 1);
  }
  function resetAvatar() {
    setAgentAvatar(roleId, "");
    setTick((n2) => n2 + 1);
  }
  function onHeroFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      setHeroCropImage(String(reader.result ?? ""));
      setHeroCropOpen(true);
      if (heroFileRef.current) heroFileRef.current.value = "";
    };
    reader.readAsDataURL(file);
  }
  function onHeroCropConfirm(dataUrl) {
    setAgentHero(roleId, dataUrl);
    setHeroCropOpen(false);
    setHeroCropImage(null);
    setTick((n2) => n2 + 1);
  }
  function resetHero() {
    setAgentHero(roleId, "");
    setTick((n2) => n2 + 1);
  }
  function pickAvatarAsset(item) {
    setAgentAvatar(roleId, item.url);
    setAssetAvatarOpen(false);
    setTick((n2) => n2 + 1);
  }
  function pickHeroAsset(item) {
    setAgentHero(roleId, item.url);
    setAssetHeroOpen(false);
    setTick((n2) => n2 + 1);
  }
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-page-app", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(ButterflyDefs, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Motes, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Rail,
      {
        active: "agent",
        onHome,
        onChat,
        onTasks,
        onAgent: () => void 0,
        onToggleDocs: onDocs,
        onToggleMemory: onMemory,
        onSettings: onOpenSettings,
        onOpenProfile,
        onCommand
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "page-main", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("header", { className: "page-head", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "page-title", children: "Agent 档案" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "page-sub", children: "当前陪伴你的角色与它拥有的能力。" })
      ] }) }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-page-body", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "page-card", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-hero", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-hero-avatar", children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: getEffectiveAgentAvatar(roleId), alt: current.name }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-hero-meta", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-hero-name", children: current.name }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-hero-en", children: roleId === "kindmita" ? "KIND MITA" : roleId === "mornye" ? "MORNYE" : roleId === "silverwolf" ? "SILVER WOLF" : "SHOREKEEPER" }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-hero-tags", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "agent-tag", children: [
                  "📍 ",
                  current.location
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "agent-tag", children: [
                  "🎨 主题 ",
                  current.defaultTheme === "sky" ? "守岸蓝" : current.defaultTheme === "mita" ? "米塔紫" : current.defaultTheme === "silverwolf" ? "银狼紫" : "星炬紫"
                ] }),
                themeNow === current.defaultTheme && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-tag current", children: "当前使用中" })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-hero-ops", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "doc-tb-btn", onClick: () => fileRef.current?.click(), children: "更换头像" }),
              hasCustom && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "doc-tb-btn", onClick: resetAvatar, children: "恢复默认" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "doc-tb-btn", onClick: () => heroFileRef.current?.click(), children: "更换背景卡" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "doc-tb-btn", onClick: () => setAssetAvatarOpen(true), children: "素材库 · 头像" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "doc-tb-btn", onClick: () => setAssetHeroOpen(true), children: "素材库 · 背景卡" }),
              hasCustomHero && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "doc-tb-btn", onClick: resetHero, children: "恢复默认背景" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { ref: fileRef, type: "file", accept: "image/*", style: { display: "none" }, onChange: onAvatarFile }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("input", { ref: heroFileRef, type: "file", accept: "image/*", style: { display: "none" }, onChange: onHeroFile })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "agent-footnote", children: "上传后先拖动 / 缩放把圆框对准想要的头像区域（圆外为半透明区域），确认后该角色的头像全局生效（对话界面等）。" })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "page-card", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-caps-title", children: [
            "角色档案",
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-profile-src", children: "来源：游戏官方 / 官方社区可检索资料 · 未公布项以 — 表示" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-profile", children: current.profile.map((it) => jsxRuntimeExports.jsxs("div", { className: "agent-profile-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-profile-label", children: it.label }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-profile-value" + (it.value ? "" : " empty"), children: it.value || "—（官方未公布）" })
          ] }, it.label)) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "page-card", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-switch-title", children: "选择陪伴你的角色" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-switch-grid", children: AGENT_ROLE_LIST.map((r2) => {
            const active = r2.id === roleId;
            const picked = r2.id === selectedId;
            return /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "agent-switch-card" + (active ? " on" : "") + (picked && !active ? " pick" : ""),
                onClick: () => {
                  setSelectedId(r2.id);
                },
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("img", { className: "agent-switch-avatar", src: getEffectiveAgentAvatar(r2.id), alt: r2.name }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-switch-info", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-switch-name", children: r2.name }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-switch-loc", children: r2.location })
                  ] }),
                  active ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-switch-check", children: "✓ 使用中" }) : picked ? /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "agent-switch-use", onClick: (e) => {
                    e.stopPropagation();
                    setAgentRole(r2.id);
                  }, children: ["使用"] }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-switch-pickhint", children: "点击选中" })
                ]
              },
              r2.id
            );
          }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "page-card", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-caps-title", children: "当前已接入的能力" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-caps", children: CAPABILITIES.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-cap", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "agent-cap-ic", "aria-hidden": "true", children: c.ic }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "agent-cap-text", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-cap-name", children: c.name }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "agent-cap-desc", children: c.desc })
            ] })
          ] }, c.name)) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "agent-footnote", children: "切换角色后：名字 / 头像 / 主题 / 招呼词 / 语音参考音频都会同步切换；对话存档保持各自角色不变。" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      AvatarCropModal,
      {
        open: cropOpen,
        image: cropImage,
        dimOutside: true,
        onClose: () => {
          setCropOpen(false);
          setCropImage(null);
        },
        onConfirm: onCropConfirm
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      AvatarCropModal,
      {
        open: heroCropOpen,
        image: heroCropImage,
        dimOutside: true,
        shape: "rect",
        rectRatio: 1.78,
        outWidth: 1000,
        outHeight: 560,
        onClose: () => {
          setHeroCropOpen(false);
          setHeroCropImage(null);
        },
        onConfirm: onHeroCropConfirm
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      AssetPickerModal,
      {
        open: assetAvatarOpen,
        kind: "image",
        title: "素材库 · 选择头像",
        onClose: () => setAssetAvatarOpen(false),
        onPick: pickAvatarAsset
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      AssetPickerModal,
      {
        open: assetHeroOpen,
        kind: "image",
        title: "素材库 · 选择背景卡",
        onClose: () => setAssetHeroOpen(false),
        onPick: pickHeroAsset
      }
    )
  ] });
}

const CAPABILITIES = [
  { ic: "◈", name: "对话与陪伴", desc: "聊天 / Agent 双模式，多轮记忆上下文延续" },
  { ic: "⚙", name: "工具调用", desc: "内置浏览器、终端与工作区文件，agent 可实际执行" },
  { ic: "▤", name: "任务管理", desc: "创建任务、执行进度、截止提醒，与对话联动" },
  { ic: "♒", name: "记忆库", desc: "你手写的记忆条目，会在对话时自动注入给 agent" },
  { ic: "◗", name: "语音朗读", desc: "IndexTTS 克隆音色，逐字回复 + 语音同步" },
  { ic: "♫", name: "音乐陪伴", desc: "全局播放器与快捷键，歌单随机 / 单曲循环" },
  { ic: "☀", name: "主动关怀", desc: "本地规则判断，不说空话的问候与提醒" }
];
