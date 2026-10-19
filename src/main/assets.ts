import { app, shell } from 'electron'
import { join } from 'path'
import { copyFile, mkdir, readdir, stat } from 'fs/promises'

/**
 * 媒体素材库：头像 / 背景卡 / 开屏视频 / 界面背景共用。
 *  - 素材库目录：工程根/素材库（用户可直接放入文件，也便于打开）
 *  - 自定义媒体目录：userData/custom-media（「选择文件，不导入素材库」时复制到此，持久可用）
 * 统一通过 skmedia:// 协议读取（local=素材库 / ext=自定义媒体）。
 */

export const ASSETS_DIR = join(app.getAppPath(), '素材库')
export const CUSTOM_MEDIA_DIR = join(app.getPath('userData'), 'custom-media')

export const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.avif', '.ico'])
export const VID_EXTS = new Set(['.mp4', '.webm', '.mov', '.m4v', '.mkv', '.avi'])

const MEDIA_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo'
}

export type MediaZone = 'local' | 'ext'

export interface AssetItem {
  name: string
  url: string
  kind: 'image' | 'video'
  size: number
  mtime: number
}

export function mediaKind(ext: string): 'image' | 'video' | null {
  const e = ext.toLowerCase()
  if (IMG_EXTS.has(e)) return 'image'
  if (VID_EXTS.has(e)) return 'video'
  return null
}

export function mimeOf(ext: string): string {
  return MEDIA_MIME[ext.toLowerCase()] ?? 'application/octet-stream'
}

export function zoneDir(zone: MediaZone): string {
  return zone === 'local' ? ASSETS_DIR : CUSTOM_MEDIA_DIR
}

export async function ensureMediaDirs(): Promise<void> {
  await mkdir(ASSETS_DIR, { recursive: true })
  await mkdir(CUSTOM_MEDIA_DIR, { recursive: true })
}

export async function listAssets(zone?: MediaZone): Promise<AssetItem[]> {
  await ensureMediaDirs()
  const zones: MediaZone[] = zone ? [zone] : ['local']
  const out: AssetItem[] = []
  for (const z of zones) {
    let entries: string[] = []
    try {
      entries = await readdir(zoneDir(z))
    } catch {
      continue
    }
    for (const entry of entries) {
      const ext = (entry.match(/\.[^.]+$/) || [''])[0].toLowerCase()
      const kind = mediaKind(ext)
      if (!kind) continue
      const full = join(zoneDir(z), entry)
      try {
        const info = await stat(full)
        if (!info.isFile()) continue
        out.push({
          name: entry,
          url: `skmedia://${z}/${encodeURIComponent(entry)}`,
          kind,
          size: info.size,
          mtime: info.mtimeMs
        })
      } catch {
        /* 单个文件失败跳过 */
      }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

/** 复制文件到指定区域；重名时自动追加序号（x.png → x-2.png） */
export async function importMedia(src: string, zone: MediaZone): Promise<AssetItem> {
  await ensureMediaDirs()
  const dir = zoneDir(zone)
  const ext = (src.match(/\.[^.]+$/) || [''])[0].toLowerCase()
  const kind = mediaKind(ext)
  if (!kind) throw new Error('仅支持图片 / 视频文件')
  const info = await stat(src)
  if (!info.isFile()) throw new Error('文件不存在')
  if (info.size > 500 * 1024 * 1024) throw new Error('文件超过 500MB 上限')
  const base = src.replace(/\.[^.]+$/, '').split(/[\\/]/).pop() || 'asset'
  let name = base + ext
  let n = 2
  while (true) {
    try {
      await copyFile(src, join(dir, name))
      break
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EEXIST') {
        name = `${base}-${n}${ext}`
        n += 1
        continue
      }
      throw e
    }
  }
  const final = await stat(join(dir, name))
  return {
    name,
    url: `skmedia://${zone}/${encodeURIComponent(name)}`,
    kind,
    size: final.size,
    mtime: final.mtimeMs
  }
}

/** 在系统文件管理器中打开素材库文件夹 */
export function openAssetDirInShell(): Promise<string> {
  return shell.openPath(ASSETS_DIR)
}
