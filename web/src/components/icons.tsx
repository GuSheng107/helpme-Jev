import type { SVGProps } from 'react'

/**
 * 图标体系：统一 24px 网格、1.7 描边、圆头圆角，纯 stroke 实现。
 * 全站只用这一套，保证视觉一致。
 */
type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

function Svg({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg {...base} aria-hidden="true" {...props}>
      {children}
    </svg>
  )
}

/* ------------------------------------------------------------------ 导航 */

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10.6 12 4l8 6.6" />
      <path d="M6.2 9.6V19a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.6" />
      <path d="M10 20v-4.6a2 2 0 0 1 4 0V20" />
    </Svg>
  )
}

export function IconChat(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11.6a7 7 0 0 1-9.7 6.5L5 19.6l1.5-4.4A7 7 0 1 1 20 11.6Z" />
      <path d="M9.2 11.7h.01M12.2 11.7h.01M15.2 11.7h.01" strokeWidth="2" />
    </Svg>
  )
}

export function IconDecide(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4.4v15.2" />
      <path d="M8 20.4h8" />
      <path d="M4 7h16" />
      <path d="M7 7 4.2 13.2a2.7 2.7 0 0 0 5.6 0L7 7Z" />
      <path d="M17 7l-2.8 6.2a2.7 2.7 0 0 0 5.6 0L17 7Z" />
      <circle cx="12" cy="4.4" r="1.5" />
    </Svg>
  )
}

export function IconPersona(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5.2 19.6a6.8 6.8 0 0 1 13.6 0" />
    </Svg>
  )
}

export function IconScenario(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.6" y="4.6" width="16.8" height="14.8" rx="2.4" />
      <circle cx="9" cy="9.4" r="1.6" />
      <path d="m4.4 17 4-3.8a1.8 1.8 0 0 1 2.5 0l3.4 3.2" />
      <path d="m13.6 15.2 1.6-1.5a1.8 1.8 0 0 1 2.5 0l2.3 2.1" />
    </Svg>
  )
}

export function IconLog(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 6.4h11M9 12h11M9 17.6h11" />
      <path d="M4.6 6.4h.01M4.6 12h.01M4.6 17.6h.01" strokeWidth="2" />
    </Svg>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.4" r="3.2" />
      <path d="M3.4 19.4a5.8 5.8 0 0 1 11.2 0" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6.2" />
      <path d="M17.4 14.6a5.8 5.8 0 0 1 3.2 4.8" />
    </Svg>
  )
}

export function IconTicket(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.4a2.2 2.2 0 0 0 0 4.4v1.4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.4a2.2 2.2 0 0 0 0-4.4V8.4Z" />
      <path d="M14 6.6v2.2M14 11v2M14 15.2v2.2" strokeDasharray="0.1 3" />
    </Svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3h.1a1.6 1.6 0 0 0 1-1.4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7v.1a1.6 1.6 0 0 0 1.4 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Svg>
  )
}

/* ------------------------------------------------------------------ 通用 */

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m15 6-6 6 6 6" />
    </Svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6 18 18M18 6 6 18" />
    </Svg>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.6" />
      <path d="m20 20-3.6-3.6" />
    </Svg>
  )
}

export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6c.5 3.2 1.9 4.6 5.1 5.1-3.2.5-4.6 1.9-5.1 5.1-.5-3.2-1.9-4.6-5.1-5.1 3.2-.5 4.6-1.9 5.1-5.1Z" />
      <path d="M17.6 14.4c.3 1.7 1 2.4 2.7 2.7-1.7.3-2.4 1-2.7 2.7-.3-1.7-1-2.4-2.7-2.7 1.7-.3 2.4-1 2.7-2.7Z" />
    </Svg>
  )
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Svg>
  )
}

export function IconRefresh(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11.5a8 8 0 1 0-1.6 5.4" />
      <path d="M20 4.6v5h-5" />
    </Svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.6 6.6h14.8" />
      <path d="M9 6.6V4.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1.8" />
      <path d="M6.4 6.6 7.3 19a1 1 0 0 0 1 1h7.4a1 1 0 0 0 1-1l.9-12.4" />
      <path d="M10.4 10.4v6M13.6 10.4v6" />
    </Svg>
  )
}

export function IconPencil(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.6 19.4h3.4l9.4-9.4a2.4 2.4 0 0 0-3.4-3.4l-9.4 9.4v3.4Z" />
      <path d="m13.2 7 3.4 3.4" />
    </Svg>
  )
}

export function IconUpload(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 15.4V4.6" />
      <path d="m7.6 9 4.4-4.4L16.4 9" />
      <path d="M5 15.4v2.6a1.6 1.6 0 0 0 1.6 1.6h10.8a1.6 1.6 0 0 0 1.6-1.6v-2.6" />
    </Svg>
  )
}

export function IconSend(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 4 3.6 10.6a.6.6 0 0 0 .1 1.1l6 2.1 2.1 6a.6.6 0 0 0 1.1.1L20 4Z" />
      <path d="m20 4-9.4 9.4" />
    </Svg>
  )
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3 1.8" />
    </Svg>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5M12 8h.01" strokeWidth="1.9" />
    </Svg>
  )
}

export function IconWarning(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.3 4.2 2.8 17.4a2 2 0 0 0 1.7 3h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.2v4M12 16.6h.01" strokeWidth="1.9" />
    </Svg>
  )
}

export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.6 5 6.4v5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9v-5l-7-2.8Z" />
      <path d="m9.2 12 2 2 3.6-3.8" />
    </Svg>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8.6" y="8.6" width="11.8" height="11.8" rx="2.4" />
      <path d="M15.4 8.6V6a1.8 1.8 0 0 0-1.8-1.8H5.4A1.8 1.8 0 0 0 3.6 6v8.2a1.8 1.8 0 0 0 1.8 1.8h2.6" />
    </Svg>
  )
}

export function IconLogout(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.4 4.6h3a1.8 1.8 0 0 1 1.8 1.8v11.2a1.8 1.8 0 0 1-1.8 1.8h-3" />
      <path d="M10 15.6 13.6 12 10 8.4" />
      <path d="M13.6 12H4.6" />
    </Svg>
  )
}

export function IconKey(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="8" cy="15.4" r="3.4" />
      <path d="m10.4 13 8-8" />
      <path d="m15.6 7.8 2 2" />
      <path d="m18.4 5 1.6 1.6" />
    </Svg>
  )
}
