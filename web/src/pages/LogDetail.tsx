import { useId, type ReactNode } from 'react'
import type { LogItem } from '../api/logs'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Notice, StatusTag } from '../components/layout'
import { toast } from '../components/toast'
import { formatLocalTime } from '../utils/datetime'
import { KIND_LABELS, levelLabel, levelTone, PHASE_LABELS, prettyLogValue } from './logPresentation'

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[6px] border border-border-subtle bg-surface-muted px-3 py-2">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-1 break-all text-[13px] text-ink-secondary">{children || '—'}</dd>
    </div>
  )
}

async function copyText(value: string, label: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
    } else {
      const input = document.createElement('textarea')
      input.value = value
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      try {
        input.select()
        if (!document.execCommand('copy')) throw new Error('copy failed')
      } finally {
        input.remove()
      }
    }
    toast(`${label}已复制`)
  } catch {
    toast('复制失败，请手动选择内容', 'error')
  }
}

function PayloadSection({ title, value }: { title: string; value: unknown }) {
  const text = prettyLogValue(value)
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-[14px] font-medium text-ink">{title}</h4>
        <Button size="sm" variant="text" onClick={() => void copyText(text, title)}>复制{title}</Button>
      </div>
      <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[6px] border border-border-subtle bg-surface-muted p-4 text-[12px] leading-5 text-ink-secondary">
        {text}
      </pre>
    </section>
  )
}

export default function LogDetail({
  item,
  onClose,
  onFilterTrace,
}: {
  item: LogItem
  onClose: () => void
  onFilterTrace: (traceId: string) => void
}) {
  const titleId = useId()

  return (
    <Modal size="lg" scroll="hidden" labelledBy={titleId} onClose={onClose} className="flex flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4">
          <div>
            <h3 id={titleId} className="text-[17px] font-semibold text-ink">日志详情</h3>
            <p className="mt-1 text-[13px] text-ink-muted">
              {KIND_LABELS[item.kind]} · {PHASE_LABELS[item.phase] ?? item.phase}
            </p>
          </div>
          <Button size="sm" variant="text" onClick={onClose} aria-label="关闭日志详情">关闭</Button>
        </header>
        <div className="space-y-5 overflow-y-auto px-5 py-5">
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <DetailField label="级别">
              <StatusTag tone={levelTone(item.level)}>{levelLabel(item.level)}</StatusTag>
            </DetailField>
            <DetailField label="类型 / 阶段">{KIND_LABELS[item.kind]} / {PHASE_LABELS[item.phase] ?? item.phase}</DetailField>
            <DetailField label="创建时间">{formatLocalTime(item.created_at)}</DetailField>
            <DetailField label="模型">{item.model}</DetailField>
            <DetailField label="HTTP 状态">{item.status_code ?? '—'}</DetailField>
            <DetailField label="耗时">{item.latency_ms} ms</DetailField>
          </dl>
          <div className="rounded-[6px] border border-border-subtle bg-surface-muted px-3 py-2">
            <p className="text-[12px] text-ink-muted">Trace ID</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="mono break-all text-[12px] text-ink-secondary">{item.trace_id || '—'}</span>
              {item.trace_id && (
                <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => onFilterTrace(item.trace_id)}>
                  查看同链路
                </button>
              )}
            </div>
          </div>
          {item.error && (
            <Notice tone={levelTone(item.level) === 'danger' ? 'danger' : 'warning'}>{item.error}</Notice>
          )}
          {item.truncated && <Notice tone="warning">日志内容已截断，下面展示的是服务端保留的部分。</Notice>}
          <PayloadSection title="请求内容" value={item.request} />
          <PayloadSection title="响应内容" value={item.response} />
        </div>
        <footer className="flex justify-end border-t border-border-subtle px-5 py-3">
          <Button size="sm" onClick={onClose}>关闭</Button>
        </footer>
    </Modal>
  )
}
