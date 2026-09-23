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

export default function DecisionPanel({ result }: { result: AnalyzeResult }) {
  const [open, setOpen] = useState(false)
  const danger = result.panel.find((item) => item.key === 'danger_level')
  const action = result.panel.find((item) => item.key === 'best_action')

  return (
    <section className="border-b border-border-subtle bg-surface">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left lg:hidden"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <StatusTag tone={danger?.tone === 'success' || danger?.tone === 'warning' || danger?.tone === 'danger' ? danger.tone : 'info'}>
            危险 {danger?.text ?? '—'}
          </StatusTag>
          <span className="truncate text-[13px] text-ink-secondary">{action?.text ?? ''}</span>
        </span>
        <span className="text-[12px] text-ink-muted">{open ? '收起' : '展开'}</span>
      </button>

      <div className={`${open ? 'block' : 'hidden'} space-y-3 px-4 pb-4 lg:block lg:pt-4`}>
        {result.high_danger && (
          <Notice tone="danger">
            这已超出文字回复能解决的范围，建议当面或电话沟通。
          </Notice>
        )}
        {!result.context_sufficient && (
          <Notice tone="warning">信息还不够，这次判断可能不稳。追问会在后面的阶段补上。</Notice>
        )}
        <div className="space-y-3">
          {result.panel.map((item) => (
            <Row key={item.key} item={item} />
          ))}
        </div>
        {result.more.length > 0 && (
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-muted">更多判断</summary>
            <div className="mt-2 space-y-2">
              {result.more.map((item) => (
                <Row key={item.key} item={item} />
              ))}
            </div>
          </details>
        )}
        {result.trace_id && (
          <p className="mono text-[12px] leading-5 text-ink-muted">
            {result.model || 'jev'} · {result.latency_ms}ms · {result.trace_id}
          </p>
        )}
      </div>
    </section>
  )
}
