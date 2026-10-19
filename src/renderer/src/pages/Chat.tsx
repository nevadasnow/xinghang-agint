// @ts-nocheck
/* 从 out/renderer 构建产物恢复的源文件（自动重建，保留原始逻辑；全局角色头像同步由 getEffectiveAgentAvatar 提供） */
import './chat.css'
import * as reactExports from 'react'
import * as jsxRuntimeExports from 'react/jsx-runtime'
import { getAgentRole } from '../utils/agentRoles'
import { getEffectiveAgentAvatar } from '../utils/agentRoles'
import { useOrg } from '../state/org'
import { getUserProfile } from '../utils/uiPrefs'
import { useAutoRead } from '../utils/useAutoRead'
import { useVoiceInput } from '../utils/useVoiceInput'
import { useChatSearch } from '../utils/useChatSearch'
import { useToast } from '../components/Toast'
import { currentDayPart } from '../utils/uiPrefs'
import { AGENT_ROLES } from '../utils/agentRoles'
import { UNSORTED } from '../state/org'
import { DEFAULT_USER_NAME } from '../utils/uiPrefs'
import { ButterflyDefs } from '../components/ButterflySymbol'
import Motes from '../components/Motes'
import Rail from '../components/Rail'
import ModeSwitcher from '../components/ModeSwitcher'
import ChatDisplaySettingsModal from '../components/ChatDisplaySettingsModal'
import Butterfly from '../components/Butterfly'
import ChatAvatar from '../components/ChatAvatar'
import ToolCallCard from '../components/ToolCallCard'
import Markdown from '../components/Markdown'
import RightPanel from '../components/RightPanel'
import { requestBrowserOpen } from '../utils/browserBridge'
export default Chat

/** 项目根目录（电脑操作-项目文件夹面板默认操作对象） */
const PROJECT_ROOT = "D:\\Shorekeeper-Agent-Dev";

/** 线条图标（治愈简约，随主题色）：显示设置=调节滑块 / 项目文件夹=文件夹 / 本机权限=盾牌 */
const IcSliders = jsxRuntimeExports.jsx("svg", { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [
  jsxRuntimeExports.jsx("line", { x1: "4", y1: "21", x2: "4", y2: "14" }),
  jsxRuntimeExports.jsx("line", { x1: "4", y1: "10", x2: "4", y2: "3" }),
  jsxRuntimeExports.jsx("line", { x1: "12", y1: "21", x2: "12", y2: "12" }),
  jsxRuntimeExports.jsx("line", { x1: "12", y1: "8", x2: "12", y2: "3" }),
  jsxRuntimeExports.jsx("line", { x1: "20", y1: "21", x2: "20", y2: "16" }),
  jsxRuntimeExports.jsx("line", { x1: "20", y1: "12", x2: "20", y2: "3" }),
  jsxRuntimeExports.jsx("line", { x1: "1", y1: "14", x2: "7", y2: "14" }),
  jsxRuntimeExports.jsx("line", { x1: "9", y1: "8", x2: "15", y2: "8" }),
  jsxRuntimeExports.jsx("line", { x1: "17", y1: "16", x2: "23", y2: "16" })
] });
const IcFolder = jsxRuntimeExports.jsx("svg", { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [jsxRuntimeExports.jsx("path", { d: "M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" })] });
const IcShield = jsxRuntimeExports.jsx("svg", { width: "1em", height: "1em", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: [jsxRuntimeExports.jsx("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" })] });

