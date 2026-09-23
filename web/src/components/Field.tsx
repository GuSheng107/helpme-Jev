import type { InputHTMLAttributes, ReactNode } from 'react'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  /** 字段级错误：显示在控件下方并与控件关联 */
  error?: string | null
  /** 辅助说明 / 示例 */
  hint?: ReactNode
  required?: boolean
}

/**
 * 表单字段原语。
 *
 * 纪律（对齐 human-llm-gateway 规范）：
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
  ...rest
}: FieldProps) {
  const inputId = id ?? `field-${label}`
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
        {label}
        {required && <span className="ml-0.5 text-danger">*</span>}
      </label>

      <input
        {...rest}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy}
        className={
          'h-9 w-full rounded-[6px] border bg-surface px-3 text-ink transition-colors ' +
          'placeholder:text-ink-muted focus:outline-none ' +
          (error
            ? 'border-danger focus:border-danger'
            : 'border-border focus:border-primary')
        }
      />

      {error ? (
        <p id={`${inputId}-error`} className="mt-1 text-[13px] leading-5 text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1 text-[13px] leading-5 text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
