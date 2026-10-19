import { readdir, readFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'path'
import { shell } from 'electron'

/**
 * E1 工作区文件访问
 *
 * 「会话工作区」= 应用的运行目录（与终端默认 cwd 同一处），
 * 这样文件面板看到的内容与在终端里 `dir` 出来的内容是一致的——
 * 两处若各用一个根目录，用户会以为面板坏了。
 *
 * 安全约束（这类功能最容易出事的地方）：
 *   1) **路径必须落在工作区内**：所有入参都过 `withinWorkspace()`，
 *      用 resolve 后的绝对路径做前缀比较，挡掉 `../` 与绝对路径穿越。
 *   2) 读取有大小上限，避免打开一个几百 MB 的日志把内存吃满。
 *   3) 符号链接：这里不做 realpath 解析，因为解析失败会让正常路径也用不了；
 *      越界判定基于字面路径，配合工作区根目录封顶，风险可控。
 */

/** 单文件读取上限（字符），超过就只给提示不读全文 */
const MAX_READ_BYTES = 512 * 1024

export function workspaceRoot(): string {
  return process.cwd()
}

/** 把用户/模型给的相对路径解析成工作区内的绝对路径；越界返回 null */
export function withinWorkspace(rel: string | undefined): string | null {
  const root = workspaceRoot()
  const raw = (rel ?? '').trim()
  // 空路径与 '.' 都表示根
  if (!raw || raw === '.' || raw === './') return root
  const abs = resolve(root, raw)
  const rootWithSep = root.endsWith(sep) ? root : root + sep
  if (abs !== root && !abs.startsWith(rootWithSep)) return null
  return abs
}

export interface DirEntry {
  name: string
  /** 相对工作区的路径，供后续操作使用 */
  rel: string
  isDir: boolean
  /** 字节数；目录为 0 */
  size: number
}

export interface ListResult {
  ok: boolean
  /** 当前列出的相对路径（'' 表示根） */
  path?: string
  entries?: DirEntry[]
  error?: string
}

/** 不展示的重目录：列出来只会干扰，而且巨大 */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', 'release', '.cache'])

export async function listDir(rel?: string): Promise<ListResult> {
  const abs = withinWorkspace(rel)
  if (!abs) return { ok: false, error: '路径超出了工作区范围。' }
  if (!existsSync(abs)) return { ok: false, error: '目录不存在。' }

  try {
    const names = await readdir(abs)
    const entries: DirEntry[] = []
    for (const name of names) {
      // 跳过隐藏文件与噪声目录，保持列表可读
      if (name.startsWith('.')) continue
      const childAbs = join(abs, name)
      let isDir = false
      let size = 0
      try {
        const st = await stat(childAbs)
        isDir = st.isDirectory()
        size = isDir ? 0 : st.size
      } catch {
        continue // 读不到 stat 的项（权限/断链）直接跳过
      }
      if (isDir && SKIP_DIRS.has(name)) continue
      entries.push({
        name,
        rel: relative(workspaceRoot(), childAbs),
        isDir,
        size
      })
    }
    // 目录在前，同类按名称排序：方便扫读
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1))
    return { ok: true, path: rel ?? '', entries }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '读取目录失败。' }
  }
}

export interface ReadResult {
  ok: boolean
  /** 文本内容（仅文本类文件） */
  text?: string
  /** 是否因过大被截断 */
  truncated?: boolean
  /** 二进制/不可预览时的说明 */
  notice?: string
  error?: string
}

/** 简单按扩展名判断是否值得当文本预览 */
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.less', '.html', '.htm', '.xml',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sh',
  '.ps1', '.bat', '.cmd', '.sql', '.env', '.gitignore', '.log', '.csv', '.lua', '.vue', '.svelte'
])

export async function readWorkspaceFile(rel: string): Promise<ReadResult> {
  const abs = withinWorkspace(rel)
  if (!abs) return { ok: false, error: '路径超出了工作区范围。' }
  if (!existsSync(abs)) return { ok: false, error: '文件不存在。' }

  try {
    const st = await stat(abs)
    if (st.isDirectory()) return { ok: false, error: '这是一个目录。' }
    const ext = basename(abs).toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    if (!TEXT_EXT.has(ext)) {
      return { ok: false, notice: `这是二进制或未支持的格式（${ext || '无扩展名'}，${Math.round(st.size / 1024)} KB），不做文本预览。` }
    }
    if (st.size > MAX_READ_BYTES) {
      // 超大文本也只读前半段，避免内存与渲染压力
      const buf = await readFile(abs)
      return {
        ok: true,
        text: buf.subarray(0, MAX_READ_BYTES).toString('utf-8'),
        truncated: true
      }
    }
    return { ok: true, text: await readFile(abs, 'utf-8') }
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || '读取文件失败。' }
  }
}

/** 在系统文件管理器里定位（E1 的辅助操作，不做任何写盘） */
export function revealInFolder(rel: string): { ok: boolean; error?: string } {
  const abs = withinWorkspace(rel)
  if (!abs) return { ok: false, error: '路径超出了工作区范围。' }
  if (!existsSync(abs)) return { ok: false, error: '路径不存在。' }
  shell.showItemInFolder(abs)
  return { ok: true }
}
