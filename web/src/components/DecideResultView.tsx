import type { DecideResult, QuestionType } from '../api/decide'

export const DECIDE_TYPE_LABELS: Record<QuestionType, string> = {
  noul: '是非题',
  choice: '选择题',
  score: '评分题',
}

/** 结果区左侧的指标标签 */
function MetricLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold tracking-[0.12em] text-ink-faint">{children}</span>
  )
}

/** 三题型结果的统一渲染：是非概率条 / 选择概率条形图 / 评分刻度条。 */
export default function DecideResultView({ result }: { result: DecideResult }) {
  if (result.kind === 'noul') {
    const percent = Math.max(0, Math.min(100, result.percent ?? 0))
    return (
      <div>
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <MetricLabel>判断</MetricLabel>
            <p className="mt-1 text-[20px] font-semibold leading-7 tracking-tight text-ink">
              {result.text}
            </p>
          </div>
          <p className="tnum shrink-0 text-[30px] font-semibold leading-none tracking-tight text-primary">
            {percent}
            <span className="ml-0.5 text-[13px] font-medium text-ink-faint">%</span>
          </p>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border-subtle">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-1.5 text-[12px] text-ink-muted">倾向「是」的概率</p>
      </div>
    )
  }

  if (result.kind === 'choice') {
    const bars = result.bars ?? []
    const top = Math.max(...bars.map((bar) => bar.value), 0)
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <MetricLabel>JEV 判断</MetricLabel>
          <span className="text-[16px] font-semibold tracking-tight text-ink">
            {result.top ?? '—'}
          </span>
        </div>
        {bars.length > 0 && (
          <ul className="mt-3 space-y-2">
            {bars.map((bar) => {
              const percent = Math.round(Math.max(0, Math.min(1, bar.value)) * 100)
              const strongest = bars.length > 1 && bar.value === top
              return (
                <li key={bar.key} className="flex items-center gap-2.5">
                  <span
                    title={bar.label}
                    className={`w-24 shrink-0 truncate text-[13px] sm:w-36 ${
                      strongest ? 'font-medium text-ink' : 'text-ink-secondary'
                    }`}
                  >
                    {bar.label}
                  </span>
                  <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-border-subtle">
                    <span
                      className={`block h-full rounded-full transition-[width] duration-700 ease-out ${
                        strongest ? 'bg-primary' : 'bg-primary/30'
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </span>
                  <span className="tnum w-9 shrink-0 text-right text-[12px] text-ink-muted">
                    {percent}%
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  const rawMax = Math.max(1, result.scale_max ?? 9)
  const raw = result.value ?? 0
  const display = result.display_value ?? Math.round((raw / rawMax) * 1000) / 100
  const percent = Math.max(0, Math.min(100, display * 10))
  return (
    <div>
      <div className="flex items-end justify-between gap-4">
        <MetricLabel>换算分数</MetricLabel>
        <p className="tnum shrink-0 text-[30px] font-semibold leading-none tracking-tight text-ink">
          {display.toFixed(2)}
          <span className="ml-1 text-[13px] font-medium text-ink-faint">/ 10</span>
        </p>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border-subtle">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="tnum mt-1.5 text-[12px] text-ink-muted">
        JEV 原始 score {raw} / {rawMax}，按档位范围等比例换算。
      </p>
    </div>
  )
}
