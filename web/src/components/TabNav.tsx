import type { ReactNode } from 'react'

export interface TabItem<T extends string> {
  key: T
  label: string
  /** 标签后的次要计数，如题数 / 条数 */
  badge?: ReactNode
}

/**
 * 底部指示条式标签栏：用于一个面板内的若干平级视图。
 *
 * 纪律：与 Segmented 分工——Segmented 用于「设置项切换」（控件感），
 * TabNav 用于「内容视图切换」（导航感）。同一层级不要混用。
 */
export default function TabNav<T extends string>({
  value,
  items,
  onChange,
  ariaLabel,
  className = '',
}: {
  value: T
  items: TabItem<T>[]
  onChange: (key: T) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle ${className}`}
    >
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => {
              const index = items.findIndex((entry) => entry.key === value)
              if (event.key === 'ArrowRight') {
                event.preventDefault()
                onChange(items[(index + 1) % items.length].key)
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault()
                onChange(items[(index - 1 + items.length) % items.length].key)
              }
            }}
            className={`relative shrink-0 whitespace-nowrap px-3 py-3 text-[13px] transition-colors duration-150 ${
              active ? 'font-semibold text-primary' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            {item.label}
            {item.badge != null && (
              <span className="tnum ml-1 text-[11px] font-normal text-ink-muted">{item.badge}</span>
            )}
            {active && (
              <span
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                aria-hidden
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
