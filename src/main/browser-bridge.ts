/**
 * 浏览器桥（规格 5 · 八）：让 Agent 工具操作「面板里那个 <webview> 实例」。
 *
 * 为什么这么设计：
 *   <webview> 是渲染层的元素，但它的内容由独立 webContents 承载。
 *   渲染层挂载后把 `webview.getWebContentsId()` 交给主进程登记，
 *   主进程用 `webContents.fromId(id)` 拿到同一个被控 webContents，
 *   于是 Agent 工具（在主进程跑）与用户的鼠标操作**共用同一个页面**：
 *   - 用户在面板里点/滚/登录，Agent 通过 snapshot 看到的就是当前页面
 *   - Agent navigate/click/fill 之后，面板的 did-navigate 会自动同步地址栏
 *
 * 零新依赖：loadURL / executeJavaScript / capturePage 都是 Electron 内置。
 */

import { BrowserWindow, webContents } from 'electron'
import type { NativeImage, WebContents } from 'electron'
import {
  BROWSER_AGENT_ACTIVITY_EVENT,
  BROWSER_AGENT_CLOSED_EVENT,
  BROWSER_ENSURE_EVENT
} from '../shared/events'
import type { BrowserAgentActivity } from '../shared/events'

/** 只放行 http / https（规格 8.3：地址栏与工具入参两处都校验） */
export function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(String(raw ?? '').trim())
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** 补全用户/AI 给的网址：无协议时按 https 处理；非 http(s) 直接判不合法 */
export function normalizeHttpUrl(raw: string): string | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (isHttpUrl(s)) return s
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null // file: / javascript: / data: … 一律拒绝
  if (/^[^\s/]+\.[^\s/]{2,}/.test(s)) return `https://${s}`
  return null
}

/** 过期引用的可读错误（规格 8.1 要求「可读错误」而不是崩溃） */
export const STALE_REF_MESSAGE = '元素引用已过期，请重新调用 browser_snapshot'

const NO_WEBVIEW_MESSAGE =
  '没有可操作的内置浏览器实例：已尝试自动打开右侧「浏览器」面板但未就绪。请确认窗口在前台、未被最小化，再让 Agent 重试 browser_open；或手动打开右侧「浏览器」tab 后访问任意网址。'

/** 读取类工具（snapshot/click/fill/screenshot）在没有页面时的提示：先 open，不要盲目拉起 */
const NEED_OPEN_MESSAGE =
  '还没有可操作的内置浏览器页面：请先调用 browser_open 打开一个 http/https 网址，再读取页面或操作元素。'

interface BoundBrowser {
  guest: WebContents
  hostId: number
  at: number
}

/** 面板 webview ↔ 宿主渲染进程 的登记表：hostId → guest */
const bound = new Map<number, BoundBrowser>()
/** 最近一次登记的实例：工具调用来自别的 webContents 时的回落 */
let lastBound: BoundBrowser | null = null

/** 登记渲染层挂上来的 webview（由 IPC browser:bind 调用） */
export function bindBrowser(hostId: number, guestId: number): { ok: boolean; url?: string; error?: string } {
  const guest = webContents.fromId(guestId)
  if (!guest || guest.isDestroyed()) return { ok: false, error: 'webview 的 webContents 不存在' }
  // 被控页面必须没有 preload / Node 能力（isolation 由 <webview> 与 will-attach-webview 双保险）
  const b: BoundBrowser = { guest, hostId, at: Date.now() }
  bound.set(hostId, b)
  lastBound = b
  return { ok: true, url: guest.getURL() }
}

export function unbindBrowser(hostId: number): void {
  const b = bound.get(hostId)
  if (b) {
    bound.delete(hostId)
    if (lastBound === b) lastBound = null
  }
}

/** 拿到当前可操作的被控页面 */
export function getActiveBrowser(hostId?: number): WebContents | null {
  if (typeof hostId === 'number') {
    const b = bound.get(hostId)
    if (b && !b.guest.isDestroyed()) return b.guest
  }
  if (lastBound && !lastBound.guest.isDestroyed()) return lastBound.guest
  for (const b of bound.values()) if (!b.guest.isDestroyed()) return b.guest
  return null
}

/** 找到承载渲染层的窗口（单窗口应用，取第一个可用窗口即可） */
function rendererWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
  return wins.length > 0 ? wins[0] : null
}

/**
 * 请渲染层把内置浏览器拉起来：打开右侧面板 → 切到「浏览器」tab → 建一个指向 url 的标签页。
 * 这是 browser_open 的「自举」能力：Agent 不再要求用户先手动开面板。
 */
