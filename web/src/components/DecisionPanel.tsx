import { useState } from 'react'
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

const TONE_TEXT: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-ink-muted',
}

const TONE_DOT: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-ink-faint',
}

/* ------------------------------------------------------------------ 行渲染 */

/** 评分题：离散档位条 + 档位文本。0 档即空条，不做「至少一格」的假象。 */
function ScoreScale({ item }: { item: JudgeItem }) {
  const max = Math.max(1, item.scale_max ?? 9)
  const value = typeof item.value === 'number' ? item.value : 0
  const tone = item.tone ?? 'info'
  const percent = Math.round((Math.min(value, max) / max) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-secondary">{item.title}</span>
        <span className="tnum text-[13px] font-medium text-ink">
          {item.text}
          <span className="ml-1.5 text-[12px] font-normal text-ink-faint">{percent}%</span>
        </span>
      </div>
      <div
        className="mt-2 flex gap-[3px]"
        role="img"
        aria-label={`${item.title}：${item.text}`}
      >
        {Array.from({ length: max }, (_, index) => (
          <span
            key={index}
            className={`h-[7px] flex-1 rounded-full transition-colors duration-200 ${
              index < value ? TONE_FILL[tone] : 'bg-border-subtle'
            }`}
          />
        ))}
      </div>
    </div>
  )
}

