import { useMemo, useRef, useState } from 'react'
import type { ChatMessage, Conversation } from '../api/chat'
import { ApiError } from '../api/client'
import { decide, type DecideResponse, type QuestionType } from '../api/decide'
import Button from './Button'
import DecideResultView, { DECIDE_TYPE_LABELS } from './DecideResultView'
import { Notice } from './layout'
import Modal from './Modal'
import StageLoader, { type LoaderStep } from './StageLoader'

// 与后端 DecideRequest.context 的 max_length=2000 对齐：自动带入时从最新消息往回收，
// 装不下的更早记录整条丢弃，绝不超限。
const CONTEXT_LIMIT = 2000

// 完成态停留一瞬，让「决策完成」能被看见（与决策工作台一致）
const DONE_HOLD_MS = 280

type StepKey = 'translate' | 'decide'
const STEP_LABELS: Record<StepKey, { running: string; done: string }> = {
  translate: { running: '翻译中', done: '翻译完成' },
  decide: { running: '决策中', done: '决策完成' },
}

function holdDone(): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, DONE_HOLD_MS) })
}

/** 只取当前会话的记录拼上下文：从最新往回收，超出预算的更早整条丢掉。 */
export function buildChatContext(conversation: Conversation, messages: ChatMessage[]): {
  text: string
  count: number
} {
  const lines: string[] = []
  let used = 0
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const who = message.role === 'me'
      ? '我'
      : conversation.is_group
        ? conversation.members.find((member) => member.key === message.speaker)?.name ?? '对方'
        : '对方'
    const text = (message.content || '').trim() || (message.attachments.length > 0 ? '[图片]' : '')
    if (!text) continue
    const line = `${who}：${text}`
    const extra = line.length + (lines.length > 0 ? 1 : 0)
    if (used + extra > CONTEXT_LIMIT) break
    lines.push(line)
    used += extra
  }
  return { text: lines.reverse().join('\n'), count: lines.length }
}

interface Props {
  conversation: Conversation
  messages: ChatMessage[]
  /** 自动翻译开关：关闭时中文直通 JEV，loading 里不出现翻译一步 */
  autoTranslate: boolean
  onClose: () => void
}