function requestBrowserOpen(url: string): void {
  const win = rendererWindow()
  if (!win || win.webContents.isDestroyed()) return
  try {
    win.webContents.send(BROWSER_ENSURE_EVENT, { url })
  } catch {
    /* 渲染层可能正在销毁 */
  }
}

/** 等渲染层把 webview 挂上并完成绑定；超时返回 null（由调用方给出可读错误） */
async function waitForBrowser(timeoutMs = 12000): Promise<WebContents | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const wc = getActiveBrowser()
    if (wc) return wc
    if (Date.now() >= deadline) return null
    await new Promise((r) => setTimeout(r, 120))
  }
}

/**
 * 通知渲染层「Agent 刚操作了同一个页面」。
 * 面板据此显示一行反馈——这是「面板与 Agent 共享同一实例」最直观的证据。
 */
function emitActivity(action: BrowserAgentActivity['action'], detail?: string): void {
  const b = lastBound
  if (!b || b.guest.isDestroyed()) return
  try {
    b.guest.send(BROWSER_AGENT_ACTIVITY_EVENT, { action, detail } as BrowserAgentActivity)
  } catch {
    /* 渲染层可能已销毁 */
  }
}

/** 统一取页面的可读信息 */
function pageInfo(wc: WebContents): { url: string; title: string } {
  let url = ''
  let title = ''
  try {
    url = wc.getURL()
  } catch {
    /* ignore */
  }
  try {
    title = wc.getTitle()
  } catch {
    /* ignore */
  }
  return { url, title }
}

/** 打开网址：工具侧导航，面板会自动跟上（did-navigate → 地址栏同步） */
export async function agentNavigate(
  url: string
): Promise<{ ok: true; url: string; title: string } | { ok: false; error: string }> {
  const target = normalizeHttpUrl(url)
  if (!target) return { ok: false, error: `只允许 http / https 网址，已拒绝：${String(url).slice(0, 80)}` }

  // 自举：没有已绑定的 webview 时，请渲染层打开面板 + 浏览器 tab + 建一个指向该网址的标签页，
  // 等 guest 挂上并完成 browser:bind 后再继续——Agent 不再依赖用户先手动开面板。
  let wc = getActiveBrowser()
  if (!wc) {
    requestBrowserOpen(target)
    wc = await waitForBrowser()
    if (!wc) return { ok: false, error: NO_WEBVIEW_MESSAGE }
    // 渲染层已带着这个地址建了标签页，给 guest 一点时间开始导航；
    // 下面若发现地址还没跟上，再显式 loadURL 一次兜底。
    await new Promise((r) => setTimeout(r, 350))
  }

  try {
    if (wc.getURL() !== target) {
      // loadURL 在重定向/被中止时会 reject（ERR_ABORTED），那不算失败——页面已经在导航了
      await wc.loadURL(target).catch(() => undefined)
    }
  } catch (e) {
    return { ok: false, error: `打开失败：${(e as Error).message}` }
  }
  emitActivity('open', target)
  return { ok: true, ...pageInfo(wc) }
}

/* ------------------------------------------------------------------
   注入脚本：所有「读结构 / 点击 / 填写」都在页面上下文里跑，
   候选元素存到 window.__skBrowserRefs，index 只在这份快照内有效。
   ------------------------------------------------------------------ */

/** 页面里通用的辅助函数（visibility / text / selector），拼进每个脚本的开头 */
const PAGE_HELPERS = String.raw`
  const __skVis = (el) => {
    try {
      const s = window.getComputedStyle(el);
      if (!s || s.display === 'none' || s.visibility === 'hidden') return false;
      if (parseFloat(s.opacity || '1') === 0) return false;
    } catch (e) {}
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const __skText = (el) => {
    let t = '';
    try { t = el.innerText || el.textContent || ''; } catch (e) {}
    t = String(t).replace(/\s+/g, ' ').trim();
    if (t.length > 120) t = t.slice(0, 120) + '…';
    if (!t) {
      try { t = String(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.value || '').trim().slice(0, 120); } catch (e) {}
    }
    return t;
  };
  const __skSelector = (el) => {
    try {
      if (el.id) return '#' + String(el.id).replace(/[^\w-]/g, '\\$&');
      const tag = String(el.tagName || '').toLowerCase();
      const cls = (el.classList && el.classList[0]) ? String(el.classList[0]).replace(/[^\w-]/g, '\\$&') : '';
      const cand = tag + (cls ? '.' + cls : '');
      if (document.querySelectorAll(cand).length === 1) return cand;
      const name = el.getAttribute && el.getAttribute('name');
      if (name) { const c2 = tag + '[name="' + String(name).replace(/"/g, '\\"') + '"]'; if (document.querySelectorAll(c2).length === 1) return c2; }
      return cand || tag;
    } catch (e) { return String(el.tagName || '').toLowerCase(); }
  };
`

