import {
  CONTEXT_PRESETS,
  CUSTOM_CONTEXT,
  DIMENSIONS,
  DIMENSION_GROUPS,
  dimensionsOf,
  isPresetContext,
  MAX_DIMENSIONS,
} from '../data/personaCatalog'

interface Props {
  /** 当前档位 slug */
  value: string
  onChange: (key: string) => void
  /** 自定义档位的显示名 */
  label: string
  onLabel: (label: string) => void
  /** 自定义档位勾选的维度 key */
  keys: string[]
  onKeys: (keys: string[]) => void
  disabled?: boolean
}

/**
 * 人设档选择器：内置档位 + 自定义档位。
 *
 * 内置档位按预设取维度；选自定义时现场取档位名并勾选维度。
 * 人设页与人设库向导共用同一套交互。
 */
export default function ContextPicker({
  value,
  onChange,
  label,
  onLabel,
  keys,
  onKeys,
  disabled,
}: Props) {
  const custom = !isPresetContext(value)
  const selected = new Set(custom ? keys : dimensionsOf(value).map((item) => item.key))
  const full = selected.size >= MAX_DIMENSIONS

  function toggle(key: string) {
    if (disabled) return
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else if (!full) next.add(key)
    onKeys(DIMENSIONS.filter((item) => next.has(item.key)).map((item) => item.key))
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="人设档">
        {CONTEXT_PRESETS.map((preset) => {
          const active = value === preset.key
          return (
            <button
              key={preset.key}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              title={preset.hint}
              onClick={() => onChange(preset.key)}
              className={`rounded-[8px] border px-3 py-1.5 text-[13px] transition-all duration-150 ${
                active
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border bg-surface text-ink-secondary hover:border-border-strong hover:bg-surface-muted hover:text-ink'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              {preset.label}
            </button>
          )
        })}
        <button
          type="button"
          disabled={disabled}
          aria-pressed={custom}
          onClick={() => onChange(CUSTOM_CONTEXT)}
          className={`rounded-[8px] border px-3 py-1.5 text-[13px] transition-all duration-150 ${
            custom
              ? 'border-primary bg-primary-soft font-medium text-primary'
              : 'border-border bg-surface text-ink-secondary hover:border-border-strong hover:bg-surface-muted hover:text-ink'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          自定义
        </button>
      </div>

      {custom ? (
        <div className="mt-3 space-y-3 rounded-[10px] border border-border-subtle bg-surface-muted/60 p-3.5">
          <label className="block text-[13px] font-medium text-ink-secondary">
            档位名
            <input
              value={label}
              disabled={disabled}
              maxLength={32}
              placeholder="例如：室友、客户、健身教练"
              onChange={(event) => onLabel(event.target.value)}
              className="mt-1.5 h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-[14px] text-ink transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:bg-surface-muted"
            />
          </label>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[13px] font-medium text-ink-secondary">取用的维度</p>
              <p className="text-[12px] tabular-nums text-ink-muted">
                已选 {selected.size}/{MAX_DIMENSIONS}
              </p>
            </div>
            <div className="mt-2 space-y-2.5">
              {DIMENSION_GROUPS.map((group) => {
                const items = DIMENSIONS.filter((item) => item.group === group.key)
                if (items.length === 0) return null
                return (
                  <div key={group.key}>
                    <p className="text-[12px] text-ink-faint">{group.label}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {items.map((item) => {
                        const active = selected.has(item.key)
                        return (
                          <button
                            key={item.key}
                            type="button"
                            disabled={disabled || (!active && full)}
                            aria-pressed={active}
                            title={item.hint}
                            onClick={() => toggle(item.key)}
                            className={`rounded-[6px] border px-2.5 py-1 text-[12px] transition-all duration-150 ${
                              active
                                ? 'border-primary bg-primary-soft font-medium text-primary'
                                : 'border-border-subtle bg-surface text-ink-secondary hover:border-border-strong hover:text-ink'
                            } ${disabled || (!active && full) ? 'cursor-not-allowed opacity-60' : ''}`}
                          >
                            {item.title}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            {selected.size === 0 && (
              <p className="mt-2 text-[12px] text-warning">至少勾选一个维度，否则按默认维度取用。</p>
            )}
          </div>
        </div>
      ) : (
        <p className="mt-2 text-[12px] leading-5 text-ink-muted">
          取用维度：{dimensionsOf(value).map((item) => item.title).join('、')}
        </p>
      )}
    </div>
  )
}
