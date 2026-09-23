import { useState } from 'react'
import { ApiError } from '../api/client'
import { decide, type DecideResponse, type QuestionType } from '../api/decide'
import { polish } from '../api/chat'
import Button from '../components/Button'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell } from '../components/layout'

const TYPE_LABELS: Record<QuestionType, string> = {
  noul: '是非题',
  choice: '选择题',
  score: '评分题',
}

interface Props {
  onBack: () => void
}

export default function DecisionPage({ onBack }: Props) {
  const [kind, setKind] = useState<QuestionType>('choice')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [context, setContext] = useState('')
  const [answer, setAnswer] = useState<DecideResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [polished, setPolished] = useState<string | null>(null)

  const filledOptions = options.map((item) => item.trim()).filter(Boolean)
  const canSubmit =
    question.trim().length > 0 && (kind !== 'choice' || filledOptions.length >= 2)

  async function run() {
    setBusy(true)
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
      setBusy(false)
    }
  }

  async function polishQuestion() {
    if (!question.trim()) return
    setBusy(true)
    setError(null)
    try {
      setPolished(question)
      const result = await polish(question.trim(), 'question')
      setQuestion(result.text)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '润色未完成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="决策工作台"
          description="自由编一道题：是非、选项或评分，交给 Jev 判断。"
          actions={<Button onClick={onBack}>返回</Button>}
        />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="space-y-4">
          <DataCard title="题目">
            <div className="mb-3 flex rounded-[6px] border border-border p-0.5">
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`flex-1 rounded-[4px] px-2 py-1 text-[13px] ${
                    kind === item ? 'bg-primary text-white' : 'text-ink-secondary'
                  }`}
                  onClick={() => setKind(item)}
                >
                  {TYPE_LABELS[item]}
                </button>
              ))}
            </div>
            <textarea
              className="min-h-20 w-full rounded-[6px] border border-border p-2 text-[14px]"
              placeholder={
                kind === 'noul'
                  ? '例：现在适合跟他提加薪吗？'
                  : kind === 'choice'
                    ? '例：这两个方案哪个更可能让老板满意？'
                    : '例：这次发布会翻车的风险有多大？'
              }
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
            />
            {kind === 'choice' && (
              <div className="mt-2 space-y-2">
                {options.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-[13px] text-ink-muted">
                      {String.fromCharCode(65 + index)}
                    </span>
                    <input
                      className="flex-1 rounded-[6px] border border-border px-2 py-1.5 text-[14px]"
                      placeholder={`选项 ${String.fromCharCode(65 + index)}`}
                      value={option}
                      onChange={(event) =>
                        setOptions((prev) =>
                          prev.map((item, i) => (i === index ? event.target.value : item)),
                        )
                      }
                    />
                    {options.length > 2 && (
                      <button
                        type="button"
                        className="shrink-0 text-[13px] text-ink-muted hover:text-danger"
                        onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                      >
                        删除
                      </button>
                    )}
                  </div>
                ))}
                {options.length < 10 && (
                  <button
                    type="button"
                    className="text-[13px] text-primary"
                    onClick={() => setOptions((prev) => [...prev, ''])}
                  >
                    + 添加选项
                  </button>
                )}
              </div>
            )}
            <div className="mt-3">
              <span className="mb-1 block text-[12px] text-ink-muted">上下文（可选）</span>
              <textarea
                className="min-h-16 w-full rounded-[6px] border border-border p-2 text-[14px]"
                placeholder="补充背景，判断会更准"
                value={context}
                onChange={(event) => setContext(event.target.value)}
              />
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {polished !== null && (
                <button
                  type="button"
                  className="mr-auto text-[13px] text-primary"
                  onClick={() => {
                    setQuestion(polished)
                    setPolished(null)
                  }}
                >
                  撤回润色
                </button>
              )}
              <Button size="sm" loading={busy} disabled={!question.trim()} disabledReason="请先输入问题" onClick={() => void polishQuestion()}>
                润色
              </Button>
              <Button variant="primary" size="sm" loading={busy} disabled={!canSubmit} disabledReason={kind === 'choice' ? '选择题至少两个非空选项' : '请先输入问题'} onClick={() => void run()}>
                判断
              </Button>
            </div>
          </DataCard>

          {answer === null ? (
            <EmptyState
              title="还没有判断"
              description="编好题目后点「判断」，结果会画成概率条或刻度条。"
            />
          ) : (
            <DataCard title="结果">
              <ResultView answer={answer} />
              <p className="mt-3 text-[12px] text-ink-muted">
                模型 {answer.model || '—'} · 耗时 {answer.latency_ms}ms · 追踪 {answer.trace_id.slice(0, 8)}
              </p>
              <p className="mt-1 text-[12px] text-ink-muted">人工智能会出错，关键信息请仔细甄别。</p>
            </DataCard>
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}

function ResultView({ answer }: { answer: DecideResponse }) {
  const result = answer.result
  if (result.kind === 'noul') {
    const percent = result.percent ?? 0
    return (
      <div>
        <div className="flex items-baseline justify-between">
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
        <p className="text-[13px] text-ink-secondary">
          最可能：<span className="text-[14px] font-medium text-ink">{result.top ?? '—'}</span>
        </p>
        <ul className="mt-2 space-y-1.5">
          {bars.map((bar) => (
            <li key={bar.key} className="flex items-center gap-2">
              <span className="w-36 shrink-0 truncate text-[13px] text-ink-secondary">{bar.label}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%` }}
                />
              </span>
              <span className="w-10 text-right text-[12px] text-ink-muted">
                {Math.round(Math.max(0, Math.min(1, bar.value)) * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  const max = result.scale_max ?? 9
  const value = result.value ?? 0
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[13px] text-ink-secondary">评分</span>
        <span className="mono text-[18px] font-medium text-ink">{result.text}</span>
      </div>
      <div className="flex gap-0.5" aria-label={`评分 ${result.text}`}>
        {Array.from({ length: max + 1 }, (_, index) => (
          <span
            key={index}
            className={`h-2.5 flex-1 rounded-[2px] ${index <= value ? 'bg-primary' : 'bg-border-subtle'}`}
          />
        ))}
      </div>
    </div>
  )
}
