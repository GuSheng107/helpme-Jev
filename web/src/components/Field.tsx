import { useState, type InputHTMLAttributes, ReactNode } from 'react'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  /** 字段级错误：显示在控件下方并与控件关联 */
  error?: string | null
  /** 辅助说明 / 示例 */
  hint?: ReactNode
  required?: boolean
}

/** 表单控件统一样式：输入类元素共用，保证全站一致。 */
export const controlClass =
  'h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-[14px] text-ink ' +
  'shadow-xs transition-colors duration-150 placeholder:text-ink-faint ' +
  'hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted'

/**
 * 表单字段原语。
 *
 * 纪律：
 * - 标签置于控件**上方**，必填项明确标识
 * - 校验错误放在**控件附近**（页面顶部另有摘要由调用方负责）
 * - Secret 用 `type="password"`；读取接口不返回值时显示「已配置」，
 *   **不伪造星号长度**
 */
export default function Field({
  label,
  error,
  hint,
  required,
  id,
  type,
  onClick,
  ...rest
}: FieldProps) {
  const inputId = id ?? `field-${label}`
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
  const secret = type === 'password'
  const [visible, setVisible] = useState(false)

  // 日期控件：点输入框任意位置都弹出日历，而不只是右侧小图标
  function handleClick(event: React.MouseEvent<HTMLInputElement>) {
    onClick?.(event)
    if (type === 'date' && !event.defaultPrevented) {
      try {
        event.currentTarget.showPicker?.()
      } catch {
        // 非用户手势等场景浏览器会拒绝，忽略即可
      }
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>

      <span className="relative block">
        <input
          {...rest}
          id={inputId}
          type={secret && visible ? 'text' : type}
          onClick={handleClick}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={
            controlClass +
            (secret ? ' pr-9' : '') +
            (error ? ' border-danger hover:border-danger focus:border-danger focus:ring-danger/15' : '')
          }
        />
        {secret && (
          <button
            type="button"
            aria-label={visible ? '隐藏密码' : '显示密码'}
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-[6px] text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink-secondary"
            onClick={() => setVisible((value) => !value)}
          >
            <EyeIcon open={visible} />
          </button>
        )}
      </span>

      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-[13px] leading-5 text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-[13px] leading-5 text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
      {open && <path d="M4 20 20 4" />}
    </svg>
  )
}
