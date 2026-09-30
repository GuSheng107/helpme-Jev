import type { DecideResult, QuestionType } from '../api/decide'

export const DECIDE_TYPE_LABELS: Record<QuestionType, string> = {
  noul: '是非题',
  choice: '选择题',
  score: '评分题',
}

/** 三题型结果的统一渲染：是非概率条 / 选择概率条形图 / 评分刻度条。 */
export default function DecideResultView({ result }: { result: DecideResult }) {
  if (result.kind === 'noul') {
    const percent = result.percent ?? 0
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink-secondary">判断</span>
          <span className="text-[20px] font-semibold text-ink">{result.text}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-border-subtle">
          <div className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-right text-[12px] text-ink-muted">倾向「是」{percent}%</p>
      </div>
    )
  }
  if (result.kind === 'choice') {
    const bars = result.bars ?? []
    return (
      <div>
        <p className="text-[13px] text-ink-secondary">Jev 判断：<span className="text-[14px] font-medium text-ink">{result.top ?? '—'}</span></p>
        <ul className="mt-3 space-y-2">
          {bars.map((bar) => (
            <li key={bar.key} className="flex items-center gap-2">
              <span title={bar.label} className="w-24 shrink-0 truncate text-[13px] text-ink-secondary sm:w-36">{bar.label}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border-subtle">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%` }} />
              </span>
              <span className="w-10 text-right text-[12px] text-ink-muted">{Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const rawMax = result.scale_max ?? 9
  const raw = result.value ?? 0
  const display = result.display_value ?? Math.round(raw / rawMax * 1000) / 100
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-secondary">换算分数</span>
        <span className="text-[20px] font-semibold text-ink">{display.toFixed(2)} / 10</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border-subtle">
        <div className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, display * 10))}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">Jev 原始 score：{raw} / {rawMax}；按档位范围等比例换算。</p>
    </div>
  )
}
