import { useEffect, useState } from 'react'
import {
  getAppBgConfig,
  getSplashConfig,
  type AppBgConfig,
  type SplashConfig
} from '../utils/uiPrefs'

/**
 * 全局自定义界面背景（设置·外观）：
 * 图片用 background，视频用 <video>，统一盖住默认海面背景，正文在其上。
 */
export function AppBgLayer() {
  const [bg, setBg] = useState<AppBgConfig>(getAppBgConfig)

  useEffect(() => {
    const on = (e: Event) => setBg((e as CustomEvent<AppBgConfig>).detail ?? getAppBgConfig())
    window.addEventListener('sk:app-bg-changed', on)
    return () => window.removeEventListener('sk:app-bg-changed', on)
  }, [])

  if (!bg.enabled || !bg.source) return null

  const fitCss =
    bg.fit === 'contain'
      ? 'contain'
      : bg.fit === 'stretch'
        ? '100% 100%'
        : 'cover'

  return (
    <div className="app-bg-layer" aria-hidden="true">
      {bg.type === 'video' ? (
        <video
          className="app-bg-media"
          src={bg.source}
          autoPlay
          muted
          loop
          playsInline
          style={{ objectFit: bg.fit === 'stretch' ? undefined : bg.fit, opacity: bg.opacity / 100, filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined }}
        />
      ) : (
        <div
          className="app-bg-media"
          style={{
            backgroundImage: `url("${bg.source}")`,
            backgroundSize: fitCss,
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat',
            opacity: bg.opacity / 100,
            filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined
          }}
        />
      )}
      <div className="app-bg-veil" style={{ background: bg.veilColor, opacity: bg.veil / 100 }} />
    </div>
  )
}

/**
 * 开屏动画（设置·外观）：应用启动时全屏播放一段视频，
 * 播放完 / 点击任意处后渐隐进入主界面；仅每次启动播放一次。
 */
export function SplashOverlay() {
  const [cfg] = useState<SplashConfig>(getSplashConfig)
  const [closing, setClosing] = useState(false)
  const [gone, setGone] = useState(false)

  // 未启用或没有视频 → 不渲染
  if (!cfg.enabled || !cfg.video || gone) return null

  const close = () => {
    if (closing) return
    setClosing(true)
    window.setTimeout(() => setGone(true), 600)
  }

  return (
    <div
      className={'splash-overlay' + (closing ? ' closing' : '')}
      onClick={close}
      role="button"
      aria-label="跳过开屏动画"
    >
      <video
        className="splash-video"
        src={cfg.video}
        autoPlay
        muted={!cfg.sound}
        playsInline
        onEnded={close}
        onError={close}
      />
      <div className="splash-hint">点击任意处跳过 · 设置 → 外观 可关闭开屏动画</div>
    </div>
  )
}