function Chat({
  mode,
  onChangeMode,
  onHome,
  config,
  onOpenSettings,
  onOpenProfile,
  onTasks,
  bootPrompt,
  onBootPromptConsumed,
  onAgent,
  onDocs,
  onMemory,
  newSessionSignal,
  onCommand
}) {
  const [role, setRole] = reactExports.useState(() => getAgentRole());
  reactExports.useEffect(() => {
    const onRole = () => setRole(getAgentRole());
    const onAvatar = () => setRole((r2) => ({ ...r2 }));
    window.addEventListener("sk:agent-role", onRole);
    window.addEventListener("sk:agent-avatar-changed", onAvatar);
    return () => {
      window.removeEventListener("sk:agent-role", onRole);
      window.removeEventListener("sk:agent-avatar-changed", onAvatar);
    };
  }, []);
  const [sessions, setSessions] = reactExports.useState([]);
  const [currentId, setCurrentId] = reactExports.useState(null);
  const [messages, setMessages] = reactExports.useState([]);
  const [input, setInput] = reactExports.useState("");
  const [sending, setSending] = reactExports.useState(false);
  const [liveReasoning, setLiveReasoning] = reactExports.useState("");
  const [liveText, setLiveText] = reactExports.useState("");
  const [files, setFiles] = reactExports.useState([]);
  const [dragging, setDragging] = reactExports.useState(false);
  const dragDepth = reactExports.useRef(0);
  const fileContentsRef = reactExports.useRef({});
  const [editIndex, setEditIndex] = reactExports.useState(null);
  const [editDraft, setEditDraft] = reactExports.useState("");
  // 电脑操作（仅 chat / code 模式显示）：项目文件夹面板 + 本机操作权限面板
  const [projectPanelOpen, setProjectPanelOpen] = reactExports.useState(false);
  const [permPanelOpen, setPermPanelOpen] = reactExports.useState(false);
  const [permLevel, setPermLevel] = reactExports.useState(() => {
    try {
      const n = parseInt(localStorage.getItem("sk:permLevel") || "1", 10);
      return n >= 1 && n <= 3 ? n : 1;
    } catch {
      return 1;
    }
  });
  const switchPermLevel = (lv) => {
    const n = Math.min(3, Math.max(1, lv));
    setPermLevel(n);
    try {
      localStorage.setItem("sk:permLevel", String(n));
    } catch {}
  };
  const [permPath, setPermPath] = reactExports.useState("");
  const [toolBusy, setToolBusy] = reactExports.useState("");
  const [toolOutput, setToolOutput] = reactExports.useState("");
  const sessionRef = reactExports.useRef(null);
  const messagesRef = reactExports.useRef([]);
  const [displayOpen, setDisplayOpen] = reactExports.useState(false);
  const [sessFold, setSessFold] = reactExports.useState(false);
  const [panelOpen, setPanelOpen] = reactExports.useState(() => {
    try {
      return localStorage.getItem(RP_OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [panelMounted, setPanelMounted] = reactExports.useState(false);
  const [narrow, setNarrow] = reactExports.useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_QUERY).matches
  );
  const [liveCalls, setLiveCalls] = reactExports.useState([]);
  /** 高危操作确认卡（输入框上方）：agent 请求执行危险动作，等待用户允许/拒绝 */
  const [pendingConfirm, setPendingConfirm] = reactExports.useState(null);
  /** agent 提问卡（输入框上方）：agent 向用户提出具体问题，等待回答 */
  const [pendingAsk, setPendingAsk] = reactExports.useState(null);
  const emptyTok = () => ({ rounds: 0, steps: 0, totalTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, lastTokensPerSec: 0, lastPromptTokens: 0, lastAt: 0, byModel: {} });
  const [tokStat, setTokStat] = reactExports.useState(null);
  const tokStatRef = reactExports.useRef(null);
  const org = useOrg();
  const [userProfile, setUserProfile2] = reactExports.useState(() => getUserProfile());
  const autoRead = useAutoRead();
  const voice = useVoiceInput((text) => setInput(text));
  const search = useChatSearch(messages);
  const [searchOpen, setSearchOpen] = reactExports.useState(false);
  reactExports.useEffect(() => {
    function refresh() {
      setUserProfile2(getUserProfile());
    }
    window.addEventListener("sk:user-profile-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("sk:user-profile-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  const [moveModal, setMoveModal] = reactExports.useState(null);
  const [sectOpen, setSectOpen] = reactExports.useState(() => {
    try {
      return {
        pinned: true,
        projects: true,
        recent: true,
        ...JSON.parse(localStorage.getItem("sk-rail-sect") || "{}")
      };
    } catch {
      return { pinned: true, projects: true, recent: true };
    }
  });
  function toggleSect(k2) {
    setSectOpen((prev) => {
      const next = { ...prev, [k2]: !prev[k2] };
      try {
        localStorage.setItem("sk-rail-sect", JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }
  function openMenu(e, kind, payload) {
    e.preventDefault();
    e.stopPropagation();
    setMoveModal(null);
    if (kind === "session") {
      setCtx({ x: e.clientX, y: e.clientY, kind: "session", session: payload });
    } else {
      const b = payload;
      setCtx({ x: e.clientX, y: e.clientY, kind: "project", id: b.id, name: b.name, color: b.color });
    }
  }
  async function togglePin(s) {
    setSessions(await window.shorekeeper.patchSession(s.id, { pinned: !s.pinned }));
  }
  function fmtTime2(ts) {
    const d = new Date(ts);
    const p2 = (n2) => String(n2).padStart(2, "0");
    return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }
  reactExports.useEffect(() => {
    if (!moveModal) return;
    const onDown = (e) => {
      const t2 = e.target;
      if (t2 && !t2.closest(".move-pop")) setMoveModal(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [moveModal]);
  async function removeFromProject(s) {
    setSessions(await window.shorekeeper.patchSession(s.id, { groupId: void 0 }));
  }
  async function forkSession(src) {
    const fork = {
      id: crypto.randomUUID(),
      title: (src.title || "新对话") + "（分叉）",
      mode: src.mode,
      messages: src.messages,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentRole: role.id
    };
    setForkTarget(null);
    setSessions(await window.shorekeeper.saveSession(fork));
    setCurrentId(fork.id);
    setMessages(fork.messages);
    setLiveCalls([]);
    onChangeMode(fork.mode);
  }
  const [nameModal, setNameModal] = reactExports.useState(null);
  const [nameValue, setNameValue] = reactExports.useState("");
  const [nameColor, setNameColor] = reactExports.useState("");
  const [delTarget, setDelTarget] = reactExports.useState(null);
  const [forkTarget, setForkTarget] = reactExports.useState(null);
  const [ctx, setCtx] = reactExports.useState(null);
  const bottomRef = reactExports.useRef(null);
  const taRef = reactExports.useRef(null);
  const toast = useToast();
  const [speaking, setSpeaking] = reactExports.useState(null);
  const [ttsError, setTtsError] = reactExports.useState("");
  const ttsAudioRef = reactExports.useRef(null);
  function playTtsResult(dataUrl) {
    const a = new Audio(dataUrl);
    if (config?.ttsProvider === "indextts") {
      a.playbackRate = Math.min(2, Math.max(0.5, config.indexttsSpeed ?? 1));
      a.volume = Math.min(1, Math.max(0, (config.indexttsVolume ?? 100) / 100));
    }
    ttsAudioRef.current = a;
    a.onended = () => {
      ttsAudioRef.current = null;
      setSpeaking(null);
    };
    a.onerror = () => {
      ttsAudioRef.current = null;
      setSpeaking(null);
      setTtsError("播放失败");
    };
    void a.play().catch(() => {
      ttsAudioRef.current = null;
      setSpeaking(null);
      setTtsError("浏览器未允许自动播放，再点一次");
    });
  }
  function stopAllAudio() {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    if (presentAudioRef.current) {
      presentAudioRef.current.pause();
      presentAudioRef.current = null;
    }
    autoRead.stop();
    setSpeaking(null);
  }
  function toggleSpeak(i, content) {
    // 正在播这条回复 → 再点一下停止（自定义播放/结束）
    if (speaking === String(i) && ttsAudioRef.current) {
      stopAllAudio();
      return;
    }
    // 合成中：忽略连点（避免开第二个合成）
    if (speaking) return;
    // 正在播其他语音 / 边出字边播 → 先全部停止，再智能播放本条（ttsSpeak 优先命中已有缓存）
    const anyPlaying = ttsAudioRef.current || presentAudioRef.current || autoRead.speaking;
    if (anyPlaying) {
      const wasTyping = presentAudioRef.current != null;
      stopAllAudio();
      // 正处于"边出字边播"的回复中：声音停了，但把已生成文字正常落盘，且不再触发自动朗读
      if (wasTyping && sending && pendingAssistantRef.current) {
        presentGen.current++;
        const asst = pendingAssistantRef.current;
        pendingAssistantRef.current = null;
        commitReply(asst, true);
      }
    }
    setTtsError("");
    setSpeaking(String(i));
    window.shorekeeper.ttsSpeak(content, currentDayPart()).then((r2) => {
      if (!r2.ok || !r2.dataUrl) {
        setTtsError(r2.error || "合成失败");
        setSpeaking(null);
        return;
      }
      playTtsResult(r2.dataUrl);
    }).catch(() => {
      setSpeaking(null);
      setTtsError("语音合成请求失败");
    });
  }
  function reSpeak(i, content) {
    // 停止当前所有播放（手动/自动朗读、边出字边播），避免新旧语音叠播
    stopAllAudio();
    // 删除这条回复已有的语音合成缓存，再重新合成
    void window.shorekeeper.ttsCacheDeleteText(content).catch(() => {});
    setTtsError("");
    setSpeaking(String(i));
    window.shorekeeper.ttsSpeak(content, currentDayPart(), true).then((r2) => {
      if (!r2.ok || !r2.dataUrl) {
        setTtsError(r2.error || "合成失败");
        setSpeaking(null);
        return;
      }
      playTtsResult(r2.dataUrl);
    }).catch(() => {
      setSpeaking(null);
      setTtsError("语音合成请求失败");
    });
  }
  function toggleRightPanel(next) {
    setPanelOpen((v2) => {
      const nv = typeof next === "boolean" ? next : !v2;
      try {
        localStorage.setItem(RP_OPEN_KEY, nv ? "1" : "0");
      } catch {
      }
      return nv;
    });
  }
  function openRightPanel() {
    toggleRightPanel(true);
  }
  reactExports.useEffect(() => {
    if (!panelOpen) {
      setPanelMounted(false);
      return;
    }
    const t2 = setTimeout(() => setPanelMounted(true), 150);
    return () => clearTimeout(t2);
  }, [panelOpen]);
  // Agent 请求拉起内置浏览器（browser_open 时主进程发现没有可操作实例）：
  // 打开右侧面板，并交给渲染层总线——RightPanel 切到「浏览器」tab、BrowserPane 建标签页。
  reactExports.useEffect(() => {
    return window.shorekeeper.onBrowserEnsure((url) => {
      openRightPanel();
      requestBrowserOpen(url);
    });
  }, []);
  reactExports.useEffect(() => {
    window.shorekeeper.listSessions().then(setSessions);
  }, []);
  reactExports.useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setNarrow(e.matches);
    setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  reactExports.useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        toggleRightPanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  reactExports.useEffect(() => {
    return window.shorekeeper.onToolEvent((ev) => {
      setLiveCalls((prev) => {
        if (ev.phase === "start") {
          const key = `${ev.round}:${ev.id}`;
          if (prev.some((c) => c.key === key)) return prev;
          return [
            ...prev,
            {
              key,
              trace: { id: ev.id, name: ev.name, label: ev.label, args: ev.args, state: "running" }
            }
          ];
        }
        const idx = prev.findIndex((c) => c.key === `${ev.round}:${ev.id}`);
        if (idx < 0) return prev;
        const next = [...prev];
        next[idx] = {
          key: next[idx].key,
          trace: {
            ...next[idx].trace,
            result: ev.result,
            state: ev.state ?? "done",
            durationMs: ev.durationMs
          }
        };
        return next;
      });
    });
  }, []);
  reactExports.useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  // 流事件订阅只注册一次；若直接引用渲染期的 finishStream，闭包会锁死首次渲染的
  // config（自动朗读开关等），导致中途切换状态不生效。用 ref 始终指向最新函数。
  const finishStreamRef = reactExports.useRef(finishStream);
  finishStreamRef.current = finishStream;
  reactExports.useEffect(() => {
    return window.shorekeeper.onChatStream((ev) => {
      if (ev.type === "reasoning") {
        setLiveReasoning((prev) => prev + ev.text);
      } else if (ev.type === "delta") {
        void ev.text;
      } else if (ev.type === "usage") {
        const cur = tokStatRef.current ?? emptyTok();
        const hit = Math.max(0, Number(ev.usage?.prompt_cache_hit_tokens) || 0);
        const miss = Math.max(0, Number(ev.usage?.prompt_cache_miss_tokens) || 0);
        const promptN = Math.max(0, Number(ev.usage?.prompt_tokens) || 0);
        const compN = Math.max(0, Number(ev.usage?.completion_tokens) || 0);
        const total = Math.max(0, Number(ev.usage?.total_tokens) || (promptN + compN));
        const nextTok = {
          ...cur,
          steps: cur.steps + 1,
          totalTokens: cur.totalTokens + total,
          cacheHitTokens: cur.cacheHitTokens + hit,
          cacheMissTokens: cur.cacheMissTokens + miss,
          lastTokensPerSec: ev.durationMs > 0 ? Math.round(compN / (ev.durationMs / 1000)) : cur.lastTokensPerSec,
          lastPromptTokens: promptN,
          lastAt: Date.now()
        };
        const bm = { ...(nextTok.byModel ?? {}) };
        const mm = bm[ev.model] ?? { calls: 0, tokens: 0 };
        bm[ev.model] = { calls: mm.calls + 1, tokens: mm.tokens + total };
        nextTok.byModel = bm;
        tokStatRef.current = nextTok;
        setTokStat(nextTok);
      } else if (ev.type === "done") {
        finishStreamRef.current(ev.content, ev.reasoning ?? "", ev.toolCalls ?? [], ev.stopped);
      } else if (ev.type === "error") {
        finishStreamRef.current("", "", [], false, ev.message);
      }
    });
  }, []);
  // 高危确认 / agent 提问：订阅一次，用 ref 访问最新卡片，避免闭包锁死
  const pendingConfirmRef = reactExports.useRef(null);
  pendingConfirmRef.current = pendingConfirm;
  const pendingAskRef = reactExports.useRef(null);
  pendingAskRef.current = pendingAsk;
  reactExports.useEffect(() => {
    const offConfirm = window.shorekeeper.onToolConfirm((req) => setPendingConfirm(req));
    const offAsk = window.shorekeeper.onToolAsk((req) => setPendingAsk(req));
    return () => {
      offConfirm();
      offAsk();
    };
  }, []);
  function resolveConfirm(allow) {
    const p = pendingConfirmRef.current;
    if (!p) return;
    setPendingConfirm(null);
    window.shorekeeper.toolConfirmResolve(p.id, Boolean(allow)).catch(() => void 0);
  }
  function submitAsk(answer) {
    const p = pendingAskRef.current;
    if (!p) return;
    setPendingAsk(null);
    window.shorekeeper.toolAskResolve(p.id, String(answer ?? "")).catch(() => void 0);
  }
  const didAutoScroll = reactExports.useRef(false);
  const scrollRaf = reactExports.useRef(0);
  reactExports.useEffect(() => {
    const el2 = bottomRef.current;
    if (!el2) return;
    if (!didAutoScroll.current) {
      didAutoScroll.current = true;
      el2.scrollIntoView({ behavior: "auto" });
      return;
    }
    if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => {
      if (scrollRaf.current) cancelAnimationFrame(scrollRaf.current);
    };
  }, [messages, sending, liveCalls, liveText, liveReasoning]);
  const current = sessions.find((s) => s.id === currentId) ?? null;
  const viewRole = current?.agentRole && AGENT_ROLES[current.agentRole] ? AGENT_ROLES[current.agentRole] : role;
  const pinnedList = reactExports.useMemo(() => sessions.filter((s) => s.pinned), [sessions]);
  const recentList = reactExports.useMemo(() => sessions.filter((s) => !s.pinned && !s.groupId), [sessions]);
  const groupView = reactExports.useMemo(
    () => org.bucketOf(sessions).map((b) => ({
      id: b.id,
      name: b.name,
      color: b.color,
      pinned: b.pinned ?? false,
      isLoose: b.id === UNSORTED,
      items: b.items
    })),
    [org, sessions]
  );
  const projectBuckets = reactExports.useMemo(() => groupView.filter((b) => !b.isLoose), [groupView]);
  function openSession(s) {
    if (s.agentRole && s.agentRole !== role.id) {
      setForkTarget(s);
      return;
    }
    setCurrentId(s.id);
    setMessages(s.messages);
    setLiveCalls([]);
    tokStatRef.current = s.tokenUsage ?? null;
    setTokStat(s.tokenUsage ?? null);
    onChangeMode(s.mode);
  }
  function newSession() {
    setCurrentId(null);
    setMessages([]);
    setLiveCalls([]);
    tokStatRef.current = null;
    setTokStat(null);
    setInput("");
    taRef.current?.focus();
  }
  reactExports.useEffect(() => {
    if (!bootPrompt) return;
    const text = bootPrompt.trim();
    if (!text) return;
    newSession();
    launchSend([], text);
    onBootPromptConsumed?.();
  }, [bootPrompt]);
  reactExports.useEffect(() => {
    if (!newSessionSignal) return;
    newSession();
  }, [newSessionSignal]);
  async function removeSession(id2) {
    await window.shorekeeper.deleteSession(id2);
    setSessions(await window.shorekeeper.listSessions());
    if (currentId === id2) newSession();
  }
  const presentGen = reactExports.useRef(0);
  const stopRequestedRef = reactExports.useRef(false);
  const staleStreamRef = reactExports.useRef(false);
  const pendingAssistantRef = reactExports.useRef(null);
  const presentAudioRef = reactExports.useRef(null);
  const [presenting, setPresenting] = reactExports.useState(null);
  const [synthEst, setSynthEst] = reactExports.useState(0);
  function commitReply(assistant, voicePlayed) {
    setSending(false);
    setLiveText("");
    setPresenting(null);
    setSynthEst(0);
    pendingAssistantRef.current = null;
    const meta = sessionRef.current;
    const next = [...messagesRef.current, assistant];
    setMessages(next);
    if (meta) {
      const session = {
        id: meta.sid,
        title: meta.title,
        mode: meta.mode,
        messages: next,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        agentRole: meta.agentRole,
        tokenUsage: tokStatRef.current ?? void 0
      };
      window.shorekeeper.saveSession(session).then(setSessions).catch(() => void 0);
    }
    if (!voicePlayed && config?.autoRead && assistant.content && !stopRequestedRef.current) {
      autoRead.speak(
        assistant.content,
        config?.ttsProvider === "indextts" ? { rate: config.indexttsSpeed, volume: (config.indexttsVolume ?? 100) / 100 } : void 0
      );
    }
    sessionRef.current = null;
  }
  function typeOut(text, done) {
    const gen = presentGen.current;
    let idx = 1;
    setPresenting("typing");
    setLiveText(text.slice(0, 1));
    const step = () => {
      if (gen !== presentGen.current) return;
      idx += 1;
      if (idx >= text.length) {
        setLiveText(text);
        done();
        return;
      }
      setLiveText(text.slice(0, idx));
      window.setTimeout(step, 28);
    };
    window.setTimeout(step, 28);
  }
  // 回复进行中的状态语：按角色人设显示轻松自然的句子（不再提示"合成语音中"）
  function roleNote(synth) {
    const rid = role.id
    if (synth) {
      return rid === 'mornye' ? '星图展开中，马上就好。'
        : rid === 'kindmita' ? '话在嗓子眼打转了，别急，马上给你。'
        : rid === 'silverwolf' ? '这局语音正在读盘，稍等，马上好。'
        : '潮声里我把话捋顺，就来。'
    }
    return rid === 'mornye' ? '正在对照星图，稍候片刻。'
      : rid === 'kindmita' ? '容我理一理，别催哈。'
      : rid === 'silverwolf' ? '嗯，我在看数据，别催，马上。'
      : '稍等，我在听。'
  }
  function presentReply(assistant, text) {
    const gen = ++presentGen.current;
    pendingAssistantRef.current = assistant;
    setSending(true);
    setLiveReasoning("");
    setLiveText("");
    if (config?.autoRead) {
      setPresenting("synth");
      setSynthEst(Math.max(3, Math.round(text.length * 0.4)));
      const synthTask = window.shorekeeper.ttsSpeak(text, currentDayPart());
      const timeout = new Promise((_r2, rej2) => window.setTimeout(() => rej2(new Error("合成超时")), 120000));
      Promise.race([synthTask, timeout]).then((r2) => {
        if (gen !== presentGen.current) return;
        if (!r2.ok || !r2.dataUrl) {
          toast.err(r2.error || "语音合成失败，已切换为纯文字");
          typeOut(text, () => commitReply(assistant, false));
          return;
        }
        const a = new Audio(r2.dataUrl);
        if (config?.ttsProvider === "indextts") {
          a.playbackRate = Math.min(2, Math.max(0.5, config.indexttsSpeed ?? 1));
          a.volume = Math.min(1, Math.max(0, (config.indexttsVolume ?? 100) / 100));
        }
        presentAudioRef.current = a;
        setPresenting("typing");
        setLiveText(text.slice(0, 1));
        // 出字与语音同步：有时长信息时按播放比例出字；无时长信息（部分 wav）时按
        // 正常中文语速（约 4.2 字/秒）估算渐进，保证文字一字一字出且不超前语音太多
        const speechStart = performance.now();
        const estDurSec = text.length / 4.2;
        const charStep = window.setInterval(() => {
          if (gen !== presentGen.current) return;
          const d = a.duration;
          const ratio = d && isFinite(d) && d > 0
            ? Math.max(0, Math.min(1, a.currentTime / d))
            : Math.max(0, Math.min(1, (performance.now() - speechStart) / 1000 / estDurSec));
          setLiveText(text.slice(0, Math.max(1, Math.min(text.length, Math.floor(text.length * ratio)))));
        }, 80);
        const finish = () => {
          if (gen !== presentGen.current) return;
          window.clearInterval(charStep);
          presentAudioRef.current = null;
          setLiveText(text);
          commitReply(assistant, true);
        };
        a.onended = finish;
        a.onerror = finish;
        void a.play().catch(() => {
          window.clearInterval(charStep);
          if (gen !== presentGen.current) return;
          presentAudioRef.current = null;
          typeOut(text, () => commitReply(assistant, false));
        });
      }).catch((e2) => {
        if (gen !== presentGen.current) return;
        if (String((e2 && e2.message) || e2).includes("超时")) toast.err("语音合成超时，已切换为纯文字");
        typeOut(text, () => commitReply(assistant, false));
      });
      return;
    }
    typeOut(text, () => commitReply(assistant, false));
  }
  function renderTokBar(t) {
    if (!t) return null;
    const tot = t.totalTokens || 0;
    const totS = tot >= 1000000 ? (tot / 1000000).toFixed(tot >= 10000000 ? 0 : 1) + "M tok" : tot.toLocaleString() + " tok";
    const hitTot = (t.cacheHitTokens || 0) + (t.cacheMissTokens || 0);
    const hitS = hitTot > 0 ? Math.round((t.cacheHitTokens / hitTot) * 100) + "%" : "—";
    const ctxW = config?.contextWindowTokens ?? 131072;
    const ctxPct = Math.min(100, Math.round((t.lastPromptTokens / ctxW) * 1000) / 10);
    return t.rounds + "轮" + t.steps + "步·" + t.lastTokensPerSec + " tok/s | " + totS + "·缓存命中" + hitS + " | " + ctxPct + "%（上下文已用）";
  }
  /** 剥离模型输出中残留的行首时间标注（[今天 13:54] 等），兜底防止复述进回复 */
  function stripTimePrefix(text) {
    if (!text) return text;
    return String(text).replace(/^(\s*)\[[^\]\n]*(?:今天|昨天|前天|\d+\s*天前|\d{4}年\d{1,2}月\d{1,2}日)[^\]\n]*\]\s*/gm, "$1");
  }
  function finishStream(content, reasoning, trace, stopped, errorMsg) {
    content = stripTimePrefix(content);
    reasoning = stripTimePrefix(reasoning);
    // 旧流收尾（重新生成前中断的流）：已由新流接管，完全丢弃
    if (staleStreamRef.current) {
      staleStreamRef.current = false;
      setLiveCalls([]);
      setLiveReasoning("");
      setLiveText("");
      return;
    }
    setLiveCalls([]);
    setLiveReasoning("");
    setLiveText("");
    const aiContent = errorMsg ? `（调用失败：${errorMsg}）请到左下角设置里检查模型配置。` : content || (stopped ? "（已停止生成）" : "（模型未返回文本）");
    const assistant = { role: "assistant", content: aiContent, createdAt: Date.now() };
    if (reasoning) assistant.reasoning = reasoning;
    if (trace.length > 0) assistant.toolCalls = trace;
    if (trace.length > 0) {
      const failed = trace.filter((t2) => t2.state === "failed").length;
      if (failed > 0) toast.err(`本轮 ${trace.length} 次工具调用，其中 ${failed} 次失败`);
      else toast.ok(`调用了 ${trace.length} 个工具`);
    }
    if (stopped) toast.info("已停止生成");
    const isRealReply = !errorMsg && !stopped && aiContent.length > 0 && !aiContent.startsWith("（");
    if (isRealReply) {
      presentReply(assistant, aiContent);
      return;
    }
    commitReply(assistant, false);
  }
  async function pickFile() {
    if (sending) return;
    const res = await window.shorekeeper.pickTextFile();
    if (!res.ok) {
      if (!res.canceled) toast.err(res.error ?? "读取失败");
      return;
    }
    fileContentsRef.current[res.name] = res.content;
    setFiles((prev) => prev.some((f2) => f2.name === res.name) ? prev : [...prev, { name: res.name, size: res.size }]);
    // RAG：文件内容入库，之后按话题检索引用，不再每次对话全量携带
    window.shorekeeper.ragSaveDoc(res.name, res.content ?? "").catch(() => void 0);
  }
  async function onDropFiles(list) {
    if (!list || list.length === 0 || sending) return;
    let added = 0;
    for (const f2 of Array.from(list)) {
      const p2 = window.shorekeeper.pathForFile(f2);
      if (!p2) {
        toast.err(`拿不到「${f2.name}」的路径，请改用 ＋ 按钮选择文件`);
        continue;
      }
      const res = await window.shorekeeper.readTextByPath(p2);
      if (!res.ok) {
        toast.err(res.error ?? `无法读取 ${f2.name}`);
        continue;
      }
      const name = res.name ?? f2.name;
      fileContentsRef.current[name] = res.content ?? "";
      setFiles((prev) => prev.some((x2) => x2.name === name) ? prev : [...prev, { name, size: res.size }]);
      // RAG：文件内容入库
      window.shorekeeper.ragSaveDoc(name, res.content ?? "").catch(() => void 0);
      added++;
    }
    if (added > 0) toast.ok(`已添加 ${added} 个文件`);
  }
  function removeFile(idx) {
    const victim = files[idx];
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    if (victim) window.shorekeeper.ragRemoveDoc(victim.name).catch(() => void 0);
  }
  function stop() {
    // ① 边出字边播 / 语音合成中 / 回复播放中（presentReply 流程）：落盘已生成文字，丢弃后续合成与播放
    if (presenting && pendingAssistantRef.current) {
      stopRequestedRef.current = true;
      presentGen.current++;
      const a = presentAudioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      presentAudioRef.current = null;
      autoRead.stop();
      const asst = pendingAssistantRef.current;
      pendingAssistantRef.current = null;
      commitReply(asst, false);
      return;
    }
    // ② 手动朗读 / 自动朗读播放中（非生成流程）：全部停止，不再继续
    const anyPlaying = ttsAudioRef.current || presentAudioRef.current || autoRead.speaking;
    if (anyPlaying) {
      stopRequestedRef.current = true;
      stopAllAudio();
      return;
    }
    // ③ 思考中 / 流式输出中：中断主进程流，收尾不触发语音
    stopRequestedRef.current = true;
    window.shorekeeper.stopChat();
  }
  reactExports.useEffect(() => {
    // 离开聊天界面（切到首页/任务/设置等，Chat 卸载）时：自动停止所有语音播放与进行中的流式回复
    return () => {
      stopAllAudio();
      window.shorekeeper.stopChat();
    };
  }, []);
  async function exportChat() {
    const rows = messages.filter((m2) => m2.role === "user" || m2.role === "assistant");
    if (rows.length === 0) {
      toast.err("当前对话还没有内容");
      return;
    }
    const lines = [];
    lines.push(`# ${currentTitle || role.name + "对话"}`);
    lines.push("");
    lines.push(`> 模式：${MODE_META[mode].label}　·　导出时间：${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}`);
    lines.push("");
    for (const m2 of rows) {
      const who = m2.role === "user" ? userProfile.name || "我" : role.name;
      lines.push(`## ${who}`);
      lines.push("");
      lines.push(typeof m2.content === "string" ? m2.content : "");
      lines.push("");
    }
    const stamp = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const safeTitle = (currentTitle || role.name + "对话").replace(/[\\/:*?"<>|]/g, "_").slice(0, 40);
    const r2 = await window.shorekeeper.saveTextFile({
      defaultName: `${safeTitle}-${stamp}.md`,
      content: lines.join("\n"),
      ext: "md"
    });
    if (r2.ok) toast.ok(`已导出到 ${r2.path}`);
    else if (!r2.canceled) toast.err(r2.error || "导出失败");
  }
  function highlight(text, q2) {
    const needle = q2.trim();
    if (!needle || !text) return text;
    const lower = text.toLowerCase();
    const lowNeedle = needle.toLowerCase();
    const parts = [];
    let from = 0;
    let key = 0;
    for (; ; ) {
      const at = lower.indexOf(lowNeedle, from);
      if (at < 0) break;
      if (at > from) parts.push(text.slice(from, at));
      parts.push(/* @__PURE__ */ jsxRuntimeExports.jsx("mark", { children: text.slice(at, at + needle.length) }, key++));
      from = at + needle.length;
    }
    if (parts.length === 0) return text;
    if (from < text.length) parts.push(text.slice(from));
    return parts;
  }
  function copyMessage(text) {
    window.shorekeeper.copyText(text);
    toast.ok("已复制");
  }
  const [proactive, setProactive] = reactExports.useState(null);
  const proactiveBusyRef = reactExports.useRef(false);
  reactExports.useEffect(() => {
    if (messages.length > 0) {
      setProactive(null);
      return;
    }
    let alive = true;
    proactiveBusyRef.current = true;
    const lastChatAt = sessions.length > 0 ? Math.max(...sessions.map((s) => s.updatedAt || 0)) : void 0;
    void window.shorekeeper.proactiveDecide({
      lastChatAt: lastChatAt || void 0,
      emptySession: true,
      profile: {
        name: userProfile.name,
        bio: userProfile.bio,
        facts: userProfile.facts,
        dates: userProfile.dates,
        enabled: userProfile.profileEnabled
      }
    }).then((s) => {
      if (!alive) return;
      proactiveBusyRef.current = false;
      if (s && !input.trim()) setProactive(s);
    }).catch(() => {
      proactiveBusyRef.current = false;
    });
    return () => {
      alive = false;
    };
  }, [messages.length, sessions.length]);
  function dismissProactive() {
    setProactive(null);
  }
  function regenerate() {
    // ① 若有正在进行的思考 / 输出 / 合成 / 播放：全部停下并丢弃未完成内容，真正做到"全部重来"
    if (sending || speaking || presenting || autoRead.speaking) {
      stopRequestedRef.current = true;
      presentGen.current++;
      const a = presentAudioRef.current;
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      presentAudioRef.current = null;
      autoRead.stop();
      stopAllAudio();
      pendingAssistantRef.current = null;
      if (sending && !presenting) {
        // 思考 / 流式输出中：中断主进程流，并让旧流收尾完全丢弃
        staleStreamRef.current = true;
        window.shorekeeper.stopChat();
      }
    }
    let lastUser = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUser = i;
        break;
      }
    }
    if (lastUser < 0) {
      toast.err("还没有可以重新生成的内容");
      return;
    }
    // 停止一切正在播放的语音，并清理这条回复的语音缓存（避免重新生成后命中旧语音）
    stopAllAudio();
    const lastAi = messages[lastUser + 1];
    if (lastAi && typeof lastAi.content === "string") {
      void window.shorekeeper.ttsCacheDeleteText(lastAi.content).catch(() => {});
    }
    const base = messages.slice(0, lastUser);
    const userMsg = messages[lastUser];
    launchSend(base, typeof userMsg.content === "string" ? userMsg.content : "", userMsg.attachments, true);
    toast.ok("正在重新生成…");
  }
  function startEdit(i) {
    if (sending) return;
    setEditIndex(i);
    setEditDraft(messages[i]?.content ?? "");
  }
  function cancelEdit() {
    setEditIndex(null);
    setEditDraft("");
  }
  function saveEdit() {
    if (editIndex == null) return;
    const i = editIndex;
    const text = editDraft.trim();
    if (!text) return;
    const orig = messages[i];
    const base = messages.slice(0, i);
    setEditIndex(null);
    setEditDraft("");
    launchSend(base, text, orig?.attachments);
  }
  function launchSend(baseMsgs, content, attachments, force) {
    if (sending && !force) return;
    const userMsg = { role: "user", content, createdAt: Date.now() };
    if (attachments && attachments.length > 0) userMsg.attachments = attachments;
    const sid = currentId ?? crypto.randomUUID();
    const msgs = [...baseMsgs, userMsg];
    setMessages(msgs);
    setInput("");
    setFiles([]);
    fileContentsRef.current = {};
    setSending(true);
    stopRequestedRef.current = false;
    setLiveCalls([]);
    setLiveReasoning("");
    setLiveText("");
    const curTok = tokStatRef.current ?? emptyTok();
    tokStatRef.current = { ...curTok, rounds: curTok.rounds + 1, lastAt: Date.now() };
    setTokStat(tokStatRef.current);
    if (!currentId) setCurrentId(sid);
    const titleBase = content.split("\n")[0] || attachments?.[0]?.name || "新对话";
    sessionRef.current = {
      sid,
      title: current?.title ?? (titleBase.length > 16 ? titleBase.slice(0, 16) + "…" : titleBase),
      mode,
      // 新会话绑定当前人设角色；续旧会话保留存档角色（存档头像/名字不变）
      agentRole: current?.agentRole ?? role.id
    };
    window.shorekeeper.sendChat(msgs, mode, currentId ?? void 0, {
      // 默认名「守岸人用户」只是界面占位：不进 prompt，否则模型会真的叫用户「守岸人用户」。
      // 用户没填名字时留空，让模型自然用「你」称呼。
      name: userProfile.name === DEFAULT_USER_NAME ? "" : userProfile.name,
      bio: userProfile.bio,
      facts: userProfile.facts,
      dates: userProfile.dates,
      enabled: userProfile.profileEnabled
    }, current?.agentRole ?? role.id, permLevel).catch((e) => {
      finishStream("", "", [], false, e.message);
    });
  }
  /** 电脑操作：执行只读 / 打开类工具（自检为后台能力，由 agent 在对话中自行调用 system_status） */
  async function runTool(id: string, args?: Record<string, unknown>) {
    setToolBusy(id);
    setToolOutput("");
    try {
      const r = await window.shorekeeper.toolsRun(id, args ?? {});
      setToolOutput(r?.ok ? (r.result ?? "完成") : `失败：${r?.error ?? "未知错误"}`);
    } catch (e) {
      setToolOutput(`调用失败：${(e as Error).message}`);
    } finally {
      setToolBusy("");
    }
  }
  function send() {
    const text = input.trim();
    if (sending) return;
    if (!text && files.length === 0) return;
    let content = text;
    if (files.length > 0) {
      const names = files.map((f2) => f2.name).join("、");
      content = text
        ? `${text}

（已附带文件：${names}。文件内容已存入本地资料库，相关片段会自动检索引用）`
        : `（已附带文件：${names}。文件内容已存入本地资料库，相关片段会自动检索引用）`;
    }
    const attachments = files.length > 0 ? files.map((f2) => ({ name: f2.name, size: f2.size })) : void 0;
    launchSend(messages, content, attachments);
  }
  function autoGrow(e) {
    const el2 = e.target;
    el2.style.height = "auto";
    el2.style.height = Math.min(el2.scrollHeight, 180) + "px";
    if (proactive) dismissProactive();
    setInput(el2.value);
  }
  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  async function submitNameModal() {
    const m2 = nameModal;
    if (!m2) return;
    const name = nameValue.trim();
    setNameModal(null);
    if (m2.kind === "create") {
      if (!name) return;
      await org.createGroup(name, nameColor || void 0);
    } else if (m2.kind === "session-rename") {
      if (!name) return;
      setSessions(await window.shorekeeper.renameSession(m2.id, name));
    } else {
      if (name) await org.patchGroup(m2.id, { name, color: nameColor || void 0 });
      else if (nameColor) await org.patchGroup(m2.id, { color: nameColor });
    }
  }
  function renderSession(s) {
    const ar = s.agentRole && AGENT_ROLES[s.agentRole] ? s.agentRole : null;
    return /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sess-wrap", children: /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        className: "session-item" + (s.id === currentId ? " active" : "") + (s.pinned ? " is-pinned" : ""),
        onClick: () => openSession(s),
        onContextMenu: (e) => openMenu(e, "session", s),
        children: [
          s.pinned && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "session-pin", title: "已置顶", children: "⬆" }),
          ar && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "session-role", title: `和${AGENT_ROLES[ar].name}的对话`, children: /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: getEffectiveAgentAvatar(ar), alt: AGENT_ROLES[ar].name }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "session-mode", children: MODE_META[s.mode].icon }),
          ar && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "session-role-tag", children: AGENT_ROLES[ar].name }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "session-title", children: s.title }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "more-btn",
              title: "更多操作",
              "aria-label": "更多操作",
              onClick: (e) => openMenu(e, "session", s),
              children: "⋯"
            }
          )
        ]
      }
    ) }, s.id);
  }
  const welcome = WELCOME[mode];
  const currentTitle = current?.title ?? (messages.length ? messages[0].content.slice(0, 16) : "");
  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "chat-app", children: [
    /* @__PURE__ */ jsxRuntimeExports.jsx(ButterflyDefs, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsx(Motes, {}),
    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "chat-shell", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        Rail,
        {
          onHome,
          onToggleDocs: onDocs,
          onToggleMemory: onMemory,
          onToggleRightPanel: () => openRightPanel(),
          rightPanelOpen: panelOpen,
          onCommand,
          onAgent,
          onSettings: onOpenSettings,
          onOpenProfile,
          onTasks
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("aside", { className: "sidebar" + (sessFold ? " folded" : ""), children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "side-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "side-title", children: viewRole.name }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "side-count", children: [
            sessions.length,
            " 个会话"
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "side-fold-btn",
              onClick: () => setSessFold((v2) => !v2),
              title: sessFold ? "展开会话区域" : "收纳会话区域",
              "aria-expanded": !sessFold,
              children: sessFold ? "▸" : "▾"
            }
          )
        ] }),
        sessFold ? /* @__PURE__ */ jsxRuntimeExports.jsx(
          "button",
          {
            type: "button",
            className: "side-fold-gear",
            onClick: () => setDisplayOpen((v2) => !v2),
            title: "显示设置（再次点击关闭）",
            "aria-label": "显示设置",
            children: IcSliders
          }
        ) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "side-new-card", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "side-mode", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ModeSwitcher, { mode, onChange: onChangeMode }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "new-chat", onClick: newSession, children: "＋ 新建对话" })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "session-list", children: [
            org.loading && /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "session-empty", children: "正在读取归类……" }),
            !org.loading && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rail-sect" + (sectOpen.pinned ? " open" : ""), children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sect-head", onClick: () => toggleSect("pinned"), children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Chevron, { open: sectOpen.pinned }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sect-title", children: "置顶" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sect-n", children: pinnedList.length })
                ] }),
                sectOpen.pinned && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sect-body", children: pinnedList.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "bucket-empty", children: "暂无置顶对话（在对话的 ⋯ 里选「置顶」）" }) : pinnedList.map((s) => renderSession(s)) })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rail-sect" + (sectOpen.projects ? " open" : ""), children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sect-head", onClick: () => toggleSect("projects"), children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Chevron, { open: sectOpen.projects }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sect-title", children: "项目" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sect-n", children: projectBuckets.length }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      className: "org-add",
                      title: "新建项目",
                      onClick: (e) => {
                        e.stopPropagation();
                        setNameValue("");
                        setNameColor("");
                        setNameModal({ kind: "create" });
                      },
                      children: "＋"
                    }
                  )
                ] }),
                sectOpen.projects && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sect-body", children: projectBuckets.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "bucket-empty", children: "还没有项目，点「＋」新建" }) : projectBuckets.map((b) => {
                  const open = org.open[b.id] ?? true;
                  return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bucket" + (b.pinned ? " is-pinned" : ""), children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bucket-head", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs(
                        "button",
                        {
                          type: "button",
                          className: "bucket-toggle",
                          onClick: () => org.toggleOpen(b.id),
                          "aria-expanded": open,
                          title: b.name,
                          children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsx(Chevron, { open }),
                            b.color ? /* @__PURE__ */ jsxRuntimeExports.jsx("i", { className: "bucket-dot", style: { background: b.color }, "aria-hidden": "true" }) : null,
                            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "bucket-name", children: b.name }),
                            /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "bucket-n", children: b.items.length })
                          ]
                        }
                      ),
                      /* @__PURE__ */ jsxRuntimeExports.jsx(
                        "button",
                        {
                          type: "button",
                          className: "more-btn",
                          title: "项目操作",
                          "aria-label": "项目操作",
                          onClick: (e) => openMenu(e, "project", { id: b.id, name: b.name, color: b.color }),
                          children: "⋯"
                        }
                      )
                    ] }),
                    open && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bucket-body", children: b.items.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "bucket-empty", children: "这个项目还没有会话" }) : b.items.map((s) => renderSession(s)) })
                  ] }, b.id);
                }) })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "rail-sect" + (sectOpen.recent ? " open" : ""), children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "sect-head", onClick: () => toggleSect("recent"), children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(Chevron, { open: sectOpen.recent }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sect-title", children: "最近" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "sect-n", children: recentList.length })
                ] }),
                sectOpen.recent && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "sect-body", children: recentList.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "bucket-empty", children: "暂无对话" }) : recentList.map((s) => renderSession(s)) })
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "side-foot", children: /* @__PURE__ */ jsxRuntimeExports.jsx("button", { className: "btn-ghost foot-btn", onClick: () => setDisplayOpen((o) => !o), children: [IcSliders, " 显示设置"] }) })
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx(ChatDisplaySettingsModal, { open: displayOpen, onClose: () => setDisplayOpen(false), folded: sessFold })
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("main", { className: "chat-main", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsxs("header", { className: "chat-head", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "head-mode", children: MODE_META[mode].icon }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "head-title", children: currentTitle || "新对话" }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "head-actions", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "head-panel-btn" + (searchOpen ? " on" : ""),
                title: "在本次对话里查找",
                "aria-pressed": searchOpen,
                onClick: () => {
                  setSearchOpen((v2) => !v2);
                  if (searchOpen) search.clear();
                },
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: "⌕" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "head-panel-label", children: "查找" })
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "head-panel-btn",
                title: "把当前对话导出为 Markdown 文件",
                onClick: exportChat,
                disabled: messages.length === 0,
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: "⤓" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "head-panel-label", children: "导出" })
                ]
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "button",
              {
                type: "button",
                className: "head-panel-btn" + (panelOpen ? " on" : ""),
                title: panelOpen ? "关闭右侧面板" : "打开右侧面板（工作区文件 / 终端 / 浏览器）",
                "aria-pressed": panelOpen,
                onClick: () => toggleRightPanel(),
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: "⊞" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "head-panel-label", children: "面板" })
                ]
              }
            )
          ] })
        ] }),
        searchOpen && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "chat-search", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              className: "chat-search-input",
              autoFocus: true,
              value: search.query,
              placeholder: "在本次对话里查找…",
              spellCheck: false,
              onChange: (e) => search.setQuery(e.target.value),
              onKeyDown: (e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  search.jump(e.shiftKey ? -1 : 1);
                } else if (e.key === "Escape") {
                  setSearchOpen(false);
                  search.clear();
                }
              }
            }
          ),
          /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "chat-search-count", children: search.query.trim() ? search.totalMatches > 0 ? `${search.cursor + 1}/${search.hits.length} 条 · 共 ${search.totalMatches} 处` : "没有匹配" : "" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "rp-nav", title: "上一个（Shift+Enter）", disabled: search.hits.length === 0, onClick: () => search.jump(-1), children: "↑" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "rp-nav", title: "下一个（Enter）", disabled: search.hits.length === 0, onClick: () => search.jump(1), children: "↓" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "rp-nav",
              title: "关闭",
              onClick: () => {
                setSearchOpen(false);
                search.clear();
              },
              children: "✕"
            }
          )
        ] }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "chat-body", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "messages", children: [
          messages.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "welcome", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(Butterfly, { size: 58 }),
            proactive ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "proactive", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "proactive-tag", children: [
                  "◐ ",
                  proactive.label
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "proactive-text", children: proactive.text }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "proactive-ops", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      className: "btn-ghost btn-xs",
                      onClick: () => {
                        void window.shorekeeper.proactiveSaid(proactive.reason);
                        const text = proactive.text;
                        setProactive(null);
                        setInput(text);
                      },
                      children: "接着说"
                    }
                  ),
                  /* @__PURE__ */ jsxRuntimeExports.jsx(
                    "button",
                    {
                      type: "button",
                      className: "btn-ghost btn-xs",
                      onClick: () => {
                        void window.shorekeeper.proactiveSaid(proactive.reason);
                        setProactive(null);
                      },
                      children: "今天不用"
                    }
                  )
                ] })
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "welcome-sub", children: welcome.line })
            ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
              /* @__PURE__ */ jsxRuntimeExports.jsx("h2", { className: "glow-text", children: welcome.title }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: welcome.line })
            ] })
          ] }) : messages.map((m2, i) => {
            if (m2.role === "tool" || m2.role === "system") return null;
            const isLastAi = m2.role === "assistant" && i === messages.reduce((acc, x2, k2) => x2.role === "assistant" ? k2 : acc, -1);
            if (m2.role === "user") {
              if (i === editIndex) {
                return /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg msg-user", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "avatar avatar-user", children: userProfile.avatar ? /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: userProfile.avatar, alt: "用户头像" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "avatar-user-d", children: "你" }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bubble bubble-user bubble-edit", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx(
                      "textarea",
                      {
                        autoFocus: true,
                        value: editDraft,
                        onChange: (e) => setEditDraft(e.target.value),
                        onKeyDown: (e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            saveEdit();
                          } else if (e.key === "Escape") {
                            cancelEdit();
                          }
                        },
                        placeholder: "修改这条消息…"
                      }
                    ),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "edit-actions", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: saveEdit, disabled: !editDraft.trim(), children: "保存并继续" }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { onClick: cancelEdit, children: "取消" })
                    ] })
                  ] })
                ] }, i);
              }
              return /* @__PURE__ */ jsxRuntimeExports.jsxs(
                "div",
                {
                  className: "msg msg-user",
                  ref: (el2) => search.registerRef(i, el2),
                  "data-search-dim": search.query.trim() && !search.stateOf(i).matched ? "1" : void 0,
                  children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "avatar avatar-user", children: userProfile.avatar ? /* @__PURE__ */ jsxRuntimeExports.jsx("img", { src: userProfile.avatar, alt: "用户头像" }) : /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "avatar-user-d", children: "你" }) }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bubble-wrap bubble-wrap-user", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx(
                        "div",
                        {
                          className: "bubble bubble-user" + (search.stateOf(i).focused ? " search-hit" : search.stateOf(i).matched ? " search-match" : ""),
                          children: highlight(m2.content, search.query)
                        }
                      ),
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bubble-foot", children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg-opts", children: [
                          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { title: "复制", "aria-label": "复制", onClick: () => copyMessage(m2.content), children: "⧉" }),
                          /* @__PURE__ */ jsxRuntimeExports.jsx("button", { title: "编辑并重新发送", "aria-label": "编辑", onClick: () => startEdit(i), children: "✎" })
                        ] }),
                        m2.createdAt && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "msg-time", children: fmtTime2(m2.createdAt) })
                      ] })
                    ] })
                  ]
                },
                i
              );
            }
            const trace = m2.toolCalls ?? [];
            return /* @__PURE__ */ jsxRuntimeExports.jsxs(
              "div",
              {
                className: "msg msg-ai",
                ref: (el2) => search.registerRef(i, el2),
                "data-search-dim": search.query.trim() && !search.stateOf(i).matched ? "1" : void 0,
                children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "avatar avatar-ai", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChatAvatar, { roleId: viewRole.id }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg-ai-stack", children: [
                    m2.reasoning && /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "thinking", open: false, children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsxs("summary", { children: [
                        /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "thinking-ic", "aria-hidden": "true", children: "✦" }),
                        "思考过程"
                      ] }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "thinking-body", children: m2.reasoning })
                    ] }),
                    trace.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-call-list", children: trace.map((t2, k2) => /* @__PURE__ */ jsxRuntimeExports.jsx(ToolCallCard, { call: t2 }, `${i}-${k2}-${t2.id}`)) }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs(
                      "div",
                      {
                        className: "bubble-wrap bubble-wrap-ai" + (isLastAi ? " is-last-ai" : ""),
                        children: [
                          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "bubble bubble-ai" + (search.stateOf(i).focused ? " search-hit" : search.stateOf(i).matched ? " search-match" : ""), children: /* @__PURE__ */ jsxRuntimeExports.jsx(Markdown, { content: m2.content, highlight: search.query.trim() || void 0 }) }),
                          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bubble-foot", children: [
                            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg-opts", children: [
                              /* @__PURE__ */ jsxRuntimeExports.jsx(
                                "button",
                                {
                                  title: speaking === String(i) ? (ttsAudioRef.current ? "点击停止朗读" : "声音准备中…") : "朗读这条回复",
                                  "aria-label": "朗读",
                                  className: speaking === String(i) ? "speaking" : "",
                                  onClick: () => toggleSpeak(i, m2.content),
                                  children: speaking === String(i) ? "⏳" : "🔊"
                                }
                              ),
                              /* @__PURE__ */ jsxRuntimeExports.jsx(
                                "button",
                                {
                                  title: speaking === String(i) && !ttsAudioRef.current ? "正在重新合成…" : "重新合成这条回复的语音（会先停掉当前播放）",
                                  "aria-label": "重新合成语音",
                                  onClick: () => reSpeak(i, m2.content),
                                  disabled: speaking !== null && !ttsAudioRef.current,
                                  children: "🎙"
                                }
                              ),
                              /* @__PURE__ */ jsxRuntimeExports.jsx("button", { title: "复制", "aria-label": "复制", onClick: () => copyMessage(m2.content), children: "⧉" }),
                              isLastAi && !sending && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { title: "重新生成", "aria-label": "重新生成", onClick: regenerate, children: "↻" })
                            ] }),
                            m2.createdAt && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "msg-time", children: fmtTime2(m2.createdAt) })
                          ] })
                        ]
                      }
                    )
                  ] })
                ]
              },
              i
            );
          }),
          sending && liveCalls.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg msg-ai", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "avatar avatar-ai", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChatAvatar, { roleId: viewRole.id }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "msg-ai-stack", children: /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-call-list", children: liveCalls.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx(ToolCallCard, { call: c.trace }, c.key)) }) })
          ] }),
          sending && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg msg-ai", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "avatar avatar-ai", children: /* @__PURE__ */ jsxRuntimeExports.jsx(ChatAvatar, { roleId: viewRole.id }) }),
            /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "msg-ai-stack", children: [
              liveReasoning && /* @__PURE__ */ jsxRuntimeExports.jsxs("details", { className: "thinking", open: false, children: [
                /* @__PURE__ */ jsxRuntimeExports.jsxs("summary", { children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "thinking-ic", "aria-hidden": "true", children: "✦" }),
                  "思考过程",
                  liveText ? "" : "…"
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "thinking-body", children: liveReasoning })
              ] }),
              liveText ? /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bubble bubble-ai", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx(Markdown, { content: liveText }),
                presenting === "typing" && /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "typing-caret", "aria-hidden": "true" })
              ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "bubble bubble-ai typing", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", {}),
                presenting === "synth" ? /* @__PURE__ */ jsxRuntimeExports.jsx("em", { className: "typing-note", children: roleNote(true) }) : /* @__PURE__ */ jsxRuntimeExports.jsx("em", { className: "typing-note", children: roleNote(false) })
              ] })
            ] })
          ] }),
          ttsError && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tts-err-line", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "tts-err", children: [
            "🔊 ",
            ttsError
          ] }) }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { ref: bottomRef })
        ] }) }),
        /* @__PURE__ */ jsxRuntimeExports.jsxs(
          "footer",
          {
            className: "composer" + (dragging ? " is-dragging" : ""),
            onDragEnter: (e) => {
              if (!Array.from(e.dataTransfer.types).includes("Files")) return;
              e.preventDefault();
              dragDepth.current++;
              setDragging(true);
            },
            onDragOver: (e) => {
              if (Array.from(e.dataTransfer.types).includes("Files")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
              }
            },
            onDragLeave: () => {
              dragDepth.current = Math.max(0, dragDepth.current - 1);
              if (dragDepth.current === 0) setDragging(false);
            },
            onDrop: (e) => {
              if (!Array.from(e.dataTransfer.types).includes("Files")) return;
              e.preventDefault();
              dragDepth.current = 0;
              setDragging(false);
              void onDropFiles(e.dataTransfer.files);
            },
            children: [
              (mode === "code" || mode === "work") && projectPanelOpen && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-panel up", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-panel-inner", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-panel-head", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-panel-title", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: IcFolder }),
                  " 项目文件夹",
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tool-panel-sub", children: PROJECT_ROOT })
                ] }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-panel-close", onClick: () => setProjectPanelOpen(false), "aria-label": "关闭项目面板", children: "✕" }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-panel-row", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-btn primary", disabled: !!toolBusy, onClick: () => runTool("open_path", { path: PROJECT_ROOT }), children: "打开项目文件夹" }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-btn", disabled: !!toolBusy, onClick: () => runTool("list_dir", { path: PROJECT_ROOT }), children: "列出项目文件" })
                ] }),
                toolBusy && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-panel-busy", children: "正在执行…" }),
                toolOutput && /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "tool-panel-output", children: toolOutput })
              ] }) }),
              (mode === "code" || mode === "work") && permPanelOpen && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-panel up", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-panel-inner", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-panel-head", children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-panel-title", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: IcShield }),
                  " 本机权限",
                  /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "tool-panel-sub", children: "允许 agent 在本机执行的操作范围" })
                ] }) }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-panel-close", onClick: () => setPermPanelOpen(false), "aria-label": "关闭权限面板", children: "✕" }),
                /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-perm-list", children: [
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-perm-item" + (permLevel === 1 ? " on" : ""), onClick: () => switchPermLevel(1), children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-perm-body", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-name", children: "仅可查看" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-desc", children: "只能读文件、看硬件、列目录、打开文件夹；写入与执行命令都会被拒绝" })
                  ] }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-perm-item" + (permLevel === 2 ? " on" : ""), onClick: () => switchPermLevel(2), children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-perm-body", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-name", children: "工作目录内修改" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-desc", children: "在「仅可查看」基础上，可在项目文件夹内读取文件、列出目录、打开入口；项目文件夹外仍然拒绝" })
                  ] }) }),
                  /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-perm-item" + (permLevel === 3 ? " on" : ""), onClick: () => switchPermLevel(3), children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-perm-body", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-name", children: "完全权限" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-desc", children: "允许打开任意路径、启动应用、读取任意文件；不再逐次询问授权" })
                  ] }) })
                ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-panel-row", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("input", { className: "tool-path-input", value: permPath, onChange: (e) => setPermPath(e.target.value), placeholder: "输入本地路径，如 D:\\Shorekeeper-Agent-Dev 或 C:\\Windows\\notepad.exe", onKeyDown: (e) => { if (e.key === "Enter" && permPath.trim()) runTool("open_path", { path: permPath.trim(), permissionLevel: permLevel }); } }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-btn", disabled: !!toolBusy || !permPath.trim(), onClick: () => runTool("open_path", { path: permPath.trim(), permissionLevel: permLevel }), children: "打开" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-btn", disabled: !!toolBusy || !permPath.trim(), onClick: () => runTool("read_file", { path: permPath.trim() }), children: "读取" }),
                /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-btn primary", disabled: !!toolBusy, onClick: () => runTool("system_info", {}), children: "系统信息" }),
                permLevel >= 2 && /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-btn", disabled: !!toolBusy, onClick: () => runTool("open_path", { path: PROJECT_ROOT, permissionLevel: permLevel }), children: "打开项目文件夹" })
              ] }),
              toolBusy && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-panel-busy", children: "正在执行…" }),
              toolOutput && /* @__PURE__ */ jsxRuntimeExports.jsx("pre", { className: "tool-panel-output", children: toolOutput }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-perm-foot", children: "权限档位是唯一控制项；允许范围内的操作会直接执行，不再逐次询问。" })
            ] }) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "composer-box", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "composer-cards", children: [
                  pendingConfirm && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-confirm-card", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-card-title", children: "⚠ 高危操作需要确认" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-card-summary", children: pendingConfirm.summary }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-card-actions", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-card-btn deny", onClick: () => resolveConfirm(false), children: "拒绝" }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-card-btn allow", onClick: () => resolveConfirm(true), children: "允许执行" })
                    ] })
                  ] }),
                  pendingAsk && /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-confirm-card ask", children: [
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-card-title", children: "🤔 " + (role.name ?? "Agent") + " 想问你" }),
                    /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-card-summary", children: pendingAsk.question }),
                    pendingAsk.options && pendingAsk.options.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "tool-card-options", children: pendingAsk.options.map((op, i) => /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-card-btn opt", onClick: () => submitAsk(op), children: op }, "ask_opt_" + i)) }),
                    /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "tool-card-ask-row", children: [
                      /* @__PURE__ */ jsxRuntimeExports.jsx("input", { className: "tool-card-input", placeholder: "输入你的回答，回车发送", onKeyDown: (e) => { if (e.key === "Enter" && e.target.value.trim()) submitAsk(e.target.value.trim()); } }),
                      /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "tool-card-btn allow", onClick: (e) => { const inputEl = e.currentTarget.parentElement.querySelector("input"); if (inputEl && inputEl.value.trim()) submitAsk(inputEl.value.trim()); }, children: "发送" })
                    ] })
                  ] })
                ] }),
                (mode === "code" || mode === "work") && /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    type: "button",
                    className: "tool-key-btn" + (projectPanelOpen ? " on" : ""),
                    onClick: () => { setProjectPanelOpen((v) => !v); if (permPanelOpen) setPermPanelOpen(false); },
                    title: "项目文件夹操作",
                    "aria-label": "项目文件夹",
                    "aria-pressed": projectPanelOpen,
                    children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: IcFolder })
                  }
                ),
                (mode === "code" || mode === "work") && /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    type: "button",
                    className: "tool-key-btn" + (permPanelOpen ? " on" : ""),
                    onClick: () => { setPermPanelOpen((v) => !v); if (projectPanelOpen) setProjectPanelOpen(false); },
                    title: "本机权限：仅可查看 / 工作目录内修改 / 完全权限",
                    "aria-label": "电脑权限",
                    "aria-pressed": permPanelOpen,
                    children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: IcShield })
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    type: "button",
                    className: "attach-btn",
                    onClick: pickFile,
                    disabled: sending,
                    title: "上传文件（仅支持文本，512KB 以内）",
                    "aria-label": "上传文件",
                    children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: "＋" })
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "textarea",
                  {
                    ref: taRef,
                    value: input,
                    rows: 1,
                    placeholder: voice.listening ? "正在听……说完再点一次麦克风结束" : mode === "chat" ? `向${role.name}说话……` : mode === "code" ? "描述你的编程问题……" : "说说需要处理的办公任务……",
                    onChange: autoGrow,
                    onKeyDown
                  }
                ),
                voice.supported && /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    type: "button",
                    className: "mic-btn" + (voice.listening ? " on" : ""),
                    onClick: voice.toggle,
                    disabled: sending,
                    title: voice.listening ? "停止语音输入" : "语音输入（需要联网）",
                    "aria-label": voice.listening ? "停止语音输入" : "语音输入",
                    "aria-pressed": voice.listening,
                    children: /* @__PURE__ */ jsxRuntimeExports.jsx("span", { "aria-hidden": "true", children: "🎙" })
                  }
                ),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    className: sending || speaking || presenting || autoRead.speaking ? "send-btn stop-btn" : "send-btn",
                    onClick: sending || speaking || presenting || autoRead.speaking ? stop : send,
                    disabled: !(sending || speaking || presenting || autoRead.speaking) && !input.trim() && files.length === 0,
                    "aria-label": sending || speaking || presenting || autoRead.speaking ? "停止" : "发送",
                    title: sending || speaking || presenting || autoRead.speaking ? "停止生成 / 停止朗读" : "发送",
                    children: sending ? /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "stop-ic", "aria-hidden": "true" }) : "➤"
                  }
                )
              ] }),
              files.length > 0 && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "attach-list", children: files.map((f2, i) => /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "attach-chip", children: [
                /* @__PURE__ */ jsxRuntimeExports.jsx("span", { className: "attach-chip-ic", "aria-hidden": "true", children: "▤" }),
                f2.name,
                f2.size != null && /* @__PURE__ */ jsxRuntimeExports.jsxs("span", { className: "attach-chip-size", children: [
                  (f2.size / 1024).toFixed(1),
                  "KB"
                ] }),
                /* @__PURE__ */ jsxRuntimeExports.jsx(
                  "button",
                  {
                    type: "button",
                    className: "attach-x",
                    onClick: () => removeFile(i),
                    "aria-label": "移除附件",
                    title: "移除附件",
                    children: "✕"
                  }
                )
              ] }, `${f2.name}-${i}`)) }),
              /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "composer-hint", children: [
                "Enter 发送 · Shift+Enter 换行 · Ctrl+B 右侧面板",
                config?.chatToolsEnabled ? " · 工具调用已开启" : ""
              ] }),
              /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "chat-tokbar", title: "当前对话 Token 用量（仅本地统计）", children: renderTokBar(tokStat) })
            ]
          }
        )
      ] }),
      panelOpen && panelMounted && /* @__PURE__ */ jsxRuntimeExports.jsx(
        RightPanel,
        {
          overlay: narrow,
          leftOffset: narrow ? "0px" : "216px",
          onClose: () => toggleRightPanel(false)
        }
      )
    ] }),
    nameModal && /* @__PURE__ */ jsxRuntimeExports.jsx(
      "div",
      {
        className: "modal-scrim",
        onMouseDown: (e) => {
          if (e.target === e.currentTarget) setNameModal(null);
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-card name-modal", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { children: nameModal.kind === "create" ? "新建项目" : nameModal.kind === "rename" ? "重命名项目" : "重命名对话" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx(
            "input",
            {
              autoFocus: true,
              value: nameValue,
              onChange: (e) => setNameValue(e.target.value),
              placeholder: nameModal.kind === "session-rename" ? "对话名称" : "项目名称",
              maxLength: 24,
              onKeyDown: (e) => {
                if (e.key === "Enter") void submitNameModal();
                else if (e.key === "Escape") setNameModal(null);
              }
            }
          ),
          nameModal.kind !== "session-rename" && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "name-colors", role: "radiogroup", "aria-label": "分组颜色", children: GROUP_COLORS.map((c) => /* @__PURE__ */ jsxRuntimeExports.jsx(
            "button",
            {
              type: "button",
              className: "color-dot" + (nameColor === c ? " on" : ""),
              style: { background: c },
              title: c,
              "aria-label": c,
              "aria-checked": nameColor === c,
              role: "radio",
              onClick: () => setNameColor(nameColor === c ? "" : c)
            },
            c
          )) }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-actions", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: () => setNameModal(null), children: "取消" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "btn-primary",
                disabled: !nameValue.trim(),
                onClick: () => void submitNameModal(),
                children: nameModal.kind === "create" ? "创建" : "保存"
              }
            )
          ] })
        ] })
      }
    ),
    forkTarget && /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "modal-scrim", onMouseDown: (e) => {
      if (e.target === e.currentTarget) setForkTarget(null);
    }, children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-card fork-box", children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { className: "modal-title", children: forkTarget.agentRole && AGENT_ROLES[forkTarget.agentRole] ? `这个存档是和${AGENT_ROLES[forkTarget.agentRole].name}的对话` : "这个存档属于另一个人设角色" }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("p", { className: "modal-desc", children: [
        "当前角色是「",
        role.name,
        "」，与这个存档绑定的角色不同，不能直接接着聊。 可以用「分叉会话」复制一份存档、以当前角色继续；原存档保持不变。"
      ] }),
      /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-actions", children: [
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: () => setForkTarget(null), children: "取消" }),
        /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-primary", onClick: () => void forkSession(forkTarget), children: "⑂ 分叉会话（以当前角色继续）" })
      ] })
    ] }) }),
    delTarget && /* @__PURE__ */ jsxRuntimeExports.jsx(
      "div",
      {
        className: "modal-scrim",
        onMouseDown: (e) => {
          if (e.target === e.currentTarget) setDelTarget(null);
        },
        children: /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-card confirm-modal", children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("h3", { children: delTarget.kind === "group" ? "删除分组" : "删除对话" }),
          /* @__PURE__ */ jsxRuntimeExports.jsx("p", { children: delTarget.kind === "group" ? `删除分组「${delTarget.name}」？其中的会话会退回未分组，对话内容不会丢失。` : `删除对话「${delTarget.name}」？此操作不可恢复。` }),
          /* @__PURE__ */ jsxRuntimeExports.jsxs("div", { className: "modal-actions", children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx("button", { type: "button", className: "btn-ghost", onClick: () => setDelTarget(null), children: "取消" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "btn-danger",
                onClick: () => {
                  const t2 = delTarget;
                  setDelTarget(null);
                  if (t2.kind === "group") {
                    void org.removeGroup(t2.id).then(() => window.shorekeeper.listSessions().then(setSessions));
                  } else void removeSession(t2.id);
                },
                children: "删除"
              }
            )
          ] })
        ] })
      }
    ),
    moveModal && /* @__PURE__ */ jsxRuntimeExports.jsxs(
      "div",
      {
        className: "move-pop",
        style: {
          left: Math.min(moveModal.x + 196, window.innerWidth - 250),
          top: Math.max(8, moveModal.y - 236)
        },
        children: [
          /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "move-pop-title", children: "移动到项目" }),
          org.groups.length === 0 ? /* @__PURE__ */ jsxRuntimeExports.jsx("p", { className: "move-pop-empty", children: "还没有项目，先回侧栏「项目」区点 ＋ 新建一个。" }) : org.groups.map((g) => /* @__PURE__ */ jsxRuntimeExports.jsxs(
            "button",
            {
              type: "button",
              className: "move-item",
              onClick: async () => {
                await org.move(moveModal.session.id, { groupId: g.id });
                setMoveModal(null);
                setSessions(await window.shorekeeper.listSessions());
              },
              children: [
                g.color && /* @__PURE__ */ jsxRuntimeExports.jsx("i", { className: "bucket-dot", style: { background: g.color }, "aria-hidden": "true" }),
                g.name
              ]
            },
            g.id
          ))
        ]
      }
    ),
    ctx && /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "div",
        {
          className: "ctx-scrim",
          onMouseDown: (e) => {
            e.preventDefault();
            setCtx(null);
          },
          onContextMenu: (e) => {
            e.preventDefault();
            setCtx(null);
          }
        }
      ),
      /* @__PURE__ */ jsxRuntimeExports.jsx(
        "div",
        {
          className: "ctx-menu dark",
          style: {
            left: Math.min(ctx.x, window.innerWidth - 208),
            top: Math.min(ctx.y, window.innerHeight - 260)
          },
          children: ctx.kind === "session" ? /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item",
                onClick: () => {
                  setCtx(null);
                  void togglePin(ctx.session);
                },
                children: ctx.session.pinned ? "⬇ 取消置顶" : "⬆ 置顶"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item",
                onClick: () => {
                  setCtx(null);
                  setNameValue(ctx.session.title);
                  setNameModal({ kind: "session-rename", id: ctx.session.id, title: ctx.session.title });
                },
                children: "✎ 重命名"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item",
                onClick: () => {
                  setCtx(null);
                  setMoveModal({ session: ctx.session, x: ctx.x, y: ctx.y });
                },
                children: "⇄ 移动到项目"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item",
                onClick: () => {
                  setCtx(null);
                  void forkSession(ctx.session);
                },
                children: "⑂ 分叉会话"
              }
            ),
            ctx.session.groupId && /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item",
                onClick: () => {
                  setCtx(null);
                  void removeFromProject(ctx.session);
                },
                children: "⇤ 移出此项目"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ctx-divider" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item ctx-danger",
                onClick: () => {
                  setCtx(null);
                  setDelTarget({ kind: "session", id: ctx.session.id, name: ctx.session.title });
                },
                children: "✕ 删除"
              }
            )
          ] }) : /* @__PURE__ */ jsxRuntimeExports.jsxs(jsxRuntimeExports.Fragment, { children: [
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item",
                onClick: () => {
                  setCtx(null);
                  setNameValue(ctx.name);
                  setNameColor(ctx.color ?? "");
                  setNameModal({ kind: "rename", id: ctx.id, name: ctx.name, color: ctx.color });
                },
                children: "✎ 重命名项目"
              }
            ),
            /* @__PURE__ */ jsxRuntimeExports.jsx("div", { className: "ctx-divider" }),
            /* @__PURE__ */ jsxRuntimeExports.jsx(
              "button",
              {
                type: "button",
                className: "ctx-item ctx-danger",
                onClick: () => {
                  setCtx(null);
                  setDelTarget({ kind: "group", id: ctx.id, name: ctx.name });
                },
                children: "✕ 删除项目"
              }
            )
          ] })
        }
      )
    ] }),
    toast.view
  ] });
}

const RP_OPEN_KEY = "sk-right-panel-open";

const NARROW_QUERY = "(max-width: 1080px)";

const MODE_META = {
  chat: { label: "聊天", icon: "◈", desc: "陪伴与对话" },
  code: { label: "代码", icon: "</>", desc: "编程助手" },
  work: { label: "工作", icon: "▤", desc: "办公助手" }
};

const WELCOME = {
  chat: { title: "愿这片星海，陪你安静地说话。", line: "想聊什么都可以，我在听。" },
  code: { title: "代码的问题，交给我一起解决。", line: "描述你的编程任务、报错或想法。" },
  work: { title: "办公的琐事，可以安心托付。", line: "说说需要撰写、整理或规划的内容。" }
};

function Chevron({ open }) {
  return /* @__PURE__ */ jsxRuntimeExports.jsx("i", { className: "bucket-cv" + (open ? " open" : "") });
}

const GROUP_COLORS = ["#4A9CFF", "#7C6FE0", "#E08FB9", "#F2A33C", "#4FC3A1", "#8B9DB5"];
