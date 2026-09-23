import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'text' | 'danger'
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
 * 纪律（对齐 human-llm-gateway 规范）：
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
    'inline-flex items-center justify-center rounded-[6px] font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-60'

  const sizes: Record<Size, string> = {
    sm: 'h-8 px-3 text-[13px]',
    md: 'h-9 px-4 text-[14px]',
  }

  const variants: Record<Variant, string> = {
    primary: 'bg-primary text-white hover:bg-primary-hover',
    secondary: 'border border-border bg-surface text-ink hover:bg-surface-muted',
    text: 'text-primary hover:bg-primary-soft',
    danger: 'bg-danger text-white hover:brightness-95',
  }

  return (
    <button
      {...rest}
      disabled={isDisabled}
      title={isDisabled && disabledReason ? disabledReason : rest.title}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className ?? ''}`}
    >
      {loading ? '处理中…' : children}
    </button>
  )
}
