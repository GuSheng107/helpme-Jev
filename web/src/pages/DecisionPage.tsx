import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  decide, listDecisionHistory, polishDecision,
  type DecideResponse, type DecideResult, type DecisionHistoryItem, type QuestionType,
} from '../api/decide'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import { DataCard, Notice, PageBody, PageHeader, PageShell } from '../components/layout'
import { formatLocalTime } from '../utils/datetime'

const TYPE_LABELS: Record<QuestionType, string> = {
  noul: '是非题',
  choice: '选择题',
  score: '评分题',
}
const PAGE_SIZE = 5

interface DecisionDraft {
  question: string
  options: string[]
  context: string
}

export default function DecisionPage() {
  const [kind, setKind] = useState<QuestionType>('choice')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [context, setContext] = useState('')
  const [answer, setAnswer] = useState<DecideResponse | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [beforePolish, setBeforePolish] = useState<DecisionDraft | null>(null)
  const [history, setHistory] = useState<DecisionHistoryItem[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [selectedHistory, setSelectedHistory] = useState<DecisionHistoryItem | null>(null)
  const questionRef = useRef<HTMLTextAreaElement>(null)
  const contextRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    for (const node of [questionRef.current, contextRef.current]) {
      if (!node) continue
      node.style.height = 'auto'
      node.style.height = node.scrollHeight + 'px'
    }
  }, [question, context, kind])

  const busy = deciding || polishing
  const filledOptions = options.map((item) => item.trim()).filter(Boolean)
  const canSubmit = question.trim().length > 0 && (kind !== 'choice' || filledOptions.length >= 2)

  const loadHistory = useCallback(async (page: number) => {
    setHistoryLoading(true)
    setHistory([])
    setHistoryError('')
    try {
      const data = await listDecisionHistory(PAGE_SIZE, page * PAGE_SIZE)
      setHistory(data.items)
      setHistoryTotal(data.total)
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : '历史任务未能载入')
    } finally {
      setHistoryLoading(false)
    }
  }, [])
  useEffect(() => { void loadHistory(historyPage) }, [historyPage, loadHistory])

  async function removeOption(index: number) {
    if (busy || !await confirmAction({
      title: '删除选项',
      message: `删除选项 ${String.fromCharCode(65 + index)}？当前填写的内容会被移除。`,
      confirmText: '确认删除',
      tone: 'danger',
    })) return
    setBeforePolish(null)
    setOptions((current) => current.filter((_, position) => position !== index))
  }

  async function run() {
    if (busy || !canSubmit) return
    setAnswer(null)
    setDeciding(true)
    setError(null)
    try {
      const answered = await decide({
        question: question.trim(),
        question_type: kind,
        options: kind === 'choice' ? filledOptions : [],
        context: context.trim(),
      })
      setAnswer(answered)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '判断未完成')
    } finally {
      setDeciding(false)
      if (historyPage === 0) void loadHistory(0)
      else setHistoryPage(0)
    }
  }

  async function polishForm() {
    if (busy || !question.trim()) return
    const original: DecisionDraft = { question, options: [...options], context }
    setPolishing(true)
    setError(null)
    try {
      const result = await polishDecision({
        question,
        question_type: kind,
        options: kind === 'choice' ? options : [],
        context,
      })
      setBeforePolish(original)
      setQuestion(result.question)
      if (kind === 'choice') setOptions(result.options)
      setContext(result.context)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '润色未完成')
    } finally {
      setPolishing(false)
    }
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader title="决策工作台" description="填写题目和背景，选择判断方式。" />
        <div className="relative" aria-busy={busy}>
          {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
          <div className="grid items-stretch gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <DataCard title="发起判断" className="relative flex h-full flex-col" bodyClassName="flex flex-1 flex-col">
            <div role="tablist" aria-label="题型" className="mb-3 flex rounded-[6px] border border-border p-0.5">
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((item) => (
                <button key={item} type="button" role="tab" aria-selected={kind === item} disabled={busy}
                  className={`min-w-0 flex-1 rounded-[4px] px-2 py-1.5 text-[13px] ${kind === item ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-surface-muted'}`}
                  onClick={() => { setKind(item); setAnswer(null); setError(null); setBeforePolish(null) }}>
                  {TYPE_LABELS[item]}
                </button>
              ))}
            </div>
            <div>
              <textarea
                ref={questionRef}
                className="min-h-24 w-full resize-none overflow-hidden rounded-[6px] border border-border bg-surface p-3 text-[14px] text-ink disabled:opacity-65"
                placeholder={kind === 'noul' ? '例：现在适合跟他提加薪吗？' : kind === 'choice' ? '例：哪个方案更可能让老板满意？' : '例：这次发布的风险有多高？'}
                value={question} disabled={busy}
                onChange={(event) => { setQuestion(event.target.value); setBeforePolish(null) }}
              />
            </div>
            {kind === 'choice' && (
              <div className="mt-3 space-y-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-[13px] text-ink-muted">{String.fromCharCode(65 + index)}</span>
                    <input className="min-w-0 flex-1 rounded-[6px] border border-border bg-surface px-3 py-2 text-[14px]" disabled={busy}
                      placeholder={`选项 ${String.fromCharCode(65 + index)}`} value={option}
                      onChange={(event) => { setBeforePolish(null); setOptions((prev) => prev.map((value, i) => i === index ? event.target.value : value)) }} />
                    {options.length > 2 && (
                      <button type="button" disabled={busy} className="shrink-0 text-[13px] text-ink-muted hover:text-danger disabled:opacity-50" onClick={() => void removeOption(index)}>删除</button>
                    )}
                  </div>
                ))}
                {options.length < 10 && (
                  <button type="button" disabled={busy} className="text-[13px] text-primary disabled:opacity-50" onClick={() => { setBeforePolish(null); setOptions((prev) => [...prev, '']) }}>+ 添加选项</button>
                )}
              </div>
            )}
            <label className="mt-3 block text-[12px] text-ink-muted">上下文（可选）
              <textarea ref={contextRef} className="mt-1 min-h-20 w-full resize-none overflow-hidden rounded-[6px] border border-border bg-surface p-3 text-[14px] text-ink disabled:opacity-65"
                placeholder="补充与题目相关的背景" value={context} disabled={busy} onChange={(event) => { setContext(event.target.value); setBeforePolish(null) }} />
            </label>
            {kind === 'score' && <p className="mt-2 text-[12px] text-ink-muted">评分显示为 0–10 分；Jev 按 10 个档位判断，结果会等比例换算并保留两位小数。</p>}
            <div className="mt-auto flex flex-wrap justify-end gap-2 pt-3">
              {beforePolish !== null && (
                <button type="button" disabled={busy} className="mr-auto text-[13px] text-primary disabled:opacity-50" onClick={() => {
                  setQuestion(beforePolish.question)
                  setOptions(beforePolish.options)
                  setContext(beforePolish.context)
                  setBeforePolish(null)
                }}>撤回润色</button>
              )}
              <Button size="sm" loading={polishing} disabled={busy || !question.trim()} disabledReason="请先输入问题" onClick={() => void polishForm()}>润色</Button>
              <Button variant="primary" size="sm" loading={deciding} disabled={busy || !canSubmit}
                disabledReason={kind === 'choice' ? '选择题至少两个非空选项' : '请先输入问题'} onClick={() => void run()}>判断</Button>
            </div>
            {polishing && (
              <div role="status" className="absolute inset-0 z-10 flex items-center justify-center rounded-[8px] bg-white/75 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface px-4 py-2 text-[13px] font-medium text-primary shadow-sm">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  正在润色题目、选项和上下文…
                </div>
              </div>
            )}
          </DataCard>
          <div className="flex h-full min-w-0 flex-col gap-4">
          <DataCard title="当前结果">
            {answer ? (
              <>
                <ResultView result={answer.result} />
                <p className="mt-3 text-[12px] text-ink-muted">模型 {answer.model || '—'} · 耗时 {answer.latency_ms}ms</p>
              </>
            ) : <p className="py-3 text-[13px] text-ink-muted">当前没有结果</p>}
          </DataCard>
          <DataCard title="历史任务" className="flex flex-1 flex-col" bodyClassName="flex flex-1 flex-col">
            {selectedHistory ? <HistoryDetail item={selectedHistory} onClose={() => setSelectedHistory(null)} /> : <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted">
              <span>仅保留近 15 天的决策记录</span>
              <span>共 {historyTotal} 条</span>
            </div>
            {historyError && <div className="mb-3"><Notice tone="danger">{historyError}</Notice></div>}
            {historyLoading && history.length === 0 ? <p className="py-4 text-center text-[13px] text-ink-muted">载入中…</p>
              : history.length === 0 ? <p className="py-4 text-center text-[13px] text-ink-muted">近 15 天没有决策任务</p>
                : <ul className="divide-y divide-border-subtle">
                  {history.map((item) => (
                    <li key={item.id}>
                      <button type="button" disabled={deciding} onClick={() => setSelectedHistory(item)}
                        className="flex w-full flex-col gap-1 py-3 text-left hover:bg-surface-muted disabled:opacity-60 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                        <span className="min-w-0 truncate text-[13px] font-medium text-ink">{item.question || '旧日志未记录原题'}</span>
                        <span className="flex shrink-0 flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                          <span>{item.question_type in TYPE_LABELS ? TYPE_LABELS[item.question_type as QuestionType] : '题型未记录'}</span>
                          <span className={item.status === 'success' ? 'text-success' : 'text-danger'}>{item.status === 'success' ? '完成' : '失败'}</span>
                          <time>{formatLocalTime(item.created_at)}</time>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>}
            {historyTotal > PAGE_SIZE && (
              <div className="mt-auto flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
                <Button size="sm" disabled={historyPage === 0 || historyLoading || deciding} onClick={() => setHistoryPage((page) => page - 1)}>上一页</Button>
                <span className="text-[12px] text-ink-muted">{historyPage + 1} / {Math.max(1, Math.ceil(historyTotal / PAGE_SIZE))}</span>
                <Button size="sm" disabled={(historyPage + 1) * PAGE_SIZE >= historyTotal || historyLoading || deciding} onClick={() => setHistoryPage((page) => page + 1)}>下一页</Button>
              </div>
            )}
            </>}
          </DataCard>
          </div>
          </div>
          {deciding && (
            <div role="status" className="absolute inset-0 z-10 flex items-start justify-center rounded-[8px] bg-page/80 pt-32 backdrop-blur-[1px]">
              <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface px-5 py-3 text-[14px] font-medium text-ink shadow-sm">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />判断中…
              </div>
            </div>
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}

function HistoryDetail({ item, onClose }: { item: DecisionHistoryItem; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-muted">{formatLocalTime(item.created_at)} · {item.question_type in TYPE_LABELS ? TYPE_LABELS[item.question_type as QuestionType] : '题型未记录'}</p>
        <Button size="sm" variant="text" onClick={onClose}>返回列表</Button>
      </div>
      <div>
        <p className="mb-1 text-[12px] text-ink-muted">题目</p>
        <p className="whitespace-pre-wrap break-words text-[14px] text-ink">{item.question || '旧日志未记录原题'}</p>
      </div>
      {item.options.length > 0 && <div>
        <p className="mb-1 text-[12px] text-ink-muted">选项</p>
        <ul className="space-y-1 text-[13px] text-ink-secondary">{item.options.map((option, index) => <li key={index}>{String.fromCharCode(65 + index)}. {option}</li>)}</ul>
      </div>}
      {item.context && <div>
        <p className="mb-1 text-[12px] text-ink-muted">上下文</p>
        <p className="whitespace-pre-wrap break-words text-[13px] text-ink-secondary">{item.context}</p>
      </div>}
      <div className="border-t border-border-subtle pt-4">
        {item.result ? <ResultView result={item.result} /> : <Notice tone="danger">{item.error || '任务未完成'}</Notice>}
      </div>
      {item.result && <p className="text-[12px] text-ink-muted">模型 {item.model || '—'} · 耗时 {item.latency_ms}ms</p>}
    </div>
  )
}

function ResultView({ result }: { result: DecideResult }) {
  if (result.kind === 'noul') {
    const percent = result.percent ?? 0
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink-secondary">判断</span>
          <span className="text-[20px] font-semibold text-ink">{result.text}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-border-subtle">
          <div className="block h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-right text-[12px] text-ink-muted">倾向「是」{percent}%</p>
      </div>
    )
  }
  if (result.kind === 'choice') {
    const bars = result.bars ?? []
    return (
      <div>
        <p className="text-[13px] text-ink-secondary">最可能：<span className="text-[14px] font-medium text-ink">{result.top ?? '—'}</span></p>
        <ul className="mt-3 space-y-2">
          {bars.map((bar) => (
            <li key={bar.key} className="flex items-center gap-2">
              <span title={bar.label} className="w-24 shrink-0 truncate text-[13px] text-ink-secondary sm:w-36">{bar.label}</span>
              <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border-subtle">
                <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%` }} />
              </span>
              <span className="w-10 text-right text-[12px] text-ink-muted">{Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const rawMax = result.scale_max ?? 9
  const raw = result.value ?? 0
  const display = result.display_value ?? Math.round(raw / rawMax * 1000) / 100
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-secondary">换算分数</span>
        <span className="text-[20px] font-semibold text-ink">{display.toFixed(2)} / 10</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-border-subtle">
        <div className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, display * 10))}%` }} />
      </div>
      <p className="mt-2 text-[12px] text-ink-muted">Jev 原始 score：{raw} / {rawMax}；按档位范围等比例换算。</p>
    </div>
  )
}
