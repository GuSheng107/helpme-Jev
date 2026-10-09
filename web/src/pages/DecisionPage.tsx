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
import Pager from '../components/Pager'
import Segmented from '../components/Segmented'
import StageLoader, { type LoaderStep } from '../components/StageLoader'
import { IconChevronRight, IconClose, IconPlus } from '../components/icons'
import { formatLocalTime } from '../utils/datetime'

const PAGE_SIZES = [20, 50, 100]
// 完成态只停留一瞬间，让「翻译完成」能被看见，随即切到下一步。
const DONE_HOLD_MS = 280

/** 多行文本域统一样式：自动增高、聚焦环形高亮，与 Field 的输入框同一套语言。 */
const AREA =
  'w-full resize-none overflow-hidden rounded-[10px] border border-border bg-surface p-3 ' +
  'text-[14px] leading-[22px] text-ink shadow-xs transition-colors duration-150 ' +
  'placeholder:text-ink-faint hover:border-border-strong ' +
  'focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-ink-muted'

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

  const pageCount = Math.max(1, Math.ceil(historyTotal / historyPageSize))

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
      <PageBody>
        <PageHeader
          title="决策工作台"
          description="把犹豫的事拆成一道题：写清题目与背景，选定题型交给 JEV 判断。"
          actions={
            <Segmented
              value={kind}
              disabled={busy}
              ariaLabel="题型"
              onChange={(next) => {
                setKind(next)
                setAnswer(null)
                setError(null)
                setBeforePolish(null)
              }}
              options={(Object.keys(TYPE_LABELS) as QuestionType[]).map((item) => ({
                value: item,
                label: TYPE_LABELS[item],
              }))}
            />
          }
        />

        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}

        <div className="relative" aria-busy={busy}>
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
            <DataCard
              title="发起判断"
              description={
                kind === 'choice'
                  ? '选择题至少填两个选项，JEV 会给出各选项的相对可能性。'
                  : kind === 'score'
                    ? '评分题结论为 0–10 分。'
                    : '是非题结论为「是 / 否」及对应把握程度。'
              }
              className="lg:sticky lg:top-8"
            >
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary" htmlFor="decide-question">
                  题目
                </label>
                <textarea
                  id="decide-question"
                  ref={questionRef}
                  className={AREA + ' min-h-24'}
                  placeholder={
                    kind === 'noul'
                      ? '例：现在适合跟他提加薪吗？'
                      : kind === 'choice'
                        ? '例：哪个方案更可能让老板满意？'
                        : '例：这次发布的风险有多高？'
                  }
                  value={question}
                  disabled={busy}
                  onChange={(event) => { setQuestion(event.target.value); setBeforePolish(null) }}
                />
              </div>

              {kind === 'choice' && (
                <div className="mt-3 space-y-2">
                  {options.map((option, index) => (
                    <div key={index} className="group/opt flex items-center gap-2">
                      <span
                        className="tnum grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-surface-muted text-[12px] font-semibold text-ink-muted transition-colors duration-150 group-focus-within/opt:bg-primary-soft group-focus-within/opt:text-primary"
                        aria-hidden
                      >
                        {String.fromCharCode(65 + index)}
                      </span>
                      <input
                        className="h-9 min-w-0 flex-1 rounded-[9px] border border-border bg-surface px-3 text-[14px] text-ink shadow-xs transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-surface-muted"
                        disabled={busy}
                        placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                        value={option}
                        aria-label={`选项 ${String.fromCharCode(65 + index)}`}
                        onChange={(event) => {
                          setBeforePolish(null)
                          setOptions((prev) => prev.map((value, i) => i === index ? event.target.value : value))
                        }}
                      />
                      {options.length > 2 && (
                        <button
                          type="button"
                          disabled={busy}
                          aria-label={`删除选项 ${String.fromCharCode(65 + index)}`}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] text-ink-faint transition-colors duration-150 hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => void removeOption(index)}
                        >
                          <IconClose className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                  {options.length < 10 && (
                    <button
                      type="button"
                      disabled={busy}
                      className="inline-flex h-8 items-center gap-1 rounded-[8px] pl-1.5 pr-2.5 text-[13px] font-medium text-primary transition-colors duration-150 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => { setBeforePolish(null); setOptions((prev) => [...prev, '']) }}
                    >
                      <IconPlus className="h-3.5 w-3.5" />
                      添加选项
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3">
                <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary" htmlFor="decide-context">
                  上下文
                  <span className="ml-1 font-normal text-ink-faint">可选</span>
                </label>
                <textarea
                  id="decide-context"
                  ref={contextRef}
                  className={AREA + ' min-h-20'}
                  placeholder="补充与题目相关的背景、已知条件、顾虑"
                  value={context}
                  disabled={busy}
                  onChange={(event) => { setContext(event.target.value); setBeforePolish(null) }}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border-subtle pt-4">
                {beforePolish !== null && (
                  <button
                    type="button"
                    disabled={busy}
                    className="mr-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-ink-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => {
                      setQuestion(beforePolish.question)
                      setOptions(beforePolish.options)
                      setContext(beforePolish.context)
                      setBeforePolish(null)
                    }}
                  >
                    ← 撤回润色
                  </button>
                )}
                <Button
                  size="sm"
                  loading={polishing}
                  disabled={busy || !question.trim()}
                  disabledReason="请先输入题目"
                  onClick={() => void polishForm()}
                >
                  润色题目
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={deciding}
                  disabled={busy || !canSubmit}
                  disabledReason={kind === 'choice' ? '选择题至少两个非空选项' : '请先输入题目'}
                  onClick={() => void run()}
                >
                  交给 JEV 判断
                </Button>
              </div>

              {polishing && (
                <div role="status" className="absolute inset-0 z-10 grid place-items-center rounded-[14px] bg-surface/75 backdrop-blur-[2px]">
                  <div className="rounded-[12px] border border-border bg-surface px-5 py-4 shadow-md">
                    <StageLoader steps={loaderSteps} />
                  </div>
                </div>
              )}
            </DataCard>

            <div className="flex min-w-0 flex-col gap-4">
              <DataCard title="当前结果">
                {answer ? (
                  <div className="animate-rise">
                    <DecideResultView result={answer.result} />
                    <p className="tnum mt-4 border-t border-border-subtle pt-3 text-[12px] text-ink-muted">
                      模型 {answer.model || '—'} · 耗时 {answer.latency_ms}ms
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-2 py-7 text-center">
                    <span className="grid h-10 w-10 place-items-center rounded-[12px] border border-border bg-surface-muted text-ink-faint">
                      <IconChevronRight className="h-5 w-5" />
                    </span>
                    <p className="text-[13px] text-ink-secondary">还没提交判断</p>
                    <p className="max-w-xs text-[12px] leading-5 text-ink-muted">
                      填好左侧的题目，点「交给 JEV 判断」，结果会显示在这里。
                    </p>
                  </div>
                )}
              </DataCard>

              <DataCard
                title="历史任务"
                description={
                  historyDetail ? '正在查看某一条历史记录' : `仅保留近 ${historyRetention} 天 · 共 ${historyTotal} 条`
                }
                bodyClassName={historyDetail ? '' : 'p-0'}
              >
                {historyDetail ? (
                  <HistoryDetail item={historyDetail} />
                ) : (
                  <>
                    {historyError && <div className="p-5"><Notice tone="danger">{historyError}</Notice></div>}
                    {historyLoading && history.length === 0 ? (
                      <ul className="divide-y divide-border-subtle p-5">
                        {[0, 1, 2].map((row) => (
                          <li key={row} className="py-2.5">
                            <span className="skeleton block h-4 w-2/3" />
                          </li>
                        ))}
                      </ul>
                    ) : history.length === 0 ? (
                      <p className="px-5 py-8 text-center text-[13px] text-ink-muted">
                        近 {historyRetention} 天没有决策任务
                      </p>
                    ) : (
                      <ul className="divide-y divide-border-subtle">
                        {history.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              className="group/hist flex w-full items-center gap-3 px-5 py-3 text-left transition-colors duration-150 hover:bg-surface-hover"
                              onClick={() => setHistoryDetail(item)}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium text-ink" title={item.question || undefined}>
                                  {item.question || '旧日志未记录原题'}
                                </span>
                                <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
                                  <span className="rounded-[6px] bg-surface-sunken px-1.5 py-px">
                                    {item.question_type in TYPE_LABELS
                                      ? TYPE_LABELS[item.question_type as QuestionType]
                                      : '题型未记录'}
                                  </span>
                                  <span className={item.status === 'success' ? 'text-success' : 'text-danger'}>
                                    {item.status === 'success' ? '完成' : '失败'}
                                  </span>
                                  <time className="tnum">{formatLocalTime(item.created_at)}</time>
                                </span>
                              </span>
                              <IconChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover/hist:translate-x-0.5 group-hover/hist:text-ink-secondary" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
                      <label className="flex items-center gap-2 text-[12px] text-ink-secondary">
                        每页
                        <select
                          className="h-8 rounded-[8px] border border-border bg-surface px-2 text-[13px] text-ink transition-colors duration-150 hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                          disabled={historyLoading}
                          value={historyPageSize}
                          onChange={(event) => changeHistoryPageSize(Number(event.target.value))}
                        >
                          {PAGE_SIZES.map((size) => <option key={size} value={size}>{size} 条</option>)}
                        </select>
                      </label>
                      <Pager
                        page={historyPage + 1}
                        pageCount={pageCount}
                        pending={historyPaging === null ? null : historyPaging + 1}
                        disabled={historyLoading}
                        disabledReason={historyLoading ? '正在载入' : undefined}
                        onChange={(next) => changeHistoryPage(next - 1)}
                      />
                    </div>
                  </>
                )}
              </DataCard>
            </div>
          </div>

          {deciding && (
            <div className="absolute inset-0 z-10 grid place-items-start justify-items-center rounded-[14px] bg-canvas/75 pt-32 backdrop-blur-[2px]">
              <div className="rounded-[12px] border border-border bg-surface px-5 py-4 shadow-md">
                <StageLoader steps={loaderSteps} />
              </div>
            </div>
          )}
        </div>
      </PageBody>

      {historyDetail && (
        <Modal size="md" scroll="hidden" onClose={() => setHistoryDetail(null)} labelledBy="history-detail-title" className="flex flex-col">
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
            <h2 id="history-detail-title" className="min-w-0 truncate text-[16px] font-semibold tracking-tight text-ink">
              历史任务详情
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setHistoryDetail(null)} aria-label="关闭历史任务详情">
              关闭
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <HistoryDetail item={historyDetail} />
          </div>
          <footer className="flex shrink-0 justify-end border-t border-border-subtle px-5 py-3">
            <Button size="sm" onClick={() => setHistoryDetail(null)}>关闭</Button>
          </footer>
        </Modal>
      )}
    </PageShell>
  )
}

function HistoryDetail({ item }: { item: DecisionHistoryItem }) {
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
        <span className="rounded-[6px] bg-surface-sunken px-1.5 py-px text-ink-secondary">
          {item.question_type in TYPE_LABELS
            ? TYPE_LABELS[item.question_type as QuestionType]
            : '题型未记录'}
        </span>
        <time className="tnum">{formatLocalTime(item.created_at)}</time>
      </p>
      <div>
        <p className="mb-1 text-[11px] font-semibold tracking-[0.12em] text-ink-faint">题目</p>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-6 text-ink">
          {item.question || '旧日志未记录原题'}
        </p>
      </div>
      {item.options.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-faint">选项</p>
          <ul className="space-y-1">
            {item.options.map((option, index) => (
              <li key={index} className="flex gap-2 text-[13px] leading-5 text-ink-secondary">
                <span className="tnum shrink-0 font-medium text-ink-muted">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="min-w-0 break-words">{option}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {item.context && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-faint">上下文</p>
          <p className="whitespace-pre-wrap break-words rounded-[10px] bg-surface-muted p-3 text-[13px] leading-6 text-ink-secondary">
            {item.context}
          </p>
        </div>
      )}
      <div className="border-t border-border-subtle pt-4">
        {item.result
          ? <DecideResultView result={item.result} />
          : <Notice tone="danger">{item.error || '任务未完成'}</Notice>}
      </div>
      {item.result && (
        <p className="tnum text-[12px] text-ink-muted">
          模型 {item.model || '—'} · 耗时 {item.latency_ms}ms
        </p>
      )}
    </div>
  )
}
