import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { listLogs, type LogItem, type LogLine } from '../api/logs'
import Button from '../components/Button'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

const PHASE_LABELS: Record<string, string> = {
  translate: '翻译',
  analyze: '判断',
  describe: '读图',
  decide: '决策',
}

const PAGE_SIZE = 50

interface Props {
  onBack: () => void
}

export default function LogsPage({ onBack }: Props) {
  const [items, setItems] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [kind, setKind] = useState<'' | 'jev' | 'llm'>('')
  const [traceId, setTraceId] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setBusy(true)
      setError(null)
      try {
        const page = await listLogs({
          limit: PAGE_SIZE,
          offset,
          kind: kind || undefined,
          trace_id: traceId.trim() || undefined,
        })
        setTotal(page.total)
        setItems((prev) => (append ? [...prev, ...page.items] : page.items))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '日志未能载入')
      } finally {
        setBusy(false)
      }
    },
    [kind, traceId],
  )

  useEffect(() => {
    void load(0, false)
  }, [load])

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="调用日志"
          description="每次判断的完整链路。原文与译文并排，便于分清是翻译错还是判断错。日志保留 15 天。"
          actions={<Button onClick={onBack}>返回</Button>}
        />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex rounded-[6px] border border-border p-0.5">
            {(
              [
                ['', '全部'],
                ['jev', '判断'],
                ['llm', '语言模型'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value || 'all'}
                type="button"
                className={`rounded-[4px] px-2 py-0.5 text-[13px] ${
                  kind === value ? 'bg-primary text-white' : 'text-ink-secondary'
                }`}
                onClick={() => setKind(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            className="mono w-52 rounded-[6px] border border-border px-2 py-1 text-[13px]"
            placeholder="按 traceId 过滤（可在结果页复制）"
            value={traceId}
            onChange={(event) => setTraceId(event.target.value)}
          />
          <Button size="sm" loading={busy} onClick={() => void load(0, false)}>
            查询
          </Button>
          <span className="ml-auto text-[13px] text-ink-muted">共 {total} 条</span>
        </div>

        {items.length === 0 && !busy ? (
          <EmptyState title="还没有日志" description="做一次分析或决策后，这里能看到完整链路。" />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <LogCard
                key={item.id}
                item={item}
                open={expanded === item.id}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              />
            ))}
            {items.length < total && (
              <div className="flex justify-center pt-2">
                <Button size="sm" loading={busy} onClick={() => void load(items.length, true)}>
                  加载更多
                </Button>
              </div>
            )}
          </div>
        )}
      </PageBody>
    </PageShell>
  )
}

function LogCard({ item, open, onToggle }: { item: LogItem; open: boolean; onToggle: () => void }) {
  const lines = extractLines(item)
  return (
    <DataCard>
      <button type="button" className="flex w-full flex-wrap items-center gap-2 text-left" onClick={onToggle}>
        <StatusTag tone={item.kind === 'jev' ? 'primary' : 'info'}>
          {item.kind === 'jev' ? '判断' : '语言模型'}
        </StatusTag>
        <span className="text-[13px] text-ink-secondary">{PHASE_LABELS[item.phase] ?? item.phase}</span>
        <span className="text-[13px] text-ink-muted">{formatTime(item.created_at)}</span>
        <span className="text-[13px] text-ink-muted">{item.latency_ms}ms</span>
        {item.error && <StatusTag tone="danger">失败</StatusTag>}
        <span className="ml-auto text-[12px] text-ink-muted">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
          <p className="mono break-all text-[12px] text-ink-muted">
            trace {item.trace_id} · {item.model || '—'}
            {item.status_code ? ` · HTTP ${item.status_code}` : ''}
          </p>
          {item.error && <Notice tone="danger">{item.error}</Notice>}
          {lines !== null && (
            <div>
              <p className="mb-1 text-[12px] text-ink-muted">原文 / 译文（并排对照）</p>
              <ul className="divide-y divide-border-subtle rounded-[6px] border border-border">
                {lines.map((line) => (
                  <li key={line.seq} className="grid gap-1 p-2 sm:grid-cols-2 sm:gap-3">
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-ink">
                      {line.original || '（图片）'}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-5 text-ink-secondary">
                      {line.annotated}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="text-[13px]">
            <summary className="cursor-pointer text-ink-muted">原始请求 / 响应</summary>
            <pre className="mono mt-2 max-h-64 overflow-auto rounded-[6px] bg-surface-muted p-2 text-[12px] leading-5 text-ink-secondary">
              {pretty(item.request)}
            </pre>
            <pre className="mono mt-2 max-h-64 overflow-auto rounded-[6px] bg-surface-muted p-2 text-[12px] leading-5 text-ink-secondary">
              {pretty(item.response)}
            </pre>
          </details>
        </div>
      )}
    </DataCard>
  )
}

function extractLines(item: LogItem): LogLine[] | null {
  const request = item.request
  if (item.kind === 'llm' && item.phase === 'translate' && typeof request === 'object' && request !== null) {
    const lines = (request as { lines?: unknown }).lines
    if (Array.isArray(lines)) {
      return lines
        .filter((line): line is LogLine => typeof line === 'object' && line !== null && 'original' in line)
        .map((line) => ({ seq: String(line.seq ?? ''), original: String(line.original ?? ''), annotated: String(line.annotated ?? '') }))
    }
  }
  return null
}

function pretty(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace('Z', ' UTC')
}
