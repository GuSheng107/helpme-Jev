import type { AnalyzeResult, JudgeItem } from '../api/chat'
import { StatusTag } from './layout'
import { IconChevronDown, IconSparkle } from './icons'

/* ------------------------------------------------------------------ 调色 */

const TONE_FILL: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-primary',
}

/* ------------------------------------------------------------------ 行渲染 */

/**
 * 紧凑行：标题一行、结论紧随，弱化装饰。
 * 评分用细档位条，选择只画最可能的一项，是非直接给结论。
 */
function Row({ item }: { item: JudgeItem }) {
  if (item.kind === 'score') {
    const max = Math.max(1, item.scale_max ?? 9)
    const value = typeof item.value === 'number' ? item.value : 0
    const tone = item.tone ?? 'info'
    const percent = Math.round((Math.min(value, max) / max) * 100)
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] text-ink-secondary">{item.title}</span>
          <span className="tnum text-[12px] font-medium text-ink">{item.text}</span>
        </div>
        <div
          className="mt-1 flex gap-[2px]"
          role="img"
          aria-label={`${item.title}：${item.text}`}
        >
          {Array.from({ length: max }, (_, index) => (
            <span
              key={index}
              className={`h-[4px] flex-1 rounded-full transition-colors duration-200 ${
                index < value ? TONE_FILL[tone] : 'bg-border-subtle'
              }`}
              style={index < value ? { opacity: 0.45 + (0.55 * percent) / 100 } : undefined}
            />
          ))}
        </div>
      </div>
    )
  }
  if (item.kind === 'choice') {
    const bars = item.bars ?? []
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[12px] text-ink-secondary">{item.title}</span>
          <span className="text-[12.5px] font-medium text-ink">{item.text}</span>
        </div>
        {bars.length > 1 && (
          <div className="mt-1 flex items-center gap-1.5">
            <span className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-border-subtle">
              <span
                className="block h-full rounded-full bg-primary/45"
                style={{ width: `${Math.round(Math.max(0, Math.min(1, bars[0].value)) * 100)}%` }}
              />
            </span>
            <span className="tnum shrink-0 text-[10.5px] text-ink-faint">
              {Math.round(Math.max(0, Math.min(1, bars[0].value)) * 100)}%
            </span>
          </div>
        )}
      </div>
    )
  }
  if (item.kind === 'noul') {
    return (
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[12px] text-ink-secondary">{item.title}</span>
        <span className="tnum shrink-0 text-[12px] text-ink">{item.text}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-[12px] text-ink-secondary">{item.title}</span>
      <span className="shrink-0 text-[12px] text-ink-faint">{item.text}</span>
    </div>
  )
}

/** 报告条目里的一行分析能否展示（有内容或正在加载或出错都占位） */
export interface ReportEntry {
  result: AnalyzeResult | null
  loading: boolean
  error: string | null
  reason: string | null
  explaining: boolean
}

/**
 * 内联在某条来话消息下方的分析报告。
 *
 * 折叠时只有一行：建议结论 + 风险徽标；展开后是紧凑的关键判断
 * 与可折叠的「更多判断」。为什么这么判由调用方取文，就地展示。
 */
export default function MessageReport({
  entry,
  scenarioKind = 'romance',
  open,
  onToggle,
  onExplain,
}: {
  entry: ReportEntry
  scenarioKind?: string
  open: boolean
  onToggle: (open: boolean) => void
  onExplain: () => void
}) {
  const result = entry.result
  if (entry.loading || result === null) {
    if (entry.loading) {
      return (
        <div className="flex w-full max-w-[min(92%,640px)] items-center gap-2 rounded-[12px] border border-border-subtle bg-surface-sunken/50 px-3 py-2">
          <IconSparkle className="h-3.5 w-3.5 shrink-0 animate-pulse text-primary" />
          <span className="text-[12.5px] text-ink-muted">JEV 正在分析这段对话…</span>
        </div>
      )
    }
    return (
      <div className="flex w-full max-w-[min(92%,640px)] items-center gap-2 rounded-[12px] border border-danger/20 bg-danger-soft/60 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-danger">
          {entry.error || '本次分析未完成'}
        </span>
      </div>
    )
  }

  const risk = result.panel.find((item) => RISK_KEYS.has(item.key))
  const action = result.panel.find((item) => item.key === 'best_action')
  const grid = result.panel.filter(
    (item) => item.key !== 'best_action' && !RISK_KEYS.has(item.key),
  )
  const riskWord = RISK_WORDS[risk?.key ?? ''] ?? '风险'
  const riskTone =
    risk?.tone === 'success' || risk?.tone === 'warning' || risk?.tone === 'danger'
      ? risk.tone
      : 'info'

  return (
    <section className="w-full max-w-[min(92%,640px)] overflow-hidden rounded-[12px] border border-border-subtle bg-surface-sunken/50">
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-surface-hover"
      >
        <IconSparkle className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] leading-5">
          {action?.text ? (
            <>
              <span className="text-ink-faint">建议 </span>
              <span className="font-medium text-ink">{action.text}</span>
            </>
          ) : (
            <span className="text-ink-secondary">判断已完成</span>
          )}
        </span>
        <StatusTag tone={riskTone}>
          {riskWord} {risk?.text ?? '—'}
        </StatusTag>
        <IconChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="animate-fade-in space-y-3 border-t border-border-subtle/70 px-3 pb-3 pt-2.5">
          {result.high_danger && (
            <p className="rounded-[8px] bg-danger-soft px-2.5 py-1.5 text-[12px] leading-5 text-danger">
              {scenarioKind === 'workplace'
                ? '这件事利害不小，建议先电话或当面对齐，再落成文字。'
                : scenarioKind === 'custom'
                  ? '这段沟通风险较高，建议先确认情况再回复。'
                  : '此事不适合用文字处理，建议当面或电话沟通。'}
            </p>
          )}

          {grid.length > 0 && (
            <div className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
              {grid.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </div>
          )}

          {!result.context_sufficient && (
            <p className="text-[11.5px] leading-4 text-warning">上下文较少，本次判断仅供参考。</p>
          )}

          {result.more.length > 0 && (
            <details className="group/more border-t border-border-subtle pt-2">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-[11.5px] text-ink-muted transition-colors hover:text-ink">
                <IconChevronDown className="h-3 w-3 transition-transform duration-200 group-open/more:rotate-180" />
                还有 {result.more.length} 项判断
              </summary>
              <div className="mt-2 grid gap-x-5 gap-y-2.5 sm:grid-cols-2">
                {result.more.map((item) => (
                  <Row key={item.key} item={item} />
                ))}
              </div>
            </details>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
            <button type="button" className={LINK} onClick={onExplain} disabled={entry.explaining}>
              {entry.explaining ? '正在解读…' : '为什么这么判'}
            </button>
            <span className="shrink-0 text-[11px] text-ink-faint">判断可能不准，重要的事请自己核实</span>
          </div>
          {entry.reason && (
            <p className="animate-fade-in text-[12.5px] leading-5 text-ink-secondary">
              {entry.reason}
              <span className="text-ink-faint">（由语言模型解读，仅供参考）</span>
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const LINK =
  'inline-flex items-center rounded-[6px] px-0 text-[12px] font-medium text-primary transition-colors duration-150 hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-60'

const RISK_KEYS = new Set(['danger_level', 'stakes_level'])
const RISK_WORDS: Record<string, string> = { danger_level: '风险', stakes_level: '利害' }
