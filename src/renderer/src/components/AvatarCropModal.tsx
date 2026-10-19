import { useEffect, useRef, useState } from 'react'

interface Props {
  open: boolean
  /** 待裁剪图片（dataURL） */
  image: string | null
  onClose: () => void
  /** 确认裁切，返回生成的 dataURL */
  onConfirm: (dataUrl: string) => void
  /** true：选区外叠加半透明黑色遮罩（自定义头像/背景卡用）；false：不加遮罩 */
  dimOutside?: boolean
  /** 选区形状：'circle' 圆形头像（默认）| 'rect' 矩形（角色背景卡等） */
  shape?: 'circle' | 'rect'
  /** shape='rect' 时选区宽高比（宽/高），默认 1.78（首页角色卡背景比例） */
  rectRatio?: number
  /** shape='rect' 时的输出尺寸（像素），默认 1000x560 */
  outWidth?: number
  outHeight?: number
}

/** 裁剪区可用最大边长（界面随图片比例自适应，不出现滚动条） */
const AVAIL = 400
/** 圆形选区半径占短边的比例（留出边缘便于看清边界） */
const RATIO = 0.44
const OUT = 256 // 圆形输出头像边长

/** 裁剪弹窗：界面自适应图片比例；
 *  circle：圆内为头像区域；rect：矩形内为背景卡区域；
 *  dimOutside 时选区外为半透明黑色遮罩（拖拽移动 · 滚轮缩放） */
export default function AvatarCropModal({
  open,
  image,
  onClose,
  onConfirm,
  dimOutside = false,
  shape = 'circle',
  rectRatio = 1.78,
  outWidth = 1000,
  outHeight = 560
}: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)

  useEffect(() => {
    if (!open || !image) return
    setPos({ x: 0, y: 0 })
    setScale(1)
    setImg(null)
    const im = new Image()
    im.onload = () => setImg(im)
    im.onerror = () => setImg(null)
    im.src = image
  }, [open, image])

  if (!open) return null

  // 图片渲染尺寸：contain 于 AVAIL×AVAIL，保持原始比例
  const ratio = img ? img.naturalHeight / img.naturalWidth : 1
  const boxW = img ? (ratio <= 1 ? AVAIL : AVAIL / ratio) : AVAIL
  const boxH = img ? (ratio <= 1 ? AVAIL * ratio : AVAIL) : AVAIL
  // 圆形选区：半径（circle）
  const R = (Math.min(boxW, boxH) * RATIO) || 1
  // 矩形选区：半宽/半高（rect），按 rectRatio 对齐，越界时以高度收约束
  const rw = Math.min(boxW * RATIO, boxH * RATIO * rectRatio) || 1
  const rh = rw / rectRatio || 1

  function onMouseDown(e: React.MouseEvent) {
    drag.current = { sx: e.clientX, sy: e.clientY, px: pos.x, py: pos.y }
    e.preventDefault()
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!drag.current) return
    setPos({
      x: drag.current.px + (e.clientX - drag.current.sx),
      y: drag.current.py + (e.clientY - drag.current.sy)
    })
  }

  function endDrag() {
    drag.current = null
  }

  function onWheel(e: React.WheelEvent) {
    const s = Math.min(5, Math.max(0.5, scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
    setScale(s)
  }

  function confirm() {
    if (!img) return
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // 渲染尺寸 → 图片原始像素 换算系数（均匀缩放，两个方向一致）
    const fx = img.naturalWidth / boxW
    const fy = img.naturalHeight / boxH
    // 选区中心（容器中心）映射到图片原始像素坐标
    const cx = (-pos.x / scale + boxW / 2) * fx
    const cy = (-pos.y / scale + boxH / 2) * fy
    if (shape === 'circle') {
      canvas.width = OUT
      canvas.height = OUT
      let d = ((R * 2) / scale) * fx // 图片原始像素直径
      let sx = cx - d / 2
      let sy = cy - d / 2
      if (d > img.naturalWidth) {
        d = img.naturalWidth
        sx = 0
      } else {
        sx = Math.max(0, Math.min(img.naturalWidth - d, sx))
      }
      if (d > img.naturalHeight) {
        d = img.naturalHeight
        sy = 0
      } else {
        sy = Math.max(0, Math.min(img.naturalHeight - d, sy))
      }
      ctx.drawImage(img, sx, sy, d, d, 0, 0, OUT, OUT)
    } else {
      // 矩形：按选区比例输出
      canvas.width = outWidth
      canvas.height = outHeight
      let dw = ((rw * 2) / scale) * fx
      let dh = ((rh * 2) / scale) * fy
      // 越界收敛（整体等比缩小，保持比例不变形）
      const k = Math.min(1, img.naturalWidth / dw, img.naturalHeight / dh)
      dw *= k
      dh *= k
      const sx = Math.max(0, Math.min(img.naturalWidth - dw, cx - dw / 2))
      const sy = Math.max(0, Math.min(img.naturalHeight - dh, cy - dh / 2))
      ctx.drawImage(img, sx, sy, dw, dh, 0, 0, outWidth, outHeight)
    }
    const dataUrl = canvas.toDataURL('image/png')
    onConfirm(dataUrl)
  }

  const maskId = 'crop-dim-mask'

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal crop-modal panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{shape === 'circle' ? '移动和缩放' : '移动和缩放（背景卡选区）'}</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div
          className="crop-box"
          style={{ width: boxW, height: boxH }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
          onWheel={onWheel}
        >
          {img ? (
            <img
              src={image ?? undefined}
              alt="待裁剪"
              draggable={false}
              style={{
                position: 'absolute',
                left: boxW / 2,
                top: boxH / 2,
                width: boxW,
                height: boxH,
                transform: `translate(-50%, -50%) translate(${pos.x}px, ${pos.y}px) scale(${scale})`
              }}
            />
          ) : (
            <span className="crop-loading">加载中……</span>
          )}
          {/* 选区框：圆形（虚线圆）或矩形（虚线框） */}
          {shape === 'circle' ? (
            <span className="crop-circle" style={{ width: R * 2, height: R * 2 }} aria-hidden="true" />
          ) : (
            <span className="crop-rect" style={{ width: rw * 2, height: rh * 2 }} aria-hidden="true" />
          )}
          {/* 选区外半透明黑色遮罩（自定义头像 / 背景卡） */}
          {dimOutside && (
            <svg
              className="crop-dim"
              width={boxW}
              height={boxH}
              viewBox={`0 0 ${boxW} ${boxH}`}
              aria-hidden="true"
            >
              <defs>
                <mask id={maskId}>
                  <rect width={boxW} height={boxH} fill="#ffffff" />
                  {shape === 'circle' ? (
                    <circle cx={boxW / 2} cy={boxH / 2} r={R} fill="#000000" />
                  ) : (
                    <rect
                      x={boxW / 2 - rw}
                      y={boxH / 2 - rh}
                      width={rw * 2}
                      height={rh * 2}
                      fill="#000000"
                    />
                  )}
                </mask>
              </defs>
              <rect width={boxW} height={boxH} fill="rgba(8, 14, 24, 0.55)" mask={`url(#${maskId})`} />
            </svg>
          )}
        </div>

        <div className="crop-tip">
          拖拽图片移动 · 滚轮缩放 · {shape === 'circle' ? '圆内即头像区域' : '框内即背景卡区域'}
          {dimOutside ? '，框外为半透明区域' : ''}
        </div>

        <div className="modal-actions crop-actions">
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={confirm} disabled={!img}>
            确认
          </button>
        </div>
      </div>
    </div>
  )
}
