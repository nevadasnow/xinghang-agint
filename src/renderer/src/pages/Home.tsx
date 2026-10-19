// @ts-nocheck
/* 从 out/renderer 构建产物恢复的源文件（自动重建，保留原始逻辑；全局角色头像同步由 getEffectiveAgentAvatar 提供） */
import './home.css'
import * as reactExports from 'react'
import * as jsxRuntimeExports from 'react/jsx-runtime'
import { getAgentRole } from '../utils/agentRoles'
import { greetingFor } from '../utils/agentRoles'
import { getEffectiveAgentAvatar, getEffectiveAgentHero } from '../utils/agentRoles'
import Motes from '../components/Motes'
import { ButterflyDefs } from '../components/ButterflySymbol'
import Rail from '../components/Rail'
import ModeSwitcher from '../components/ModeSwitcher'
import MusicCard from '../components/MusicCard'
export default Home

function Home({ onStart, onAsk, config, onOpenSettings, onOpenProfile, onTasks, onAgent, onDocs, onMemory, onCommand }) {
  const [sessions, setSessions] = reactExports.useState([]);
  const [reminders, setReminders] = reactExports.useState([]);
  const [seg, setSeg] = reactExports.useState("chat");
  const [now, setNow] = reactExports.useState(() => /* @__PURE__ */ new Date());
  const [remDraft, setRemDraft] = reactExports.useState(null);
  const [askText, setAskText] = reactExports.useState("");
  const [role, setRole] = reactExports.useState(() => getAgentRole());
  const greet = greetingFor(now.getHours());
  reactExports.useEffect(() => {
    const onRole = () => setRole(getAgentRole());
    const onAvatar = () => setRole((r2) => ({ ...r2 }));
    const onHero = () => setRole((r2) => ({ ...r2 }));
    window.addEventListener("sk:agent-role", onRole);
    window.addEventListener("sk:agent-avatar-changed", onAvatar);
    window.addEventListener("sk:agent-hero-changed", onHero);
    return () => {
      window.removeEventListener("sk:agent-role", onRole);
      window.removeEventListener("sk:agent-avatar-changed", onAvatar);
      window.removeEventListener("sk:agent-hero-changed", onHero);
    };
  }, []);
  reactExports.useEffect(() => {
    window.shorekeeper.listSessions().then(setSessions);
    window.shorekeeper.remindersList().then(setReminders).catch(() => setReminders([]));
  }, []);
  function addReminder() {
    setRemDraft({ id: "", text: "", time: "19:00", repeat: "once" });
  }
  function editReminder(r2) {
    const d = /* @__PURE__ */ new Date(r2.at);
    setRemDraft({
      id: r2.id,
      text: r2.text,
      time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()),
      repeat: r2.repeat === "daily" ? "daily" : "once"
    });
  }
  async function saveReminderDraft() {
    const text = String(remDraft?.text ?? "").trim();
    if (!text) return;
    const m2 = /^(\d{1,2}):(\d{2})$/.exec(String(remDraft.time || ""));
    let at = Date.now() + 36e5;
    if (m2) {
      const d = /* @__PURE__ */ new Date();
      d.setHours(Number(m2[1]), Number(m2[2]), 0, 0);
      if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
      at = d.getTime();
    }
    try {
      const next = await window.shorekeeper.remindersSave({
        id: remDraft.id || void 0,
        text,
        at,
        repeat: remDraft.repeat === "daily" ? "daily" : "once",
        enabled: true
      });
      setReminders(next);
      setRemDraft(null);
    } catch {
    }
  }
  async function toggleReminder(r2) {
    try {
      setReminders(await window.shorekeeper.remindersToggle(r2.id, !r2.enabled));
    } catch {
    }
  }
  async function deleteReminder(r2) {
    try {
      setReminders(await window.shorekeeper.remindersDelete(r2.id));
    } catch {
    }
  }
  reactExports.useEffect(() => {
    const t2 = window.setInterval(() => setNow(/* @__PURE__ */ new Date()), 1e3);
    return () => window.clearInterval(t2);
  }, []);
  const clock = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
  const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${WEEK[now.getDay()]}`;
  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const connected = Boolean(config?.configured);
  function onChangeSeg(m2) {
    setSeg(m2);
    onStart(m2);
  }
  const reminderModal = remDraft
    ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "reminder-modal", onClick: () => setRemDraft(null), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "reminder-card", onClick: (e) => e.stopPropagation(), children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "reminder-title", children: remDraft.id ? "编辑提醒" : "添加提醒" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("input", { className: "field-input", placeholder: "提醒内容（例如：晚上八点喝水）", value: remDraft.text, autoFocus: true, onChange: (e) => setRemDraft((d) => ({ ...d, text: e.target.value })), onKeyDown: (e) => { if (e.key === "Enter") void saveReminderDraft(); } }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "reminder-row", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("input", { type: "time", className: "field-input", value: remDraft.time, onChange: (e) => setRemDraft((d) => ({ ...d, time: e.target.value })) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "reminder-repeat", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "seg-btn" + (remDraft.repeat === "once" ? " on" : ""), onClick: () => setRemDraft((d) => ({ ...d, repeat: "once" })), children: "一次" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "seg-btn" + (remDraft.repeat === "daily" ? " on" : ""), onClick: () => setRemDraft((d) => ({ ...d, repeat: "daily" })), children: "每日" })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "reminder-actions", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost btn-sm", onClick: () => setRemDraft(null), children: "取消" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-primary btn-sm", onClick: () => void saveReminderDraft(), children: "保存" })
          ] })
        ] })
      ] })
    : null;
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "home", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsxs("h1", { className: "sr-only", children: [
      role.name,
      " · 首页"
    ] }),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Motes, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsx(ButterflyDefs, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsx(
      Rail,
      {
        active: "home",
        onHome: () => void 0,
        onChat: () => onStart("chat"),
        chatCount: sessions.length,
        taskCount: reminders.filter((r2) => r2.enabled).length,
        onTasks,
        onSettings: onOpenSettings,
        onOpenProfile,
        onAgent,
        onToggleDocs: onDocs,
        onToggleMemory: onMemory,
        onCommand
      }
    ),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "main", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "topbar", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "seg-wrap", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ModeSwitcher, { mode: seg, onChange: onChangeSeg }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "top-right", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "clock", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "t", children: clock }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "d", children: date })
        ] }) })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "body", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "ask", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              className: "ask-input",
              value: askText,
              onChange: (e) => setAskText(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const text = askText.trim();
                  if (text) {
                    setAskText("");
                    if (onAsk) onAsk(text);
                    else onStart("chat");
                  }
                }
              },
              placeholder: "想聊什么？直接说，我会接着上次的话题……",
              "aria-label": "想聊什么"
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hint", children: "Enter" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "go",
              "aria-label": "发送",
              title: "发送并开始对话",
              onClick: () => {
                const text = askText.trim();
                if (!text) return;
                setAskText("");
                if (onAsk) onAsk(text);
                else onStart("chat");
              },
              children: "➤"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "cols", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "col", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "card hero-card", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "hero-bg", style: { backgroundImage: `url(${getEffectiveAgentHero(role.id)})` }, "aria-hidden": "true" }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "hero-veil", "aria-hidden": "true" }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "hero-content", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("img", { className: "hero-avatar", src: getEffectiveAgentAvatar(role.id), alt: role.name, draggable: false }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "hero-text", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card-h hero-card-h", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "hero-name", children: role.name }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "card-x", children: role.location })
                  ] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "hero-greet", children: greet[0] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "hero-greet dim", children: greet[1] }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "hero-tags", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tag on-img", children: "心境 · 平静" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tag on-img", children: "记忆 12 条 · 示意" })
                  ] })
                ] })
              ] })
            ] }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "card grow", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card-h", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "card-t", children: "今日提醒" }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "card-x", children: [
                  reminders.filter((r2) => r2.enabled && (r2.repeat === "daily" || isToday(r2.at, now))).length,
                  " 个今日待触发"
                ] })
              ] }),
              reminders.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "recent-empty", children: "还没有提醒。跟我说「明天早上提醒我喝水」，我会记住。" }),
              sortReminders(reminders).map((r2) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rtask" + (r2.enabled ? "" : " off") + (r2.repeat !== "daily" && r2.at < now.getTime() ? " past" : ""), children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "rtask-time", "aria-hidden": "true", children: [
                  remindTime(r2, now),
                  r2.repeat !== "daily" && r2.at < now.getTime() ? " · 已过" : ""
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rtask-main", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "rtask-t", children: r2.text }),
                  r2.repeat === "daily" && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "rtask-daily", children: "每日" })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "rtask-ops", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      className: "rtask-toggle" + (r2.enabled ? " on" : ""),
                      role: "switch",
                      "aria-checked": r2.enabled,
                      "aria-label": r2.enabled ? "暂停提醒" : "启用提醒",
                      title: r2.enabled ? "暂停" : "启用",
                      onClick: () => void toggleReminder(r2)
                    }
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      className: "rtask-edit",
                      "aria-label": "编辑提醒",
                      title: "编辑",
                      onClick: () => editReminder(r2),
                      children: "✎"
                    }
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      className: "rtask-del",
                      "aria-label": "删除提醒",
                      title: "删除",
                      onClick: () => void deleteReminder(r2),
                      children: "✕"
                    }
                  )
                ] })
              ] }, r2.id)),
              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "rtask-add", onClick: () => void addReminder(), children: "＋ 添加提醒" })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "col", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "card grow col-stack", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card-h", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "card-t", children: "最近对话" }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "card-x", children: [
                sessions.length,
                " 个会话"
              ] })
            ] }),
            recent.length === 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "recent-empty", children: "还没有会话记录" }),
            recent.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "recent", onClick: () => onStart(s.mode), children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "m", "aria-hidden": "true", children: MODE_META[s.mode].icon }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "t", children: s.title }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "w", children: relTime(s.updatedAt) })
            ] }, s.id)),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "quick-wrap", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "quick", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("button", { type: "button", className: "qbtn", onClick: () => onStart("chat"), children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ic", "aria-hidden": "true", children: "＋" }),
                "新建对话"
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "button",
                {
                  type: "button",
                  className: "qbtn",
                  onClick: () => window.alert("记忆库尚未接入，先留入口。"),
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "ic", "aria-hidden": "true", children: "✦" }),
                    "记忆库"
                  ]
                }
              )
            ] }) })
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "col", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(MusicCard, {}),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("section", { className: "card grow", children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "card-h", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "card-t", children: "本机状态" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "card-x", children: "Windows · 示意值" })
              ] }),
              STATS.map((s) => /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-n", children: s.name }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "bar", children: /* @__PURE__ */ jsxRuntimeExports.jsx("i", { className: s.hi ? "hi" : void 0, style: { width: `${s.pct}%` } }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-v", children: s.value })
              ] }, s.name)),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat-sep", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat flat", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-n", children: "模型" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-v", children: connected ? config?.model : "未配置" })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat flat", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-n", children: "本次会话" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-v", children: "12.4k tokens" })
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat flat last", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-n", children: "工具调用" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stat-v", children: "8 次 · 全部成功" })
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "demo-note", children: [
                "CPU / 内存 / 显卡 / 磁盘 / tokens 均为",
                /* @__PURE__ */ jsxRuntimeExports.jsx("b", { children: "静态示意" }),
                "，主进程尚未提供统计接口。"
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "stat-foot", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "pill", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "dot ok" }),
                  "运行正常"
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "pill", children: [
                  "会话 ",
                  sessions.length,
                  " 个"
                ] })
              ] })
            ] })
          ] })
        ] })
      ] }),
      reminderModal
    ] })
  ] });
}

function pad2(n2) {
  return n2 < 10 ? "0" + n2 : String(n2);
}

const WEEK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function sortReminders(rs) {
  return [...rs].sort((a, b) => a.at - b.at);
}

function isToday(ts, now) {
  const d = /* @__PURE__ */ new Date(ts);
  const n = /* @__PURE__ */ new Date(now);
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function remindTime(r2, now) {
  const d = new Date(r2.at);
  const hm = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  if (r2.repeat === "daily") return hm;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const that = new Date(r2.at);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 864e5);
  if (diff === 0) return hm;
  if (diff === 1) return "明天 " + hm;
  return d.getMonth() + 1 + "-" + pad2(d.getDate()) + " " + hm;
}

const MODE_META = {
  chat: { label: "聊天", icon: "◈", desc: "陪伴与对话" },
  code: { label: "代码", icon: "</>", desc: "编程助手" },
  work: { label: "工作", icon: "▤", desc: "办公助手" }
};

function relTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 6e4) return "刚刚";
  if (diff < 36e5) return Math.floor(diff / 6e4) + "m";
  if (diff < 864e5) return Math.floor(diff / 36e5) + "h";
  if (diff < 1728e5) return "昨天";
  const d = new Date(ts);
  return `${d.getMonth() + 1}-${pad2(d.getDate())}`;
}

const STATS = [
  { name: "CPU", pct: 34, value: "34%" },
  { name: "内存", pct: 61, value: "9.8G" },
  { name: "显卡", pct: 78, value: "78%", hi: true },
  { name: "磁盘 D:", pct: 47, value: "412G" }
];
