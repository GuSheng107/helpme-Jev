import type { ReactNode } from 'react'
import { IconChevronLeft, IconChevronRight } from './icons'

/**
 * 分页控件：首页 / 上一页 / 页码 / 下一页 / 末页。
 *
 * 纪律：`page` 从 1 开始；翻页中把正在等的目标页传进 `pending`，
 * 让对应按钮转圈，而不是整块表格转圈。
 */
export default function Pager({
  page,
  pageCount,
  onChange,
  pending = null,
  disabled = false,
  disabledReason,
  className = '',
}: {
  page: number
  pageCount: number
  onChange: (page: number) => void
  /** 正在等待的目标页（1 起） */
  pending?: number | null
  disabled?: boolean
  disabledReason?: string
  className?: string
}) {
  const count = Math.max(1, pageCount)
  const current = Math.min(Math.max(1, page), count)
  const busy = pending !== null
  const firstReason = disabledReason ?? (current <= 1 ? '已经是第一页' : '正在查询')
  const lastReason = disabledReason ?? (current >= count ? '已经是最后一页' : '正在查询')

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <Step label="首页" icon={<DoubleChevron dir="left" />} loading={pending === 1}
        disabled={disabled || busy || current <= 1} reason={firstReason}
        onClick={() => onChange(1)} />
      <Step label="上一页" icon={<IconChevronLeft />} loading={pending === current - 1}
        disabled={disabled || busy || current <= 1} reason={firstReason}
        onClick={() => onChange(current - 1)} />
      <span className="tnum mx-0.5 min-w-16 rounded-[8px] bg-surface-muted px-2 py-1 text-center text-[12px] text-ink-secondary">
        {current} / {count}
      </span>
      <Step label="下一页" icon={<IconChevronRight />} loading={pending === current + 1}
        disabled={disabled || busy || current >= count} reason={lastReason}
        onClick={() => onChange(current + 1)} />
      <Step label="末页" icon={<DoubleChevron dir="right" />} loading={pending === count}
        disabled={disabled || busy || current >= count} reason={lastReason}
        onClick={() => onChange(count)} />
    </div>
  )
}

function Step({
  label, icon, loading, disabled, reason, onClick,
}: {
  label: string
  icon: ReactNode
  loading: boolean
  disabled: boolean
  reason: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={disabled || loading ? reason : label}
      disabled={disabled || loading}
      onClick={onClick}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] border border-border bg-surface text-ink-secondary transition-colors duration-150 hover:border-border-strong hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50 [&>svg]:h-4 [&>svg]:w-4"
    >
      {loading ? (
        <span
          aria-hidden
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current/25 border-t-current"
        />
      ) : icon}
    </button>
  )
}

function DoubleChevron({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={dir === 'right' ? '-scale-x-100' : ''}
    >
      <path d="m11 6-6 6 6 6" />
      <path d="m18 6-6 6 6 6" />
    </svg>
  )
}
