import { useState } from 'react'
import type { AnalyzeResult, JudgeItem } from '../api/chat'
import { Notice, StatusTag } from './layout'

const TONE_BAR: Record<string, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-primary',
}

function ScoreScale({ item }: { item: JudgeItem }) {
  const max = item.scale_max ?? 9
  const value = typeof item.value === 'number' ? item.value : 0
  const tone = item.tone ?? 'info'
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-secondary">{item.title}</span>
        <span className="mono text-[14px] font-medium text-ink">{item.text}</span>
      </div>
      <div className="flex gap-0.5" aria-label={`${item.title} ${item.text}`}>
        {Array.from({ length: max + 1 }, (_, index) => (
          <span
            key={index}
            className={`h-2 flex-1 rounded-[2px] ${index <= value ? TONE_BAR[tone] : 'bg-border-subtle'}`}
          />
        ))}
      </div>
    </div>
  )
}

function ChoiceRow({ item }: { item: JudgeItem }) {
  const top = item.bars?.slice(0, 3) ?? []
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-secondary">{item.title}</span>
        <span className="text-[14px] font-medium text-ink">{item.text}</span>
      </div>
      {top.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {top.map((bar) => (
            <li key={bar.key} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-[12px] leading-5 text-ink-muted">
                {bar.label}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%` }}
                />
              </span>
              <span className="mono w-10 text-right text-[12px] text-ink-muted">
                {Math.round(bar.value * 100)}%
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function NoulRow({ item }: { item: JudgeItem }) {
  const prob = item.probability ?? 0
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[13px] text-ink-secondary">{item.title}</span>
      <span className="flex items-center gap-2">
        <span className="text-[14px] text-ink">{item.text}</span>
        <span className="mono text-[12px] text-ink-muted">{Math.round(prob * 100)}%</span>
      </span>
    </div>
  )
}

function Row({ item }: { item: JudgeItem }) {
  if (item.kind === 'score') return <ScoreScale item={item} />
  if (item.kind === 'choice') return <ChoiceRow item={item} />
  if (item.kind === 'noul') return <NoulRow item={item} />
  return (
    <div className="flex items-center justify-between">
      <span className="text-[13px] text-ink-secondary">{item.title}</span>
      <span className="text-[13px] text-ink-muted">{item.text}</span>
    </div>
  )
}

const RISK_ITEM_KEYS = new Set(['danger_level', 'stakes_level'])
const RISK_WORDS: Record<string, string> = { danger_level: '风险', stakes_level: '利害' }

export default function DecisionPanel({
  result,
  scenarioKind = 'romance',
}: {
  result: AnalyzeResult
  scenarioKind?: string
}) {
  const [open, setOpen] = useState(false)
  const risk = result.panel.find((item) => RISK_ITEM_KEYS.has(item.key))
  const action = result.panel.find((item) => item.key === 'best_action')
  const riskWord = RISK_WORDS[risk?.key ?? ''] ?? '风险'

  return (
    <section className="border-b border-border-subtle bg-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:hidden"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <StatusTag tone={risk?.tone === 'success' || risk?.tone === 'warning' || risk?.tone === 'danger' ? risk.tone : 'info'}>
            {riskWord} {risk?.text ?? '—'}
          </StatusTag>
          <span className="truncate text-[13px] text-ink-secondary">{action?.text ?? ''}</span>
        </span>
        <span className="text-[12px] text-ink-muted">{open ? '收起' : '展开'}</span>
      </button>

      <div className={`${open ? 'block' : 'hidden'} space-y-3 px-4 pb-4 lg:block lg:pt-4`}>
        {result.high_danger && (
          <Notice tone="danger">
            {scenarioKind === 'workplace'
              ? '这件事利害不小，建议先电话或当面对齐，再落成文字。'
              : scenarioKind === 'custom'
                ? '这段沟通风险较高，建议先确认情况再回复。'
                : '此事不适合用文字处理，建议当面或电话沟通。'}
          </Notice>
        )}
        <p className="text-[13px] text-ink-secondary">信息充足度 {result.sufficiency_percent}%</p>
        {!result.context_sufficient && (
          <Notice tone="warning">上下文较少，本次判断仅供参考。</Notice>
        )}
        {result.context_truncated && (
          <Notice tone="info">记录较多，较早的条目本次未纳入。</Notice>
        )}
        <Notice tone="info">人工智能会出错，关键信息请仔细甄别。</Notice>
        <div className="space-y-3">
          {result.panel.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </div>
        {result.more.length > 0 && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-muted">其他</summary>
            <div className="mt-2 space-y-2">
              {result.more.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </div>
          </details>
        )}

      </div>
    </section>
  )
}
