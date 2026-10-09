import type { ReactNode } from 'react'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

/**
 * 分段控件：少量互斥选项的紧凑切换器。
 *
 * 纪律：选项 ≤ 4 个、标签 ≤ 6 字时用它，不要用下拉框——
 * 一眼看全、一次点击完成切换，减少一次「展开→选择」的往返。
 */
export default function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
  fluid = false,
  disabled = false,
  className = '',
  ariaLabel,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** 撑满父容器宽度，各选项等分 */
  fluid?: boolean
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const box = size === 'sm' ? 'h-8' : 'h-9'
  const pad = size === 'sm' ? 'px-2.5 text-[12px]' : 'px-3 text-[13px]'

  function move(step: number) {
    const usable = options.filter((option) => !option.disabled)
    const current = usable.findIndex((option) => option.value === value)
    if (current < 0) return
    const next = usable[(current + step + usable.length) % usable.length]
    if (next) onChange(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`${fluid ? 'flex w-full' : 'inline-flex'} ${box} rounded-[9px] border border-border bg-surface-muted p-0.5 ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value
        const off = disabled || option.disabled
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={off}
            tabIndex={active ? 0 : -1}
            onClick={() => !off && onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault()
                move(1)
              } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault()
                move(-1)
              }
            }}
            className={`inline-flex items-center justify-center gap-1 rounded-[7px] ${pad} ${
              fluid ? 'min-w-0 flex-1' : ''
            } font-medium transition-[background-color,color,box-shadow] duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? 'bg-surface text-ink shadow-xs' : 'text-ink-secondary hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