/** 读结构：可交互元素列表 + 可见文本截断 */
const SNAPSHOT_SCRIPT = String.raw`(() => {
  ${PAGE_HELPERS}
  const SEL = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"]';
  const all = Array.from(document.querySelectorAll(SEL));
  window.__skBrowserRefs = [];
  const items = [];
  for (let i = 0; i < all.length && items.length < 60; i += 1) {
    const el = all[i];
    if (!__skVis(el)) continue;
    const tag = String(el.tagName || '').toLowerCase();
    window.__skBrowserRefs.push(el);
    const idx = window.__skBrowserRefs.length;
    const item = { index: idx, tag: tag, text: __skText(el), selector: __skSelector(el) };
    try { if (tag === 'a') item.href = String(el.href || '').slice(0, 300); } catch (e) {}
    try {
      if (tag === 'input' || tag === 'textarea' || tag === 'select') {
        item.type = String(el.getAttribute('type') || tag);
        item.name = el.getAttribute('name') || '';
        item.value = String(el.value === undefined ? '' : el.value).slice(0, 80);
        item.disabled = !!el.disabled;
        // 密码框只报长度，不回显内容
        if (item.type === 'password') item.value = el.value ? '••••（' + String(el.value).length + ' 位，已隐藏）' : '';
      }
    } catch (e) {}
    items.push(item);
  }
  let text = '';
  try { text = String(document.body ? document.body.innerText : '').replace(/\s+\n/g, '\n').trim(); } catch (e) {}
  const truncated = text.length > 4000;
  return {
    url: String(location.href),
    title: String(document.title || ''),
    text: text.slice(0, 4000),
    textTruncated: truncated,
    total: all.length,
    elements: items
  };
})()`

const CLICK_SCRIPT = (index: number): string => String.raw`(() => {
  const refs = window.__skBrowserRefs;
  if (!refs || !refs[${index}]) return { ok: false, stale: true };
  const el = refs[${index}];
  try { if (!el.isConnected) return { ok: false, stale: true }; } catch (e) { return { ok: false, stale: true }; }
  try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
  try { el.focus(); } catch (e) {}
  try { el.click(); } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  return { ok: true, tag: String(el.tagName || '').toLowerCase() };
})()`

const FILL_SCRIPT = (index: number, value: string, submit: boolean): string => String.raw`(() => {
  const refs = window.__skBrowserRefs;
  if (!refs || !refs[${index}]) return { ok: false, stale: true };
  const el = refs[${index}];
  try { if (!el.isConnected) return { ok: false, stale: true }; } catch (e) { return { ok: false, stale: true }; }
  const v = ${JSON.stringify(value)};
  try { el.focus(); } catch (e) {}
  try {
    if (el.isContentEditable) { el.textContent = v; }
    else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) setter.set.call(el, v); else el.value = v;
    }
  } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }
  for (const t of ['input', 'change', 'blur']) {
    try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (e) {}
  }
  let submitted = false;
  if (${submit ? 'true' : 'false'}) {
    try {
      const form = el.form || (el.closest ? el.closest('form') : null);
      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        submitted = true;
      } else {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        submitted = true;
      }
    } catch (e) {}
  }
  return { ok: true, submitted: submitted, tag: String(el.tagName || '').toLowerCase() };
})()`

export interface PageSnapshot {
  url: string
  title: string
  text: string
  textTruncated: boolean
  total: number
  elements: Array<{
    index: number
    tag: string
    text: string
    selector: string
    href?: string
    type?: string
    name?: string
    value?: string
    disabled?: boolean
  }>
}

export async function agentSnapshot(): Promise<
  { ok: true; snapshot: PageSnapshot } | { ok: false; error: string }
