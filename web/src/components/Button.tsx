import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'text' | 'ghost' | 'ghost-danger' | 'danger'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  /** 禁用原因：禁用时必须给出理由，而非只把颜色变灰 */
  disabledReason?: string
  children: ReactNode
}

/**
 * 通用按钮。
 *
 * 纪律：
 * - 每个页面**最多一个** primary 按钮
 * - 危险动作（删除 / 撤销 / 重置密码）用 danger 且需二次确认
 * - 禁用时提供原因 tooltip，不能只改颜色
 */
export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabledReason,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  const isDisabled = Boolean(disabled || loading)

  const base =
    'inline-flex select-none items-center justify-center gap-1.5 rounded-[8px] font-medium ' +
    'transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
    'active:translate-y-px disabled:cursor-not-allowed disabled:opacity-55 disabled:active:translate-y-0'

  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-[13px]',
    md: 'h-9 px-4 text-[14px]',
  }

  const variants: Record<Variant, string> = {
    primary: 'bg-primary text-white shadow-xs hover:bg-primary-hover',
    secondary:
      'border border-border bg-surface text-ink hover:border-border-strong hover:bg-surface-muted',
    text: 'px-2 text-primary hover:bg-primary-soft',
    ghost: 'px-2 text-ink-secondary hover:bg-surface-muted hover:text-ink',
    'ghost-danger': 'px-2 text-danger hover:bg-danger-soft',
    danger: 'bg-danger text-white hover:brightness-95',
  }

  return (
    <button
      {...rest}
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : rest.title}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className ?? ''}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current/25 border-t-current"
    />
  )
}
