import { useRef, useState } from 'react'
import {
  DEFAULT_USER_NAME,
  getUserProfile,
  setUserProfile,
  type UserProfile
} from '../utils/uiPrefs'
import AvatarCropModal from './AvatarCropModal'

interface Props {
  open: boolean
  onClose: () => void
}

/**
 * 用户信息界面（全屏）：头像 / 名称 / 签名。
 * 左栏左下角用户区选项卡与设置「用户信息」共用同一份数据（localStorage）。
 */
export default function UserProfileModal({ open, onClose }: Props) {
  const [profile, setProfileState] = useState<UserProfile>(() => getUserProfile())
  const [name, setName] = useState(() => getUserProfile().name)
  const [bio, setBio] = useState(() => getUserProfile().bio)
  const [avatar, setAvatar] = useState(() => getUserProfile().avatar)
  const [msg, setMsg] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [cropOpen, setCropOpen] = useState(false)
  const [cropImage, setCropImage] = useState<string | null>(null)

  if (!open) return null

  /** 选择图片 → 打开裁剪界面（与 Agent 头像同款：缩放移动圆框选择） */
  function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>): void {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = () => {
      const data = String(reader.result ?? '')
      setCropImage(data)
      setCropOpen(true)
      setMsg('')
      if (fileRef.current) fileRef.current.value = ''
    }
    reader.readAsDataURL(f)
  }

  /** 裁剪确认：以圆内区域作为头像 */
  function onCropConfirm(dataUrl: string): void {
    setAvatar(dataUrl)
    setProfileState((p) => ({ ...p, avatar: dataUrl }))
    setCropOpen(false)
    setCropImage(null)
  }

  function save(): void {
    // 保留已有的 facts/dates/profileEnabled：这个弹窗只编辑基础信息，
    // 若整体重建对象会把设置里填的事实与日期清空（C1/C4）
    const prev = getUserProfile()
    const next: UserProfile = {
      name: name.trim() || DEFAULT_USER_NAME,
      bio: bio.trim(),
      avatar,
      facts: prev.facts,
      dates: prev.dates,
      profileEnabled: prev.profileEnabled
    }
    setUserProfile(next)
    setProfileState(next)
    setMsg('已保存到本机（localStorage），仅本地生效')
    window.dispatchEvent(new CustomEvent('sk:user-profile-changed'))
  }

  function resetAvatar(): void {
    setAvatar('')
    setProfileState((p) => ({ ...p, avatar: '' }))
    setMsg('')
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal profile-modal panel" onClick={(e) => e.stopPropagation()}>
        <AvatarCropModal open={cropOpen} image={cropImage} onClose={() => setCropOpen(false)} onConfirm={onCropConfirm} />
        <div className="modal-head">
          <button className="btn-back" onClick={onClose} aria-label="返回">
            ← 返回
          </button>
          <h3>用户信息</h3>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="profile-form">
          <div className="profile-avatar-wrap">
            <div className="profile-avatar-lg">
              {avatar ? <img src={avatar} alt="用户头像" /> : <span className="profile-avatar-d">👤</span>}
            </div>
            <div className="profile-avatar-ops">
              <button className="btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                更换头像
              </button>
              {avatar && (
                <button className="btn-ghost btn-sm" onClick={resetAvatar}>
                  恢复默认
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onPickAvatar} />
            </div>
          </div>

          <label className="field">
            <span>名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={DEFAULT_USER_NAME} maxLength={24} />
          </label>

          <label className="field">
            <span>签名</span>
            <textarea
              className="field-textarea"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="写一句签名，例如：潮汐之间，回声未歇……"
              rows={3}
              maxLength={80}
            />
          </label>

          <p className="appearance-hint">头像与名称显示在界面左下角；数据仅保存在本机，不会上传。</p>
          {msg && <p className="modal-msg">{msg}</p>}

          <div className="modal-actions">
            <button className="btn-ghost" onClick={onClose}>
              关闭
            </button>
            <button className="btn-primary" onClick={save}>
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