/** 选择题：概率条形图。首位加粗，其余弱化，层级一眼可见。 */
function ChoiceRow({ item, lead = false }: { item: JudgeItem; lead?: boolean }) {
  const bars = item.bars?.slice(0, lead ? 4 : 3) ?? []
  const top = Math.max(...bars.map((bar) => bar.value), 0)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-secondary">{item.title}</span>
        <span className="text-[14px] font-medium text-ink">{item.text}</span>
      </div>
      {bars.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {bars.map((bar) => {
            const percent = Math.round(Math.max(0, Math.min(1, bar.value)) * 100)
            const strongest = bars.length > 1 && bar.value === top
            return (
              <li key={bar.key} className="flex items-center gap-2.5">
                <span
                  title={bar.label}
                  className={`w-24 shrink-0 truncate text-[12px] leading-5 sm:w-32 ${
                    strongest ? 'text-ink-secondary' : 'text-ink-muted'
                  }`}
                >
                  {bar.label}
                </span>
                <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-border-subtle">
                  <span
                    className={`block h-full rounded-full transition-[width] duration-500 ease-out ${
                      strongest ? 'bg-primary' : 'bg-primary/35'
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

/** 是非题：结论 + 置信度徽标。 */
function NoulRow({ item }: { item: JudgeItem }) {
  const percent = Math.round((item.probability ?? 0) * 100)
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-[13px] text-ink-secondary">{item.title}</span>
      <span className="flex shrink-0 items-baseline gap-2">
        <span className="text-[13px] text-ink">{item.text}</span>
        <span className="tnum rounded-[6px] bg-surface-sunken px-1.5 py-px text-[11px] text-ink-muted">
          {percent}%
        </span>
      </span>
    </div>
  )
}

function Row({ item, lead = false }: { item: JudgeItem; lead?: boolean }) {
  if (item.kind === 'score') return <ScoreScale item={item} />
  if (item.kind === 'choice') return <ChoiceRow item={item} lead={lead} />
  if (item.kind === 'noul') return <NoulRow item={item} />
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="min-w-0 truncate text-[13px] text-ink-secondary">{item.title}</span>
      <span className="shrink-0 text-[13px] text-ink-faint">{item.text}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ 面板 */

export default function DecisionPanel({
  result,
  scenarioKind = 'romance',
}: {
  result: AnalyzeResult
  scenarioKind?: string
}) {
  // 宽屏默认展开，窄屏默认收起（窄屏把纵向空间留给对话流）。
  const [open, setOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 1024,
  )

  const risk = result.panel.find((item) => RISK_KEYS.has(item.key))
  const action = result.panel.find((item) => item.key === 'best_action')
  const rest = result.panel.filter((item) => item.key !== 'best_action')
  const riskWord = RISK_WORDS[risk?.key ?? ''] ?? '风险'
  const riskTone =
    risk?.tone === 'success' || risk?.tone === 'warning' || risk?.tone === 'danger'
      ? risk.tone
      : 'info'

  const notes: { tone: string; text: string }[] = []
  if (result.high_danger) {
    notes.push({
      tone: 'danger',
      text:
        scenarioKind === 'workplace'
          ? '这件事利害不小，建议先电话或当面对齐，再落成文字。'
          : scenarioKind === 'custom'
            ? '这段沟通风险较高，建议先确认情况再回复。'
            : '此事不适合用文字处理，建议当面或电话沟通。',
    })
  }
  if (!result.context_sufficient) {
    notes.push({ tone: 'warning', text: '上下文较少，本次判断仅供参考。' })
  }
  if (result.context_truncated) {
    notes.push({ tone: 'info', text: '记录较多，较早的条目本次未纳入。' })
  }
  notes.push({ tone: 'info', text: '人工智能会出错，关键信息请仔细甄别。' })

  return (
    <section className="border-b border-border-subtle bg-surface-sunken/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors duration-150 hover:bg-surface-hover sm:px-5"
      >
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-ink-faint">
          <IconSparkle className="h-3.5 w-3.5 text-primary" />
          JEV
        </span>
        <span className="h-3.5 w-px shrink-0 bg-border-strong" />
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-secondary">
          {action?.text ? `建议：${action.text}` : '判断已完成'}
        </span>

        <span
          className="hidden shrink-0 items-center gap-2 md:flex"
          title={`信息充足度 ${result.sufficiency_percent}%`}
        >
          <span className="h-1 w-16 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full bg-primary/70 transition-[width] duration-500 ease-out"
              style={{ width: `${result.sufficiency_percent}%` }}
            />
          </span>
          <span className="tnum text-[11px] text-ink-faint">{result.sufficiency_percent}%</span>
        </span>

        <StatusTag tone={riskTone}>
          {riskWord} {risk?.text ?? '—'}
        </StatusTag>

        <IconChevronDown
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="animate-fade-in space-y-4 px-4 pb-4 sm:px-5 sm:pb-5">
          {action && (
            <div className="rounded-[12px] border border-primary-border bg-primary-soft/70 px-4 py-3">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-primary/70">
                最佳动作
              </p>
              <p className="mt-1.5 text-[20px] font-semibold leading-7 tracking-tight text-ink">
                {action.text}
              </p>
              {(action.bars?.length ?? 0) > 1 && (
                <div className="mt-3 border-t border-primary-border/70 pt-3">
                  <ChoiceRow item={{ ...action, title: '其他可能' }} lead />
                </div>
              )}
            </div>
          )}

          {rest.length > 0 && (
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {rest.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </div>
          )}

          <ul className="space-y-1.5 border-t border-border-subtle pt-3">
            {notes.map((note, index) => (
              <li key={index} className="flex gap-2 text-[12px] leading-5">
                <span
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[note.tone]}`}
                />
                <span className={TONE_TEXT[note.tone]}>{note.text}</span>
              </li>
            ))}
          </ul>

          {result.more.length > 0 && (
            <details className="group/more border-t border-border-subtle pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12px] text-ink-muted transition-colors hover:text-ink">
                <IconChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open/more:rotate-180" />
                还有 {result.more.length} 项判断
              </summary>
              <div className="mt-3 grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {result.more.map((item) => (
                  <Row key={item.key} item={item} />
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </section>
  )
}

const RISK_KEYS = new Set(['danger_level', 'stakes_level'])
const RISK_WORDS: Record<string, string> = { danger_level: '风险', stakes_level: '利害' }
