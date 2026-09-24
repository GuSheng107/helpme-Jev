import { useEffect, useRef, useState, type ReactNode } from 'react'
import { avatarDataUrl, type UserSummary } from '../api/auth'

export type AppPage =
  | 'home'
  | 'chat'
  | 'decide'
  | 'personas'
  | 'scenarios'
  | 'logs'
  | 'settings'
  | 'users'
  | 'invitations'

const NAV: { page: AppPage; label: string; admin?: boolean }[] = [
  { page: 'home', label: '首页' },
  { page: 'chat', label: '聊天' },
  { page: 'decide', label: '决策' },
  { page: 'personas', label: '人设' },
  { page: 'scenarios', label: '场景' },
  { page: 'logs', label: '日志' },
  { page: 'users', label: '用户', admin: true },
  { page: 'invitations', label: '邀请码', admin: true },
  { page: 'settings', label: '设置' },
]

interface Props {
  page: AppPage
  user: UserSummary
  onNavigate: (page: AppPage) => void
  onLogout: () => void
  children: ReactNode
}

/** 登录后的骨架：左侧导航 + 顶部用户栏。页面内容原样放进来。 */
export default function AppShell({ page, user, onNavigate, onLogout, children }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function close(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const naturalScroll = page === 'decide'
  return (
    <div className={`flex bg-page text-ink ${naturalScroll ? 'min-h-screen' : 'h-screen'}`}>
      <aside className={`hidden w-44 shrink-0 flex-col border-r border-border bg-surface lg:flex ${naturalScroll ? 'sticky top-0 h-screen self-start' : ''}`}>
        <div className="flex h-14 items-center gap-2 px-4">
          <Mark />
          <span className="text-[15px] font-semibold">HelpMe Jev</span>
        </div>
        <nav className={`flex flex-1 flex-col gap-0.5 px-2 py-2 ${naturalScroll ? '' : 'overflow-auto'}`}>
          {NAV.filter((item) => !item.admin || user.role === 'admin').map((item) => (
            <button
              key={item.page}
              type="button"
              onClick={() => onNavigate(item.page)}
              className={`rounded-[6px] px-3 py-2 text-left text-[14px] ${
                page === item.page
                  ? 'bg-primary-soft font-medium text-primary'
                  : 'text-ink-secondary hover:bg-surface-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className={`flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 ${naturalScroll ? 'sticky top-0 z-20' : ''}`}>
          <span className="text-[14px] text-ink-muted lg:hidden">HelpMe Jev</span>
          <span className="hidden lg:block" />
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex items-center gap-2 rounded-[6px] px-2 py-1 hover:bg-surface-muted"
            >
              {user.avatar_base64 ? (
                <img
                  src={avatarDataUrl(user.avatar_base64)}
                  alt=""
                  className="h-7 w-7 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-medium leading-none text-white">
                  {(user.display_name || user.username).slice(0, 1)}
                </span>
              )}
              <span className="text-[14px] text-ink">{user.display_name || user.username}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-30 w-44 rounded-[8px] border border-border bg-surface py-1 shadow-[0_8px_24px_rgb(0_0_0/0.08)]">
                <p className="truncate px-3 py-1.5 text-[12px] text-ink-muted">{user.username}</p>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-[14px] text-ink hover:bg-surface-muted"
                  onClick={() => {
                    setMenuOpen(false)
                    onNavigate('settings')
                  }}
                >
                  账号设置
                </button>
                <button
                  type="button"
                  className="block w-full border-t border-border-subtle px-3 py-2 text-left text-[14px] text-danger hover:bg-surface-muted"
                  onClick={onLogout}
                >
                  退出
                </button>
              </div>
            )}
          </div>
        </header>

        <div className={naturalScroll ? 'flex-1' : 'min-h-0 flex-1 overflow-auto'}>{children}</div>

        <nav className={`flex shrink-0 overflow-x-auto border-t border-border bg-surface lg:hidden ${naturalScroll ? 'sticky bottom-0 z-20' : ''}`}>
          {NAV.filter((item) => !item.admin || user.role === 'admin').map((item) => (
            <button
              key={item.page}
              type="button"
              onClick={() => onNavigate(item.page)}
              className={`flex-1 py-2 text-[12px] ${page === item.page ? 'font-medium text-primary' : 'text-ink-muted'}`}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

function Mark() {
  return (
    <svg viewBox="0 0 40 40" className="h-7 w-7" aria-hidden>
      <rect width="40" height="40" rx="12" fill="#409eff" />
      <path d="M8.5 13.5h15a3 3 0 0 1 3 3v5.2a3 3 0 0 1-3 3H15l-3.6 2.8v-2.8h-.9a3 3 0 0 1-3-3v-5.2a3 3 0 0 1 3-3Z" fill="white" />
      <path
        d="M17 17.2h13.4a2.6 2.6 0 0 1 2.6 2.6v4.6a2.6 2.6 0 0 1-2.6 2.6h-1v2.4L26 27h-9a2.6 2.6 0 0 1-2.6-2.6v-4.6a2.6 2.6 0 0 1 2.6-2.6Z"
        fill="white"
        fillOpacity="0.92"
        stroke="#409eff"
        strokeWidth="1.4"
      />
      <circle cx="21.2" cy="22.1" r="1.05" fill="#409eff" />
      <circle cx="24.6" cy="22.1" r="1.05" fill="#409eff" />
      <circle cx="28" cy="22.1" r="1.05" fill="#409eff" />
    </svg>
  )
}
