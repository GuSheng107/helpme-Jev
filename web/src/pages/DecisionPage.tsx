import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  decide, listDecisionHistory, polishDecision,
  type DecideResponse, type DecisionHistoryItem, type QuestionType,
} from '../api/decide'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import DecideResultView, { DECIDE_TYPE_LABELS as TYPE_LABELS } from '../components/DecideResultView'
import { DataCard, Notice, PageBody, PageHeader, PageShell } from '../components/layout'
import Modal from '../components/Modal'
import StageLoader, { type LoaderStep } from '../components/StageLoader'
import { formatLocalTime } from '../utils/datetime'
const PAGE_SIZES = [20, 50, 100]
// 完成态只停留一瞬间，让「翻译完成」能被看见，随即切到下一步。
const DONE_HOLD_MS = 280

type LoaderKey = 'translate' | 'decide' | 'polish'
const STEP_LABELS: Record<LoaderKey, { running: string; done: string }> = {
  translate: { running: '翻译中', done: '翻译完成' },
  decide: { running: '决策中', done: '决策完成' },
  polish: { running: '正在润色', done: '润色完成' },
}

function holdDone(): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, DONE_HOLD_MS) })
}

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
  const [historyRetention, setHistoryRetention] = useState(15)
  const [historyPage, setHistoryPage] = useState(0)
  const [historyPageSize, setHistoryPageSize] = useState(20)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyPaging, setHistoryPaging] = useState<number | null>(null)
  const [historyError, setHistoryError] = useState('')
  const [historyDetail, setHistoryDetail] = useState<DecisionHistoryItem | null>(null)
  const [plan, setPlan] = useState<LoaderKey[]>([])
  const [progress, setProgress] = useState(0)
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
  // 已完成的步数由服务端事件推进：progress 之前的算完成，正好卡在 progress 的算进行中
  const loaderSteps: LoaderStep[] = plan.map((key, index) => ({
    key,
    ...STEP_LABELS[key],
    state: index < progress ? 'done' : index === progress ? 'running' : 'pending',
  }))

  const loadHistory = useCallback(async (page: number, size: number) => {
    setHistoryLoading(true)
    setHistory([])
    setHistoryError('')
    try {
      const data = await listDecisionHistory(size, page * size)
      setHistory(data.items)
      setHistoryTotal(data.total)
      setHistoryRetention(data.retention_days)
    } catch (err) {
      setHistoryError(err instanceof ApiError ? err.message : '历史任务未能载入')
    } finally {
      setHistoryLoading(false)
      setHistoryPaging(null)
    }
  }, [])
  useEffect(() => { void loadHistory(historyPage, historyPageSize) }, [historyPage, historyPageSize, loadHistory])

  function changeHistoryPage(next: number) {
    if (historyLoading || next === historyPage || next < 0) return
    setHistoryPaging(next)
    setHistoryPage(next)
    setHistoryDetail(null)
  }

  function changeHistoryPageSize(size: number) {
    if (historyLoading || size === historyPageSize) return
    setHistoryPaging(0)
    setHistoryPageSize(size)
    setHistoryPage(0)
  }

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
    // 点击后立刻显示当前这一步；服务端确认计划后再对齐，避免空等。
    const ascii = /^[\x00-\x7F]*$/.test(`${question}${context}${filledOptions.join('')}`)
    setPlan(ascii ? ['decide'] : ['translate', 'decide'])
    setProgress(0)
    try {
      const answered = await decide(
        {
          question: question.trim(),
          question_type: kind,
          options: kind === 'choice' ? filledOptions : [],
          context: context.trim(),
        },
        (event) => {
          if (event.stage === 'plan') {
            setPlan(event.steps ?? [])
            setProgress(0)
          } else if (event.stage === 'translate_done' || event.stage === 'done') {
            setProgress((current) => current + 1)
          }
        },
      )
      setAnswer(answered)
      await holdDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '判断未完成')
    } finally {
      setDeciding(false)
      setPlan([])
      setProgress(0)
      if (historyPage === 0) void loadHistory(0, historyPageSize)
      else setHistoryPage(0)
    }
  }

  async function polishForm() {
    if (busy || !question.trim()) return
    const original: DecisionDraft = { question, options: [...options], context }
    setPolishing(true)
    setError(null)
    setPlan(['polish'])
    setProgress(0)
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
      setProgress(1)
      await holdDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '润色未完成')
    } finally {
      setPolishing(false)
      setPlan([])
      setProgress(0)
    }
  }

  return (
    <PageShell>
      <PageBody className="!py-0">
        <div className="pt-6">
        <PageHeader title="决策工作台" description="填写题目和背景，选择判断方式。" />
        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
        </div>
        <div className="relative pb-6" aria-busy={busy}>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <DataCard title="发起判断" className="relative">
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
            <div className="mt-3 flex flex-wrap justify-end gap-2">
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
                <div className="rounded-[8px] border border-border bg-surface px-5 py-4 shadow-sm">
                  <StageLoader steps={loaderSteps} />
                </div>
              </div>
            )}
          </DataCard>
          <div className="flex min-w-0 flex-col gap-4">
          <DataCard title="当前结果">
            {answer ? (
              <>
                <DecideResultView result={answer.result} />
                <p className="mt-3 text-[12px] text-ink-muted">模型 {answer.model || '—'} · 耗时 {answer.latency_ms}ms</p>
              </>
            ) : <p className="py-3 text-[13px] text-ink-muted">当前没有结果</p>}
          </DataCard>
          <DataCard title="历史任务">
            {historyDetail ? <HistoryDetail item={historyDetail} /> : <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted">
              <span>仅保留近 {historyRetention} 天的决策记录</span>
              <span>共 {historyTotal} 条</span>
            </div>
            {historyError && <div className="mb-3"><Notice tone="danger">{historyError}</Notice></div>}
            {historyLoading && history.length === 0 ? <p className="py-4 text-center text-[13px] text-ink-muted">载入中…</p>
              : history.length === 0 ? <p className="py-4 text-center text-[13px] text-ink-muted">近 {historyRetention} 天没有决策任务</p>
                : <ul className="divide-y divide-border-subtle">
                  {history.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink" title={item.question || undefined}>{item.question || '旧日志未记录原题'}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                          <span>{item.question_type in TYPE_LABELS ? TYPE_LABELS[item.question_type as QuestionType] : '题型未记录'}</span>
                          <span className={item.status === 'success' ? 'text-success' : 'text-danger'}>{item.status === 'success' ? '完成' : '失败'}</span>
                          <time>{formatLocalTime(item.created_at)}</time>
                        </div>
                      </div>
                      <button type="button" className="shrink-0 whitespace-nowrap text-[13px] text-primary hover:underline"
                        onClick={() => setHistoryDetail(item)}>查看详情</button>
                    </li>
                  ))}
                </ul>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
              <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
                每页
                <select className="h-8 rounded-[6px] border border-border bg-surface px-2 text-[13px]" disabled={historyLoading}
                  value={historyPageSize} onChange={(event) => changeHistoryPageSize(Number(event.target.value))}>
                  {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
                </select>
              </label>
              <div className="flex items-center gap-1">
                <Button size="sm" loading={historyPaging === 0} disabled={historyLoading || historyPage === 0 || deciding} disabledReason={historyLoading ? '正在载入' : '已经是第一页'} onClick={() => changeHistoryPage(0)}>首页</Button>
                <Button size="sm" loading={historyPaging === historyPage - 1} disabled={historyLoading || historyPage === 0 || deciding} disabledReason={historyLoading ? '正在载入' : '已经是第一页'} onClick={() => changeHistoryPage(historyPage - 1)}>上一页</Button>
                <span className="min-w-14 px-1 text-center text-[12px] text-ink-secondary">{historyPage + 1} / {Math.max(1, Math.ceil(historyTotal / historyPageSize))}</span>
                <Button size="sm" loading={historyPaging === historyPage + 1} disabled={historyLoading || (historyPage + 1) * historyPageSize >= historyTotal || deciding} disabledReason={historyLoading ? '正在载入' : '已经是最后一页'} onClick={() => changeHistoryPage(historyPage + 1)}>下一页</Button>
                <Button size="sm" loading={historyPaging === Math.max(0, Math.ceil(historyTotal / historyPageSize) - 1)} disabled={historyLoading || (historyPage + 1) * historyPageSize >= historyTotal || deciding} disabledReason={historyLoading ? '正在载入' : '已经是最后一页'} onClick={() => changeHistoryPage(Math.max(0, Math.ceil(historyTotal / historyPageSize) - 1))}>末页</Button>
              </div>
            </div>
            </>}
          </DataCard>
          </div>
          </div>
          {deciding && (
            <div className="absolute inset-0 z-10 flex items-start justify-center rounded-[8px] bg-page/80 pt-32 backdrop-blur-[1px]">
              <div className="rounded-[8px] border border-border bg-surface px-5 py-4 shadow-sm">
                <StageLoader steps={loaderSteps} />
              </div>
            </div>
          )}
        </div>
        {historyDetail && (
          <Modal size="md" scroll="hidden" onClose={() => setHistoryDetail(null)} labelledBy="history-detail-title" className="flex flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
              <h2 id="history-detail-title" className="min-w-0 truncate text-[17px] font-semibold text-ink">历史任务详情</h2>
              <Button size="sm" variant="text" onClick={() => setHistoryDetail(null)} aria-label="关闭历史任务详情">关闭</Button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
              <HistoryDetail item={historyDetail} />
            </div>
            <footer className="flex shrink-0 justify-end border-t border-border-subtle px-4 py-3 sm:px-5">
              <Button size="sm" onClick={() => setHistoryDetail(null)}>关闭</Button>
            </footer>
          </Modal>
        )}
      </PageBody>
    </PageShell>
  )
}

function HistoryDetail({ item }: { item: DecisionHistoryItem }) {
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-ink-muted">{formatLocalTime(item.created_at)} · {item.question_type in TYPE_LABELS ? TYPE_LABELS[item.question_type as QuestionType] : '题型未记录'}</p>
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
        {item.result ? <DecideResultView result={item.result} /> : <Notice tone="danger">{item.error || '任务未完成'}</Notice>}
      </div>
      {item.result && <p className="text-[12px] text-ink-muted">模型 {item.model || '—'} · 耗时 {item.latency_ms}ms</p>}
    </div>
  )
}

