import { useId, type ReactNode } from 'react'
import type { LogItem } from '../api/logs'
import Button from '../components/Button'
import Modal from '../components/Modal'
import { Notice, StatusTag } from '../components/layout'
import { toast } from '../components/toast'
import { formatLocalTime } from '../utils/datetime'
import { CATEGORY_LABELS, levelLabel, levelTone, prettyLogValue } from './logPresentation'

/** 详情字段的标签排版：小号、加字距，和大字号取值拉开层级。 */
function DetailLabel({ children }: { children: ReactNode }) {
  return (
    <dt className="text-[11px] font-semibold tracking-[0.12em] text-ink-faint">{children}</dt>
  )
}

function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-border-subtle bg-surface-muted px-3 py-2.5">
      <DetailLabel>{label}</DetailLabel>
      <dd className="mt-1.5 break-all text-[13px] leading-5 text-ink-secondary">{children || '—'}</dd>
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
        <h4 className="text-[11px] font-semibold tracking-[0.12em] text-ink-faint">{title}</h4>
        <button
          type="button"
          className="rounded-[6px] px-1.5 py-0.5 text-[12px] text-primary transition-colors duration-150 hover:bg-primary-soft"
          onClick={() => void copyText(text, title)}
        >
          复制
        </button>
      </div>
      <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-[10px] border border-border-subtle bg-surface-sunken/70 p-4 text-[12px] leading-5 text-ink-secondary">
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
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={titleId} className="text-[16px] font-semibold tracking-tight text-ink">
              日志详情
            </h3>
            <StatusTag tone={levelTone(item.level)}>{levelLabel(item.level)}</StatusTag>
          </div>
          <p className="mt-1 truncate text-[13px] text-ink-muted">
            {CATEGORY_LABELS[item.category] ?? item.category} · {item.source} ·{' '}
            <time className="tnum">{formatLocalTime(item.created_at)}</time>
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="关闭日志详情">
          关闭
        </Button>
      </header>

      <div className="space-y-5 overflow-y-auto px-5 py-5">
        <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <DetailField label="摘要">{item.summary}</DetailField>
          <DetailField label="HTTP 状态">
            <span className="tnum">{item.status_code ?? '—'}</span>
          </DetailField>
          <DetailField label="耗时">
            <span className="tnum">{item.latency_ms} ms</span>
          </DetailField>
        </dl>

        <div className="rounded-[10px] border border-border-subtle bg-surface-muted px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <DetailLabel>TRACE ID</DetailLabel>
            {item.trace_id && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-[6px] px-1.5 py-0.5 text-[12px] text-ink-secondary transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
                  onClick={() => void copyText(item.trace_id, 'Trace ID')}
                >
                  复制
                </button>
                <button
                  type="button"
                  className="rounded-[6px] px-1.5 py-0.5 text-[12px] text-primary transition-colors duration-150 hover:bg-primary-soft"
                  onClick={() => onFilterTrace(item.trace_id)}
                >
                  查看同链路
                </button>
              </div>
            )}
          </div>
          <p className="mono mt-1.5 break-all text-[12px] leading-5 text-ink-secondary">
            {item.trace_id || '—'}
          </p>
        </div>

        {item.error_code && (
          <Notice tone={levelTone(item.level) === 'danger' ? 'danger' : 'warning'}>
            错误码：<span className="mono">{item.error_code}</span>
          </Notice>
        )}

        <PayloadSection title="日志详情" value={item.detail} />
      </div>

      <footer className="flex justify-end border-t border-border-subtle px-5 py-3">
        <Button size="sm" onClick={onClose}>关闭</Button>
      </footer>
    </Modal>
  )
}
