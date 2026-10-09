/**
 * 开关：用于「立刻生效的单布尔设置」。
 *
 * 纪律：开关旁边必须有文字状态（已启用 / 已停用），不能只靠颜色表达；
 * 多选或互斥选项请改用 Segmented，不要用一排开关。
 */
export default function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  id,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** 无障碍标签；视觉文案由调用方在开关旁自己排 */
  label: string
  id?: string
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'bg-primary' : 'bg-border-strong'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-[left] duration-200 ease-out ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
        aria-hidden
      />
    </button>
  )
}