/** 聊天页里的决策小组件：题面手填，上下文一键带入**当前聊天**的记录，走同一条判断链路。 */
export default function QuickDecide({ conversation, messages, autoTranslate, onClose }: Props) {
  const [kind, setKind] = useState<QuestionType>('noul')
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [context, setContext] = useState('')
  // 自动带入的记录条数（0 = 当前聊天还没有可带的文字记录）
  const auto = useMemo(() => buildChatContext(conversation, messages), [conversation, messages])
  const [answer, setAnswer] = useState<DecideResponse | null>(null)
  const [deciding, setDeciding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<StepKey[]>([])
  const [progress, setProgress] = useState(0)
  const resultRef = useRef<HTMLDivElement>(null)

  const filledOptions = options.map((item) => item.trim()).filter(Boolean)
  const canSubmit = question.trim().length > 0 && (kind !== 'choice' || filledOptions.length >= 2)
  const loaderSteps: LoaderStep[] = plan.map((key, index) => ({
    key,
    ...STEP_LABELS[key],
    state: index < progress ? 'done' : index === progress ? 'running' : 'pending',
  }))

  function bringChatRecords() {
    setContext(auto.text)
  }

  async function run() {
    if (deciding || !canSubmit) return
    setAnswer(null)
    setDeciding(true)
    setError(null)
    // 与工作台一致：点击后先按输入猜步骤，服务端 plan 事件再对齐
    const ascii = /^[\x00-\x7F]*$/.test(`${question}${context}${filledOptions.join('')}`)
    setPlan(ascii || !autoTranslate ? ['decide'] : ['translate', 'decide'])
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
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '判断未完成')
    } finally {
      setDeciding(false)
      setPlan([])
      setProgress(0)
    }
  }

  return (
    <Modal size="md" onClose={onClose} ariaLabel="快速决策" initialFocusSelector="[data-autofocus]">
      <div className="relative flex max-h-[calc(100dvh-2rem)] flex-col" aria-busy={deciding}>
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-ink">快速决策</h2>
            <p className="truncate text-[12px] text-ink-muted">{conversation.counterpart_name || conversation.title}</p>
          </div>
          <Button size="sm" variant="text" onClick={onClose} aria-label="关闭快速决策">关闭</Button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <div role="tablist" aria-label="题型" className="flex rounded-[6px] border border-border p-0.5">
            {(Object.keys(DECIDE_TYPE_LABELS) as QuestionType[]).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={kind === item} disabled={deciding}
                className={`min-w-0 flex-1 rounded-[4px] px-2 py-1.5 text-[13px] ${kind === item ? 'bg-primary text-white' : 'text-ink-secondary hover:bg-surface-muted'}`}
                onClick={() => { setKind(item); setAnswer(null); setError(null) }}>
                {DECIDE_TYPE_LABELS[item]}
              </button>
            ))}
          </div>
          <textarea
            data-autofocus
            className="min-h-20 w-full resize-none overflow-hidden rounded-[6px] border border-border bg-surface p-3 text-[14px] text-ink disabled:opacity-65"
            placeholder={kind === 'noul' ? '例：现在适合回他消息吗？' : kind === 'choice' ? '例：先道歉还是先讲道理？' : '例：这条消息的敌意有多强？'}
            value={question} disabled={deciding}
            onChange={(event) => setQuestion(event.target.value)}
          />
          {kind === 'choice' && (
            <div className="space-y-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-[13px] text-ink-muted">{String.fromCharCode(65 + index)}</span>
                  <input className="min-w-0 flex-1 rounded-[6px] border border-border bg-surface px-3 py-2 text-[14px]" disabled={deciding}
                    placeholder={`选项 ${String.fromCharCode(65 + index)}`} value={option}
                    onChange={(event) => setOptions((prev) => prev.map((value, i) => i === index ? event.target.value : value))} />
                  {options.length > 2 && (
                    <button type="button" disabled={deciding} aria-label={`删除选项 ${String.fromCharCode(65 + index)}`}
                      className="shrink-0 text-[13px] text-ink-muted hover:text-danger disabled:opacity-50"
                      onClick={() => setOptions((prev) => prev.filter((_, position) => position !== index))}>删除</button>
                  )}
                </div>
              ))}
              {options.length < 10 && (
                <button type="button" disabled={deciding} className="text-[13px] text-primary disabled:opacity-50"
                  onClick={() => setOptions((prev) => [...prev, ''])}>+ 添加选项</button>
              )}
            </div>
          )}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-muted">上下文（可选）</span>
              <div className="flex items-center gap-2">
                {auto.count > 0 && (
                  <span className="text-[12px] text-ink-muted">当前聊天共可带入 {auto.count} 条</span>
                )}
                <button type="button" disabled={deciding} className="text-[12px] text-primary disabled:opacity-50"
                  onClick={bringChatRecords}>
                  {context.trim() ? '重新带入聊天记录' : '带入聊天记录'}
                </button>
              </div>
            </div>
            <textarea
              className="min-h-20 w-full resize-none overflow-hidden rounded-[6px] border border-border bg-surface p-3 text-[13px] text-ink disabled:opacity-65"
              placeholder="点上方「带入聊天记录」，只取当前聊天的记录；也可以自己写"
              value={context} disabled={deciding}
              onChange={(event) => setContext(event.target.value)}
            />
            {context.trim() && context.trim().length !== auto.text.length && auto.count > 0 && (
              <p className="mt-1 text-[12px] text-ink-muted">上下文已被手动改过，判断用的是这里的内容</p>
            )}
          </div>
          {kind === 'score' && (
            <p className="text-[12px] text-ink-muted">评分显示为 0–10 分；Jev 按 10 个档位判断，结果会等比例换算并保留两位小数。</p>
          )}
          {answer && (
            <div ref={resultRef} className="rounded-[8px] border border-border bg-surface px-3 py-3">
              <p className="mb-2 text-[12px] font-medium text-ink-secondary">判断结果</p>
              <DecideResultView result={answer.result} />
              <p className="mt-3 text-[12px] text-ink-muted">模型 {answer.model || '—'} · 耗时 {answer.latency_ms}ms</p>
            </div>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-4 py-3">
          {answer && (
            <Button size="sm" variant="text" disabled={deciding} onClick={() => setAnswer(null)}>再来一题</Button>
          )}
          <Button variant="primary" size="sm" loading={deciding} disabled={!canSubmit}
            disabledReason={kind === 'choice' ? '选择题至少两个非空选项' : '请先输入问题'} onClick={() => void run()}>判断</Button>
        </footer>
        {deciding && (
          <div role="status" className="absolute inset-0 z-10 flex items-center justify-center rounded-[20px] bg-white/75 backdrop-blur-[1px]">
            <div className="rounded-[8px] border border-border bg-surface px-5 py-4 shadow-sm">
              <StageLoader steps={loaderSteps} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
