import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { listLogs, type LogItem } from '../api/logs'
import Button from '../components/Button'
import { toast } from '../components/toast'
import { Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

const PHASE_LABELS: Record<string, string> = {
  translate: '翻译',
  analyze: '判断',
  describe: '读图',
  decide: '决策',
  connect: '连通测试',
  vision: '看图测试',
}

const PAGE_SIZE = 50

export default function LogsPage() {
  const [items, setItems] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [level, setLevel] = useState<'' | 'info' | 'error'>('')
  const [traceId, setTraceId] = useState('')
  const [query, setQuery] = useState({ level: '' as '' | 'info' | 'error', traceId: '' })
  const [detail, setDetail] = useState<LogItem | null>(null)
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
          level: query.level || undefined,
          trace_id: query.traceId.trim() || undefined,
        })
        setTotal(page.total)
        setItems((prev) => (append ? [...prev, ...page.items] : page.items))
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '日志未能载入')
      } finally {
        setBusy(false)
      }
    },
    [query],
  )

  useEffect(() => {
    void load(0, false)
  }, [load])

  return (
    <PageShell>
      <PageBody>
        <PageHeader title="日志查询" description={`日志保留 15 天，共 ${total} 条。`} />
        {error && <Notice tone="danger">{error}</Notice>}
        <form
          className="mb-4 flex flex-wrap items-end gap-3 rounded-[8px] border border-border bg-surface px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault()
            setQuery({ level, traceId })
          }}
        >
          <label className="block min-w-[140px]">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">级别</span>
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as '' | 'info' | 'error')}
              className="h-9 w-full rounded-[6px] border border-border bg-surface px-3 text-[14px] outline-none focus:border-primary"
            >
              <option value="">全部</option>
              <option value="info">信息</option>
              <option value="error">错误</option>
            </select>
          </label>
          <label className="block min-w-[280px] flex-1">
            <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">traceId</span>
            <input
              className="mono h-9 w-full rounded-[6px] border border-border bg-surface px-3 text-[14px] outline-none focus:border-primary"
              placeholder="输入完整 traceId"
              value={traceId}
              onChange={(event) => setTraceId(event.target.value)}
            />
          </label>
          <Button size="sm" type="submit" variant="primary" loading={busy}>查询</Button>
        </form>

        <div className="overflow-hidden rounded-[8px] border border-border bg-surface">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border bg-surface-muted text-[12px] text-ink-muted">
              <tr>
                <th className="w-14 px-4 py-3 font-medium">#</th>
                <th className="w-20 px-4 py-3 font-medium">级别</th>
                <th className="px-4 py-3 font-medium">traceId</th>
                <th className="w-28 px-4 py-3 font-medium">阶段</th>
                <th className="w-44 px-4 py-3 font-medium">时间</th>
                <th className="px-4 py-3 font-medium">信息</th>
                <th className="w-16 px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id} className="border-b border-border-subtle last:border-0 hover:bg-[#f8fbff]">
                  <td className="px-4 py-3.5 text-ink-muted">{index + 1}</td>
                  <td className="px-4 py-3.5">
                    <StatusTag tone={item.level === 'error' ? 'danger' : 'info'}>
                      {item.level === 'error' ? '错误' : '信息'}
                    </StatusTag>
                  </td>
                  <td className="mono max-w-[240px] truncate px-4 py-3.5 text-ink-secondary">{item.trace_id || '—'}</td>
                  <td className="px-4 py-3.5 text-ink-secondary">{PHASE_LABELS[item.phase] ?? item.phase}</td>
                  <td className="px-4 py-3.5 text-ink-muted">{formatTime(item.created_at)}</td>
                  <td className="max-w-[260px] truncate px-4 py-3.5 text-ink">{item.error || item.model || '—'}</td>
                  <td className="px-4 py-3.5 text-right">
                    <button type="button" className="text-[13px] text-primary hover:underline" onClick={() => setDetail(item)}>
                      详情
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center text-[13px] text-ink-muted">没有符合条件的日志</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {items.length < total && (
          <div className="mt-3 flex justify-center">
            <Button size="sm" loading={busy} onClick={() => void load(items.length, true)}>加载更多</Button>
          </div>
        )}
        {detail && <LogDetail item={detail} onClose={() => setDetail(null)} />}
      </PageBody>
    </PageShell>
  )
}

function LogDetail({ item, onClose }: { item: LogItem; onClose: () => void }) {
  const text = `${pretty(item.request)}\n\n${pretty(item.response)}`
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 px-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-[10px] border border-border bg-surface shadow-[0_16px_48px_rgb(15_23_42/0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
          <h3 className="text-[15px] font-semibold text-ink">{PHASE_LABELS[item.phase] ?? item.phase}</h3>
          <button type="button" className="text-[13px] text-ink-muted" onClick={onClose}>关闭</button>
        </div>
        <div className="space-y-3 overflow-auto px-5 py-4">
          <p className="text-[13px] text-ink-secondary">
            {item.level === 'error' ? '错误' : '信息'} · {item.model || '—'} · {item.latency_ms} ms
            {item.status_code ? ` · HTTP ${item.status_code}` : ''}
          </p>
          <p className="mono break-all text-[12px] text-ink-muted">{item.trace_id}</p>
          {item.error && <Notice tone="danger">{item.error}</Notice>}
          <pre className="mono whitespace-pre-wrap break-all rounded-[6px] bg-surface-muted p-3 text-[12px] leading-5 text-ink-secondary">
            {text}
          </pre>
        </div>
        <div className="flex justify-end border-t border-border-subtle px-5 py-3">
          <Button
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => toast('复制成功'),
                () => toast('复制失败', 'danger'),
              )
            }}
          >
            复制
          </Button>
        </div>
      </div>
    </div>
  )
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
