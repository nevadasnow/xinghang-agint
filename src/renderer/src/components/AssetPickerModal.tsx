import { useEffect, useState } from 'react'

interface AssetItem {
  name: string
  url: string
  kind: 'image' | 'video'
  size: number
  mtime: number
}

interface Props {
  open: boolean
  /** 只展示该类型：'image' 头像/背景卡 / 'video' 开屏 / 'all' 界面背景 */
  kind: 'image' | 'video' | 'all'
  onClose: () => void
  /** 用户选中某个素材 */
  onPick: (item: AssetItem) => void
  /** 弹窗标题，默认「素材库」 */
  title?: string
}

/** 素材库选择弹窗：网格浏览 + 导入 + 打开素材库文件夹 + 选择 */
export default function AssetPickerModal({ open, kind, onClose, onPick, title }: Props) {
  const [items, setItems] = useState<AssetItem[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    setBusy(true)
    try {
      const list = (await window.shorekeeper.assetsList()) as AssetItem[]
      setItems(
        kind === 'all'
          ? list
          : list.filter((it) => it.kind === kind)
      )
    } catch {
      setItems([])
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    setMsg('')
    void refresh()
  }, [open, kind])

  if (!open) return null

  const fmtSize = (b: number): string => {
    if (b >= 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + ' MB'
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB'
    return b + ' B'
  }

  const handleImport = async () => {
    setBusy(true)
    setMsg('')
    const r = (await window.shorekeeper.assetsImport()) as
      | AssetItem
      | null
      | { error: string }
    setBusy(false)
    if (!r) {
      setMsg('已取消')
      return
    }
    if ('error' in r) {
      setMsg(r.error)
      return
    }
    setMsg(`已导入：${r.name}`)
    void refresh()
  }

  const handleOpenDir = () => {
    void window.shorekeeper.assetsOpenDir()
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal asset-picker panel" onClick={(e) => e.stopPropagation()}>
        <div className="asset-picker-head">
          <div className="asset-picker-title">{title ?? '素材库'}</div>
          <div className="asset-picker-ops">
            <button className="btn-ghost btn-sm" onClick={handleImport} disabled={busy}>
              {busy ? '处理中…' : '导入素材'}
            </button>
            <button className="btn-ghost btn-sm" onClick={handleOpenDir}>
              打开素材库文件夹
            </button>
            <button className="modal-close" onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
        </div>

        <div className="asset-picker-grid">
          {items.length === 0 ? (
            <div className="asset-picker-empty">
              素材库还没有可用的{kind === 'video' ? '视频' : kind === 'image' ? '图片' : '媒体文件'}。
              <br />
              点「导入素材」添加，或直接往工程的「素材库」文件夹放文件后刷新。
            </div>
          ) : (
            items.map((it) => (
              <div
                key={it.url}
                className="asset-picker-item"
                title={`${it.name}\n${it.kind === 'video' ? '视频' : '图片'} · ${fmtSize(it.size)}`}
                onClick={() => onPick(it)}
              >
                {it.kind === 'video' ? (
                  <div className="asset-picker-video">▶</div>
                ) : (
                  <img className="asset-picker-thumb" src={it.url} alt={it.name} loading="lazy" />
                )}
                <span className="asset-picker-name">{it.name}</span>
              </div>
            ))
          )}
        </div>

        <div className="asset-picker-foot">
          <span>{items.length ? `共 ${items.length} 项` : (msg || '')}</span>
          <span>{msg || '文件只在本机读取，不会上传'}</span>
        </div>
      </div>
    </div>
  )
}
