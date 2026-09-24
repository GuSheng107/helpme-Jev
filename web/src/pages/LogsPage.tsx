import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { listLogs, type LogItem, type LogLevel } from '../api/logs'
import Button from '../components/Button'
import { EmptyState, Notice, PageHeader, PageShell, StatusTag } from '../components/layout'
import LogDetail from './LogDetail'
import { formatLocalTime } from '../utils/datetime'
import { KIND_LABELS, levelLabel, levelTone, PHASE_LABELS } from './logPresentation'

const PAGE_SIZES = [20, 50, 100]
const CONTROL_CLASS = 'h-9 w-full rounded-[6px] border border-border bg-surface px-3 text-[14px] text-ink outline-none focus:border-primary'

type LevelFilter = '' | LogLevel
type KindFilter = '' | 'jev' | 'llm'

interface Filters {
  level: LevelFilter
  kind: KindFilter
  traceId: string
}

const EMPTY_FILTERS: Filters = {
  level: '',
  kind: '',
  traceId: '',
}

function summary(item: LogItem): string {
  if (item.error) return item.error
  return item.model || (item.status_code ? `HTTP ${item.status_code}` : '调用完成')
}

export default function LogsPage() {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [reload, setReload] = useState(0)
  const [items, setItems] = useState<LogItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<LogItem | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setItems([])
    setTotal(0)
    listLogs({
      limit: pageSize,
      offset: (page - 1) * pageSize,
      level: filters.level || undefined,
      kind: filters.kind || undefined,
      trace_id: filters.traceId || undefined,
    }).then(
      (result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
      },
      (caught) => {
        if (cancelled) return
        setError(caught instanceof ApiError ? caught.message : '日志未能载入')
      },
    ).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [filters, page, pageSize, reload])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasFilters = Object.values(filters).some(Boolean)
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRow = Math.min(page * pageSize, total)

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPage(1)
    setDetail(null)
    setFilters({ ...draft, traceId: draft.traceId.trim() })
    setReload((value) => value + 1)
  }

  function resetSearch() {
    setDraft(EMPTY_FILTERS)
    setFilters(EMPTY_FILTERS)
    setPage(1)
    setDetail(null)
    setReload((value) => value + 1)
  }

  function filterByTrace(traceId: string) {
    const next = { ...EMPTY_FILTERS, traceId }
    setDraft(next)
    setFilters(next)
    setPage(1)
    setDetail(null)
    setReload((value) => value + 1)
  }

  function changePage(next: number) {
    setPage(next)
    setDetail(null)
  }

  return (
    <PageShell>
      <main className="mx-auto max-w-[1480px] px-5 py-6">
        <PageHeader
          title="日志查询"
          description="按 Trace ID 追踪一次操作中的 JEV / LLM 调用；这里只显示你自己的记录。"
          actions={<Button size="sm" onClick={() => setReload((value) => value + 1)}>刷新</Button>}
        />
        {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
        <form onSubmit={submitSearch} className="mb-4 rounded-[8px] border border-border bg-surface p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-full sm:w-44">
              <span className="mb-1 block text-[13px] font-medium text-ink-secondary">级别</span>
              <select className={CONTROL_CLASS} value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value as LevelFilter })}>
                <option value="">全部级别</option>
                <option value="info">信息</option>
                <option value="warn">警告</option>
                <option value="error">错误</option>
              </select>
            </label>
            <label className="block w-full sm:w-44">
              <span className="mb-1 block text-[13px] font-medium text-ink-secondary">类型</span>
              <select className={CONTROL_CLASS} value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as KindFilter })}>
                <option value="">全部类型</option>
                <option value="jev">JEV</option>
                <option value="llm">LLM</option>
              </select>
            </label>
            <label className="block min-w-[240px] flex-1">
              <span className="mb-1 block text-[13px] font-medium text-ink-secondary">Trace ID</span>
              <input className={`${CONTROL_CLASS} mono`} maxLength={64} value={draft.traceId} placeholder="输入完整 Trace ID" onChange={(event) => setDraft({ ...draft, traceId: event.target.value })} />
            </label>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button type="button" size="sm" onClick={resetSearch}>重置</Button>
              <Button type="submit" size="sm" variant="primary">查询</Button>
            </div>
          </div>
        </form>

        <section className="overflow-hidden rounded-[8px] border border-border bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.06)]" aria-busy={loading}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-4 py-3">
            <h2 className="text-[15px] font-semibold text-ink">调用记录</h2>
            <span className="text-[12px] text-ink-muted">共 {total} 条 · 当前 {firstRow}–{lastRow} 条</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-[13px]">
              <thead className="bg-surface-muted text-[12px] text-ink-muted">
                <tr>
                  <th className="w-16 px-4 py-3 text-center font-medium">行号</th>
                  <th className="w-20 px-4 py-3 font-medium">级别</th>
                  <th className="w-20 px-4 py-3 font-medium">类型</th>
                  <th className="w-28 px-4 py-3 font-medium">阶段</th>
                  <th className="w-48 px-4 py-3 font-medium">Trace ID</th>
                  <th className="w-44 px-4 py-3 font-medium">时间</th>
                  <th className="px-4 py-3 font-medium">模型 / 信息</th>
                  <th className="w-24 px-4 py-3 font-medium">耗时</th>
                  <th className="w-24 px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {items.map((item, index) => (
                  <tr key={item.id} className="hover:bg-surface-muted/70">
                    <td className="px-4 py-3 text-center text-ink-muted">{(page - 1) * pageSize + index + 1}</td>
                    <td className="px-4 py-3">
                      <StatusTag tone={levelTone(item.level)}>{levelLabel(item.level)}</StatusTag>
                    </td>
                    <td className="px-4 py-3"><StatusTag tone="primary">{KIND_LABELS[item.kind]}</StatusTag></td>
                    <td className="px-4 py-3 text-ink-secondary">{PHASE_LABELS[item.phase] ?? item.phase}</td>
                    <td className="max-w-[190px] px-4 py-3">
                      {item.trace_id ? (
                        <button type="button" title={`按 ${item.trace_id} 筛选同链路`} className="mono block max-w-full truncate text-left text-[12px] text-primary hover:underline" onClick={() => filterByTrace(item.trace_id)}>
                          {item.trace_id}
                        </button>
                      ) : <span className="text-ink-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted" title={formatLocalTime(item.created_at)}>{formatLocalTime(item.created_at)}</td>
                    <td className="max-w-[250px] px-4 py-3" title={summary(item)}>
                      <span className={`block truncate ${levelTone(item.level) === 'danger' ? 'text-danger' : levelTone(item.level) === 'warning' ? 'text-warning' : 'text-ink-secondary'}`}>{summary(item)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-ink-muted">{item.latency_ms} ms</td>
                    <td className="px-4 py-3 text-right">
                      <button type="button" className="whitespace-nowrap text-primary hover:underline" onClick={() => setDetail(item)}>查看详情</button>
                    </td>
                  </tr>
                ))}
                {loading && (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-ink-muted">正在载入日志…</td></tr>
                )}
                {!loading && !error && items.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        title={total === 0 && !hasFilters ? '还没有调用记录' : '没有符合条件的日志'}
                        description="调整筛选条件或刷新页面，查看最近的 JEV / LLM 调用。"
                        action={<Button size="sm" onClick={resetSearch}>清除筛选</Button>}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3">
            <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
              每页
              <select
                className="h-8 rounded-[6px] border border-border bg-surface px-2 text-[13px]"
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
              </select>
            </label>
            <div className="flex items-center gap-1">
              <Button size="sm" disabled={loading || page <= 1} disabledReason="已经是第一页" onClick={() => changePage(1)}>首页</Button>
              <Button size="sm" disabled={loading || page <= 1} disabledReason="已经是第一页" onClick={() => changePage(page - 1)}>上一页</Button>
              <span className="min-w-20 px-2 text-center text-[12px] text-ink-secondary">{page} / {totalPages}</span>
              <Button size="sm" disabled={loading || page >= totalPages} disabledReason="已经是最后一页" onClick={() => changePage(page + 1)}>下一页</Button>
              <Button size="sm" disabled={loading || page >= totalPages} disabledReason="已经是最后一页" onClick={() => changePage(totalPages)}>末页</Button>
            </div>
          </div>
        </section>
        {detail && <LogDetail item={detail} onClose={() => setDetail(null)} onFilterTrace={filterByTrace} />}
      </main>
    </PageShell>
  )
}