> {
  const wc = getActiveBrowser()
  if (!wc) return { ok: false, error: NEED_OPEN_MESSAGE }
  try {
    const s = (await wc.executeJavaScript(SNAPSHOT_SCRIPT, true)) as PageSnapshot
    if (!s || typeof s !== 'object') return { ok: false, error: '页面结构读取失败（返回为空）' }
    emitActivity('snapshot', `${s.elements?.length ?? 0} 个可交互元素`)
    return { ok: true, snapshot: s }
  } catch (e) {
    return { ok: false, error: `读取页面结构失败：${(e as Error).message}` }
  }
}

export async function agentClick(
  index: number
): Promise<{ ok: true; tag: string } | { ok: false; error: string }> {
  const wc = getActiveBrowser()
  if (!wc) return { ok: false, error: NEED_OPEN_MESSAGE }
  const i = Math.floor(Number(index))
  if (!Number.isFinite(i) || i < 1) return { ok: false, error: 'index 必须是 browser_snapshot 返回的 ≥1 的整数' }
  try {
    const r = (await wc.executeJavaScript(CLICK_SCRIPT(i), true)) as
      | { ok: true; tag: string }
      | { ok: false; stale?: boolean; error?: string }
    if (r.ok) {
      emitActivity('click', `index=${i} <${r.tag}>`)
      return { ok: true, tag: r.tag }
    }
    if (r.stale) return { ok: false, error: STALE_REF_MESSAGE }
    return { ok: false, error: `点击失败：${r.error ?? '未知错误'}` }
  } catch (e) {
    return { ok: false, error: `点击失败：${(e as Error).message}` }
  }
}

export async function agentFill(
  index: number,
  value: string,
  submit: boolean
): Promise<{ ok: true; submitted: boolean } | { ok: false; error: string }> {
  const wc = getActiveBrowser()
  if (!wc) return { ok: false, error: NEED_OPEN_MESSAGE }
  const i = Math.floor(Number(index))
  if (!Number.isFinite(i) || i < 1) return { ok: false, error: 'index 必须是 browser_snapshot 返回的 ≥1 的整数' }
  if (typeof value !== 'string') return { ok: false, error: 'value 必须是字符串' }
  try {
    const r = (await wc.executeJavaScript(FILL_SCRIPT(i, value, submit === true), true)) as
      | { ok: true; submitted: boolean }
      | { ok: false; stale?: boolean; error?: string }
    if (r.ok) {
      emitActivity('fill', `index=${i}，${value.length} 字符${r.submitted ? '，已提交' : ''}`)
      return { ok: true, submitted: r.submitted }
    }
    if (r.stale) return { ok: false, error: STALE_REF_MESSAGE }
    return { ok: false, error: `填写失败：${r.error ?? '未知错误'}` }
  } catch (e) {
    return { ok: false, error: `填写失败：${(e as Error).message}` }
  }
}

/**
 * 截图。
 * 不落盘、不返回 base64：把 NativeImage 交给调用方（tools.ts）解析成 PNG，
 * 这样「保存到工作区」的策略留在工具层，桥这层保持纯粹。
 */
export async function agentCapture(): Promise<
  { ok: true; image: NativeImage; url: string; title: string } | { ok: false; error: string }
> {
  const wc = getActiveBrowser()
  if (!wc) return { ok: false, error: NEED_OPEN_MESSAGE }
  try {
    const image = await wc.capturePage()
    if (!image || image.isEmpty()) return { ok: false, error: '截图失败：页面还没有可捕获的内容' }
    emitActivity('screenshot', pageInfo(wc).url)
    return { ok: true, image, ...pageInfo(wc) }
  } catch (e) {
    return { ok: false, error: `截图失败：${(e as Error).message}` }
  }
}

/** 关闭浏览器：通知面板回空态并解除绑定（面板收到后会卸载 webview） */
export function agentClose(): { ok: boolean; closed: boolean; error?: string } {
  const b = lastBound
  const wc = getActiveBrowser()
  if (!wc && !b) return { ok: false, closed: false, error: NEED_OPEN_MESSAGE }
  if (b) {
    if (!b.guest.isDestroyed()) {
      try {
        // 渲染层的 BrowserPane 收到后会把 src 清空（<webview> 随之卸载）并 browserUnbind
        b.guest.send(BROWSER_AGENT_CLOSED_EVENT)
      } catch {
        /* 渲染层可能已销毁 */
      }
    }
    bound.delete(b.hostId)
    if (lastBound === b) lastBound = null
  }
  return { ok: true, closed: true }
}

/** 供调试/工具描述使用：当前绑定页面的信息 */
export function currentBrowserInfo(): { url: string; title: string } | null {
  const wc = getActiveBrowser()
  if (!wc) return null
  return pageInfo(wc)
}
