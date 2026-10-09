import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { listLogs, type LogCategory, type LogItem, type LogLevel } from '../api/logs'
import Button from '../components/Button'
import { controlClass } from '../components/Field'
import { EmptyState, Notice, PageHeader, PageShell, StatusTag } from '../components/layout'
import Pager from '../components/Pager'
import { IconClose, IconRefresh } from '../components/icons'
import LogDetail from './LogDetail'
import { formatLocalTime } from '../utils/datetime'
import { CATEGORY_LABELS, levelLabel, levelTone } from './logPresentation'

const PAGE_SIZES = [20, 50, 100]

const SELECT = controlClass.replace('w-full', 'w-full cursor-pointer')

type LevelFilter = '' | LogLevel
type CategoryFilter = '' | LogCategory

interface Filters {
  level: LevelFilter
  category: CategoryFilter
  traceId: string
  startTime: string
  endTime: string
}

const EMPTY_FILTERS: Filters = {
  level: '',
  category: '',
  traceId: '',
  startTime: '',
  endTime: '',
}

const LEVEL_OPTIONS: { value: LevelFilter; label: string }[] = [
  { value: '', label: '全部级别' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
]

function toStartTime(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

function toEndTime(value: string): string | undefined {
  return value ? new Date(`${value}:59.999`).toISOString() : undefined
}

/** datetime-local 的值转成更好读的展示文本 */
function prettyStamp(value: string): string {
  return value.replace('T', ' ').slice(0, 16)
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
  const [querying, setQuerying] = useState(false)
  const [paging, setPaging] = useState<number | null>(null)
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
      category: filters.category || undefined,
      trace_id: filters.traceId || undefined,
      start_time: toStartTime(filters.startTime),
      end_time: toEndTime(filters.endTime),
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
      if (!cancelled) {
        setLoading(false)
        setQuerying(false)
        setPaging(null)
      }
    })
    return () => { cancelled = true }
  }, [filters, page, pageSize, reload])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const hasFilters = Object.values(filters).some(Boolean)
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1
  const lastRow = Math.min(page * pageSize, total)

  /** 应用一组筛选：草稿与生效值同步、回到第一页、关掉详情。 */
  function applyFilters(next: Filters) {
    setDraft(next)
    setFilters(next)
    setPage(1)
    setDetail(null)
    setReload((value) => value + 1)
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setQuerying(true)
    applyFilters({ ...draft, traceId: draft.traceId.trim() })
  }

  function resetSearch() {
    applyFilters(EMPTY_FILTERS)
  }

  function filterByTrace(traceId: string) {
    applyFilters({ ...EMPTY_FILTERS, traceId })
  }

  function changePage(next: number) {
    if (loading || next === page || next < 1 || next > totalPages) return
    setPaging(next)
    setPage(next)
    setDetail(null)
  }

  const chips: { key: keyof Filters; label: string }[] = []
  if (filters.level) chips.push({ key: 'level', label: `级别：${levelLabel(filters.level)}` })
  if (filters.category) {
    chips.push({ key: 'category', label: `类型：${CATEGORY_LABELS[filters.category] ?? filters.category}` })
  }
  if (filters.startTime) chips.push({ key: 'startTime', label: `起：${prettyStamp(filters.startTime)}` })
  if (filters.endTime) chips.push({ key: 'endTime', label: `止：${prettyStamp(filters.endTime)}` })
  if (filters.traceId) chips.push({ key: 'traceId', label: `Trace：${filters.traceId}` })

  return (
    <PageShell>
      <main className="mx-auto flex h-full max-h-full min-h-0 w-full max-w-[1440px] flex-col px-5 pb-6 pt-6 sm:px-8">
        <PageHeader
          title="日志查询"
          description="查询业务操作及同一 Trace ID 下的模型调用；这里只显示你自己的记录。"
          actions={
            <Button
              size="sm"
              loading={loading}
              disabled={loading}
              disabledReason="正在载入"
              onClick={() => setReload((value) => value + 1)}
            >
              <IconRefresh className="h-3.5 w-3.5" />
              刷新
            </Button>
          }
        />
        {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}

        <form
          onSubmit={submitSearch}
          className="mb-4 shrink-0 rounded-[14px] border border-border bg-surface p-4 shadow-card"
          aria-busy={loading}
        >
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-full sm:w-40">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">级别</span>
              <select
                className={SELECT}
                disabled={loading}
                value={draft.level}
                onChange={(event) => setDraft({ ...draft, level: event.target.value as LevelFilter })}
              >
                {LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="block w-full sm:w-40">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">类型</span>
              <select
                className={SELECT}
                disabled={loading}
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value as CategoryFilter })}
              >
                <option value="">全部类型</option>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label className="block w-full sm:w-52">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">开始时间</span>
              <input
                type="datetime-local"
                className={controlClass}
                disabled={loading}
                value={draft.startTime}
                onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
              />
            </label>
            <label className="block w-full sm:w-52">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">结束时间</span>
              <input
                type="datetime-local"
                className={controlClass}
                disabled={loading}
                value={draft.endTime}
                onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
              />
            </label>
            <label className="block min-w-[220px] flex-1">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">Trace ID</span>
              <input
                className={`${controlClass} mono`}
                disabled={loading}
                maxLength={64}
                value={draft.traceId}
                placeholder="粘贴完整 Trace ID 追同一条链路"
                onChange={(event) => setDraft({ ...draft, traceId: event.target.value })}
              />
            </label>
            <div className="flex w-full justify-end gap-2 sm:w-auto">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={loading || !hasFilters}
                disabledReason={loading ? '正在查询' : '当前没有筛选条件'}
                onClick={resetSearch}
              >
                重置
              </Button>
              <Button type="submit" size="sm" variant="primary" loading={querying} disabled={loading} disabledReason="正在查询">
                查询
              </Button>
            </div>
          </div>

          {chips.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-3">
              <span className="text-[12px] text-ink-muted">已筛选</span>
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  title="移除该条件"
                  className="group/chip inline-flex max-w-[240px] items-center gap-1 rounded-[6px] bg-primary-soft px-2 py-0.5 text-[12px] text-primary transition-colors duration-150 hover:bg-primary/15"
                  onClick={() => applyFilters({ ...filters, [chip.key]: '' })}
                >
                  <span className="truncate">{chip.label}</span>
                  <IconClose className="h-3 w-3 shrink-0 opacity-60 transition-opacity duration-150 group-hover/chip:opacity-100" />
                </button>
              ))}
              <button
                type="button"
                className="ml-1 text-[12px] text-ink-muted transition-colors duration-150 hover:text-ink"
                onClick={resetSearch}
              >
                全部清除
              </button>
            </div>
          )}
        </form>

        <section
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-border bg-surface shadow-card"
          aria-busy={loading}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-5 py-3">
            <h2 className="text-[16px] font-semibold tracking-tight text-ink">活动记录</h2>
            <span className="tnum text-[12px] text-ink-muted">
              共 {total} 条{total > 0 && <> · 当前 {firstRow}–{lastRow} 条</>}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full min-w-[1120px] text-left text-[13px]">
              <thead className="sticky top-0 z-[1] bg-surface-muted/95 text-[12px] text-ink-muted backdrop-blur-sm">
                <tr className="border-b border-border">
                  <th className="w-16 px-5 py-2.5 text-center font-semibold">行</th>
                  <th className="w-20 px-3 py-2.5 font-semibold">级别</th>
                  <th className="w-24 px-3 py-2.5 font-semibold">类型</th>
                  <th className="w-28 px-3 py-2.5 font-semibold">来源</th>
                  <th className="w-48 px-3 py-2.5 font-semibold">Trace ID</th>
                  <th className="w-40 px-3 py-2.5 font-semibold">时间</th>
                  <th className="px-3 py-2.5 font-semibold">摘要</th>
                  <th className="w-24 px-3 py-2.5 text-right font-semibold">耗时</th>
                  <th className="w-20 px-5 py-2.5 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {items.map((item, index) => (
                  <tr
                    key={item.id}
                    className="group/row transition-colors duration-150 hover:bg-surface-hover"
                  >
                    <td className="tnum px-5 py-2.5 text-center text-ink-faint">
                      {(page - 1) * pageSize + index + 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusTag tone={levelTone(item.level)}>{levelLabel(item.level)}</StatusTag>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <StatusTag tone="primary">{CATEGORY_LABELS[item.category] ?? item.category}</StatusTag>
                    </td>
                    <td className="px-3 py-2.5 text-ink-secondary">{item.source}</td>
                    <td className="max-w-[190px] px-3 py-2.5">
                      {item.trace_id ? (
                        <button
                          type="button"
                          title={`按 ${item.trace_id} 筛选同链路`}
                          className="mono block max-w-full truncate rounded-[6px] text-left text-[12px] text-primary transition-colors duration-150 hover:text-primary-hover hover:underline"
                          onClick={() => filterByTrace(item.trace_id)}
                        >
                          {item.trace_id}
                        </button>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-ink-muted" title={formatLocalTime(item.created_at)}>
                      {formatLocalTime(item.created_at)}
                    </td>
                    <td className="max-w-[250px] px-3 py-2.5" title={item.summary}>
                      <span
                        className={`block truncate ${
                          item.level === 'error'
                            ? 'text-danger'
                            : item.level === 'warn'
                              ? 'text-warning'
                              : 'text-ink-secondary'
                        }`}
                      >
                        {item.summary}
                      </span>
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-ink-muted">
                      {item.latency_ms} ms
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <button
                        type="button"
                        className="whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[13px] text-primary transition-colors duration-150 hover:bg-primary-soft"
                        onClick={() => setDetail(item)}
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                ))}

                {loading && (
                  <>
                    {Array.from({ length: 6 }, (_, row) => (
                      <tr key={`sk-${row}`} className="border-b border-border-subtle">
                        <td className="px-5 py-3"><span className="skeleton mx-auto block h-4 w-6" /></td>
                        <td className="px-3 py-3"><span className="skeleton block h-4 w-12" /></td>
                        <td className="px-3 py-3"><span className="skeleton block h-4 w-12" /></td>
                        <td className="px-3 py-3"><span className="skeleton block h-4 w-16" /></td>
                        <td className="px-3 py-3"><span className="skeleton block h-4 w-32" /></td>
                        <td className="px-3 py-3"><span className="skeleton block h-4 w-28" /></td>
                        <td className="px-3 py-3"><span className="skeleton block h-4 w-3/4" /></td>
                        <td className="px-3 py-3"><span className="skeleton ml-auto block h-4 w-12" /></td>
                        <td className="px-5 py-3"><span className="skeleton ml-auto block h-4 w-8" /></td>
                      </tr>
                    ))}
                  </>
                )}

                {!loading && !error && items.length === 0 && (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState
                        title={total === 0 && !hasFilters ? '还没有活动记录' : '没有符合条件的日志'}
                        description={
                          total === 0 && !hasFilters
                            ? '用过聊天、人设或决策功能后，这里会逐条记下每次操作与模型调用。'
                            : '当前筛选条件下没有命中记录，放宽时间范围或清掉部分条件再试。'
                        }
                        action={<Button size="sm" onClick={resetSearch} disabled={!hasFilters} disabledReason="当前没有筛选条件">清除筛选</Button>}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
            <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
              每页
              <select
                className="h-8 cursor-pointer rounded-[8px] border border-border bg-surface px-2 text-[13px] text-ink transition-colors duration-150 hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }}
              >
                {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
              </select>
            </label>
            <Pager
              page={page}
              pageCount={totalPages}
              pending={paging}
              disabled={loading}
              disabledReason="正在查询"
              onChange={changePage}
            />
          </div>
        </section>

        {detail && <LogDetail item={detail} onClose={() => setDetail(null)} onFilterTrace={filterByTrace} />}
      </main>
    </PageShell>
  )
}
