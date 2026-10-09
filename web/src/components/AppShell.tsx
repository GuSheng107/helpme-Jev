import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react'
import { avatarDataUrl, type UserSummary } from '../api/auth'
import {
  IconChat,
  IconChevronDown,
  IconDecide,
  IconHome,
  IconLog,
  IconPersona,
  IconScenario,
  IconSettings,
  IconTicket,
  IconUsers,
} from './icons'

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

type Icon = ComponentType<SVGProps<SVGSVGElement>>

interface NavItem {
  page: AppPage
  label: string
  icon: Icon
  admin?: boolean
}

interface NavGroup {
  title: string
  items: NavItem[]
}

/** 导航信息架构：按「工作台 / 资料 / 系统」三层组织。 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: '工作台',
    items: [
      { page: 'home', label: '首页', icon: IconHome },
      { page: 'chat', label: '聊天', icon: IconChat },
      { page: 'decide', label: '决策', icon: IconDecide },
    ],
  },
  {
    title: '关系资料',
    items: [
      { page: 'personas', label: '人设', icon: IconPersona },
      { page: 'scenarios', label: '场景', icon: IconScenario },
    ],
  },
  {
    title: '系统',
    items: [
      { page: 'logs', label: '日志', icon: IconLog },
      { page: 'users', label: '用户', icon: IconUsers, admin: true },
      { page: 'invitations', label: '邀请码', icon: IconTicket, admin: true },
      { page: 'settings', label: '设置', icon: IconSettings },
    ],
  },
]

const FLAT_NAV: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)

interface Props {
  page: AppPage
  user: UserSummary
  onNavigate: (page: AppPage) => void
  onLogout: () => void
  children: ReactNode
}

/** 登录后的骨架：左侧导航 + 内容区；移动端为顶栏 + 底部标签栏。 */
export default function AppShell({ page, user, onNavigate, onLogout, children }: Props) {
  const visible = (item: NavItem) => !item.admin || user.role === 'admin'

  return (
    <div className="flex h-screen bg-canvas text-ink">
      {/* ---------------------------------------------------- 桌面侧栏 */}
      <aside className="hidden w-[236px] shrink-0 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <Mark />
          <div className="leading-none">
            <p className="text-[16px] font-semibold tracking-tight text-ink">HelpMe JEV</p>
            <p className="mt-1 text-[11px] text-ink-faint">决策与表达分离</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
          {NAV_GROUPS.map((group) => {
            const items = group.items.filter(visible)
            if (items.length === 0) return null
            return (
              <div key={group.title} className="flex flex-col gap-0.5">
                <p className="px-3 pb-1 pt-1 text-[11px] font-medium tracking-wide text-ink-faint">
                  {group.title}
                </p>
                {items.map((item) => (
                  <NavButton
                    key={item.page}
                    item={item}
                    active={page === item.page}
                    onClick={() => onNavigate(item.page)}
                  />
                ))}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-border-subtle p-3">
          <UserCapsule user={user} onNavigate={onNavigate} onLogout={onLogout} placement="up" />
        </div>
      </aside>

      {/* ---------------------------------------------------- 主区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4 lg:hidden">
          <div className="flex items-center gap-2">
            <Mark className="h-7 w-7" />
            <span className="text-[16px] font-semibold tracking-tight">HelpMe JEV</span>
          </div>
          <UserCapsule user={user} onNavigate={onNavigate} onLogout={onLogout} placement="down" compact />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        <nav className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-border bg-surface px-2 pb-[max(6px,env(safe-area-inset-bottom))] pt-1.5 lg:hidden">
          {FLAT_NAV.filter(visible).map((item) => {
            const active = page === item.page
            const ItemIcon = item.icon
            return (
              <button
                key={item.page}
                type="button"
                onClick={() => onNavigate(item.page)}
                className={`flex min-w-[62px] flex-1 flex-col items-center gap-1 rounded-[10px] px-2 py-1.5 transition-colors duration-150 ${
                  active ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-surface-muted'
                }`}
              >
                <ItemIcon className="h-5 w-5" />
                <span className={`text-[11px] leading-none ${active ? 'font-medium' : ''}`}>
                  {item.label}
                </span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 子组件 */

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  const ItemIcon = item.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-2.5 rounded-[9px] px-3 py-2 text-[14px] transition-colors duration-150 ${
        active
          ? 'bg-primary-soft font-medium text-primary'
          : 'text-ink-secondary hover:bg-surface-muted hover:text-ink'
      }`}
    >
      <ItemIcon
        className={`h-[18px] w-[18px] shrink-0 transition-colors duration-150 ${
          active ? 'text-primary' : 'text-ink-muted group-hover:text-ink-secondary'
        }`}
      />
      {item.label}
    </button>
  )
}

function UserCapsule({
  user,
  onNavigate,
  onLogout,
  placement,
  compact = false,
}: {
  user: UserSummary
  onNavigate: (page: AppPage) => void
  onLogout: () => void
  placement: 'up' | 'down'
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function close(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const name = user.display_name || user.username

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`flex items-center gap-2.5 rounded-[10px] transition-colors duration-150 hover:bg-surface-muted ${
          compact ? 'p-1' : 'w-full px-2 py-2'
        }`}
      >
        <Avatar user={user} size={compact ? 30 : 32} />
        {!compact && (
          <>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
              <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                {user.role === 'admin' ? '管理员' : '成员'}
              </span>
            </span>
            <IconChevronDown
              className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${
                open ? 'rotate-180' : ''
              }`}
            />
          </>
        )}
      </button>

      {open && (
        <div
          className={`absolute z-40 overflow-hidden rounded-[12px] border border-border bg-surface p-1 shadow-lg ${
            compact ? 'right-0 w-44' : 'left-0 right-0'
          } ${placement === 'up' ? 'bottom-[calc(100%+8px)] animate-slide-up' : 'top-[calc(100%+8px)] animate-slide-down'}`}
        >
          <p className="truncate px-3 py-1.5 text-[11px] text-ink-faint">{user.username}</p>
          <button
            type="button"
            className="block w-full rounded-[8px] px-3 py-2 text-left text-[13px] text-ink transition-colors hover:bg-surface-muted"
            onClick={() => {
              setOpen(false)
              onNavigate('settings')
            }}
          >
            账号设置
          </button>
          <button
            type="button"
            className="block w-full rounded-[8px] px-3 py-2 text-left text-[13px] text-danger transition-colors hover:bg-danger-soft"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
          >
            退出登录
          </button>
        </div>
      )}
    </div>
  )
}

function Avatar({ user, size }: { user: UserSummary; size: number }) {
  const style = { width: size, height: size }
  if (user.avatar_base64) {
    return (
      <img
        src={avatarDataUrl(user.avatar_base64)}
        alt=""
        style={style}
        className="shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    )
  }
  return (
    <span
      style={style}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-medium leading-none text-white"
    >
      {(user.display_name || user.username).slice(0, 1)}
    </span>
  )
}

/** 品牌标识：渐变圆角底 + 对话气泡。 */
export function Mark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="hmj-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#2f6bff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#hmj-mark)" />
      <path
        d="M10.4 10.6h11.2a2.6 2.6 0 0 1 2.6 2.6v4.6a2.6 2.6 0 0 1-2.6 2.6h-5l-3.5 2.7v-2.7h-2.7a2.6 2.6 0 0 1-2.6-2.6v-4.6a2.6 2.6 0 0 1 2.6-2.6Z"
        fill="#fff"
        fillOpacity="0.96"
      />
      <circle cx="13.3" cy="15.5" r="1.15" fill="#3d74ff" />
      <circle cx="16.6" cy="15.5" r="1.15" fill="#3d74ff" />
      <circle cx="19.9" cy="15.5" r="1.15" fill="#3d74ff" />
    </svg>
  )
}
