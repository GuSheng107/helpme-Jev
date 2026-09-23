import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  analyze,
  appendMessage,
  clarify,
  draftReplies,
  evaluateReply,
  polish,
  createConversation,
  listConversations,
  listMessages,
  reflect,
  revertReflection,
  type AnalyzeResult,
  type Candidate,
  type ChatMessage,
  type Conversation,
  type Reflection,
} from '../api/chat'
import Button from '../components/Button'
import DecisionPanel from '../components/DecisionPanel'
import Field from '../components/Field'
import { EmptyState, Notice, PageShell } from '../components/layout'

interface Props {
  onOpenSettings: () => void
  onLogout: () => void
}

export default function ChatPage({ onOpenSettings, onLogout }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [role, setRole] = useState<'other' | 'me'>('other')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('女朋友')
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [step, setStep] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const current = conversations.find((item) => item.id === currentId) ?? null

  const reloadList = useCallback(async () => {
    setConversations(await listConversations())
  }, [])

  useEffect(() => {
    void reloadList().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : '聊天列表加载失败')
    })
  }, [reloadList])

  useEffect(() => {
    if (currentId === null) {
      setMessages([])
      return
    }
    void listMessages(currentId)
      .then(setMessages)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '内容加载失败'))
  }, [currentId])

  async function create() {
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const created = await createConversation({
        title: `和${name.trim()}的聊天`,
        counterpart_name: name.trim(),
        relationship: relationship.trim(),
      })
      await reloadList()
      setCurrentId(created.id)
      setCreating(false)
      setName('')
      setListOpen(false)
      setResult(null)
      setReflection(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  async function send() {
    if (currentId === null || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      const message = await appendMessage(currentId, role, draft.trim())
      setMessages((prev) => [...prev, message])
      setDraft('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function review(conversationId: number) {
    try {
      const noted = await reflect(conversationId)
      const kept = noted.changes.some((item) => item.content && !item.skipped && item.op !== 'NOOP')
      if (kept) setReflection(noted)
    } catch {
      /* 记不住不影响这次判断 */
    }
  }

  async function undoReview() {
    if (!reflection) return
    setBusy(true)
    setError(null)
    try {
      setReflection(await revertReflection(reflection.id))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '撤销失败')
    } finally {
      setBusy(false)
    }
  }

  async function judge() {
    if (currentId === null) return
    setBusy(true)
    setError(null)
    setStep('正在分析')
    setCandidates([])
    try {
      const judged = await analyze(currentId)
      setResult(judged)
      setStep('')
      void review(currentId)
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'JEV_NOT_CONFIGURED' || err.code === 'LLM_NOT_CONFIGURED')) {
        setError(`${err.message}`)
      } else {
        setError(err instanceof ApiError ? err.message : '分析失败')
      }
    } finally {
      setBusy(false)
      setStep('')
    }
  }

  async function makeCandidates() {
    if (currentId === null || !result) return
    setBusy(true)
    setError(null)
    setStep('正在生成候选')
    try {
      const drafted = await draftReplies(currentId, result)
      setCandidates(drafted.candidates)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '候选未生成')
    } finally {
      setBusy(false)
      setStep('')
    }
  }

  async function askMore() {
    if (currentId === null) return
    setBusy(true)
    setError(null)
    try {
      const asked = await clarify(currentId)
      setQuestions(asked.questions)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '追问未生成')
    } finally {
      setBusy(false)
    }
  }

  async function polishDraft() {
    if (!draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      setPreviousDraft(draft)
      const polished = await polish(draft, role === 'me' ? 'reply' : 'chat')
      setDraft(polished.text)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '润色未完成')
    } finally {
      setBusy(false)
    }
  }

  async function checkMine() {
    if (currentId === null || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      const verdict = await evaluateReply(currentId, draft.trim())
      setCandidates([{ text: draft.trim(), percent: verdict.percent }])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '评估未完成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col lg:h-screen lg:min-h-0 lg:flex-row">
        <aside
          className={`${listOpen ? 'block' : 'hidden'} border-b border-border bg-surface lg:block lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r`}
        >
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[14px] font-semibold text-ink">聊天</span>
            <Button size="sm" onClick={() => setCreating((value) => !value)}>
              新建
            </Button>
          </div>
          {creating && (
            <div className="space-y-2 px-4 pb-3">
              <Field label="对方" value={name} onChange={(event) => setName(event.target.value)} />
              <Field
                label="关系"
                value={relationship}
                onChange={(event) => setRelationship(event.target.value)}
              />
              <Button variant="primary" size="sm" loading={busy} onClick={() => void create()}>
                创建
              </Button>
            </div>
          )}
          {conversations.length === 0 && !creating ? (
            <EmptyState title="暂无聊天" description="新建一位对象，再粘贴对方发来的内容。" />
          ) : (
            <ul>
              {conversations.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`block w-full px-4 py-2.5 text-left text-[14px] ${
                      item.id === currentId ? 'bg-primary-soft text-primary-hover' : 'text-ink'
                    }`}
                    onClick={() => {
                      setCurrentId(item.id)
                      setResult(null)
                      setReflection(null)
                      setListOpen(false)
                    }}
                  >
                    <span className="block truncate">{item.counterpart_name || item.title}</span>
                    <span className="block truncate text-[12px] text-ink-muted">{item.relationship}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-[52px] items-center justify-between border-b border-border bg-surface px-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-[13px] text-primary lg:hidden"
                onClick={() => setListOpen((value) => !value)}
              >
                聊天
              </button>
              <span className="truncate text-[16px] font-semibold text-ink">
                {current ? current.counterpart_name || current.title : 'HelpMe'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={onOpenSettings}>
                设置
              </Button>
              <Button size="sm" onClick={onLogout}>
                退出
              </Button>
            </div>
          </header>

          {error && (
            <div className="px-4 pt-3">
              <Notice tone="danger">
                {error}
                {(error.includes('设置') || error.includes('接上')) && (
                  <button type="button" className="ml-2 underline" onClick={onOpenSettings}>
                    去设置
                  </button>
                )}
              </Notice>
            </div>
          )}

          {current === null ? (
            <EmptyState title="请选择聊天" description="在左侧新建或打开已有聊天。手机端点击左上角「聊天」。" />
          ) : (
            <>
              {step && <p className="px-4 pt-3 text-[13px] text-ink-muted">{step}</p>}
              {result && <DecisionPanel result={result} />}
              {questions.length > 0 && (
                <div className="mx-4 mt-3 rounded-[8px] border border-border bg-surface px-3 py-2">
                  <p className="text-[13px] text-ink-secondary">还想确认几件事，也可以跳过</p>
                  <ul className="mt-1">
                    {questions.map((item) => (
                      <li key={item} className="text-[14px] leading-[22px] text-ink">{item}</li>
                    ))}
                  </ul>
                  <button type="button" className="mt-1 text-[13px] text-primary" onClick={() => setQuestions([])}>
                    跳过，直接看结果
                  </button>
                </div>
              )}
              {candidates.length > 0 && (
                <ul className="mx-4 mt-3 space-y-2">
                  {candidates.map((item) => (
                    <li key={item.text}>
                      <button
                        type="button"
                        className="w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-left"
                        onClick={() => {
                          setRole('me')
                          setDraft(item.text)
                        }}
                      >
                        <span className="text-[14px] leading-[22px] text-ink">{item.text}</span>
                        <span className="mt-1 block text-[12px] text-ink-muted">匹配度 {item.percent}%</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
                {messages.length === 0 && (
                  <EmptyState title="暂无内容" description="在下方粘贴对方的话，发送者选「对方」，然后保存。" />
                )}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'me' ? 'justify-end' : 'justify-start'}`}
                  >
                    <p
                      className={`max-w-[80%] whitespace-pre-wrap break-words rounded-[12px] px-3 py-2 text-[14px] leading-[22px] ${
                        message.role === 'me'
                          ? 'bg-primary-soft text-ink'
                          : 'border border-border bg-surface text-ink'
                      }`}
                    >
                      {message.content}
                    </p>
                  </div>
                ))}
              </div>
              <div className="sticky bottom-0 border-t border-border bg-surface px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    className={`h-8 rounded-[6px] px-3 text-[13px] ${role === 'other' ? 'bg-primary text-white' : 'border border-border text-ink'}`}
                    onClick={() => setRole('other')}
                  >
                    对方
                  </button>
                  <button
                    type="button"
                    className={`h-8 rounded-[6px] px-3 text-[13px] ${role === 'me' ? 'bg-primary text-white' : 'border border-border text-ink'}`}
                    onClick={() => setRole('me')}
                  >
                    我
                  </button>
                </div>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={2}
                  placeholder="粘贴对方发来的内容"
                  className="w-full resize-none rounded-[6px] border border-border px-3 py-2 text-ink outline-none"
                />
                {reflection && <MemoryNote reflection={reflection} onUndo={() => void undoReview()} />}
                {previousDraft !== null && (
                  <button
                    type="button"
                    className="mt-1 text-[13px] text-primary"
                    onClick={() => {
                      setDraft(previousDraft)
                      setPreviousDraft(null)
                    }}
                  >
                    撤回润色
                  </button>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                  <Button size="sm" loading={busy} disabled={!draft.trim()} disabledReason="请先输入内容" onClick={() => void polishDraft()}>
                    润色
                  </Button>
                  {result && !result.context_sufficient && (
                    <Button size="sm" loading={busy} onClick={() => void askMore()}>
                      继续问
                    </Button>
                  )}
                  {result && (
                    <Button size="sm" loading={busy} onClick={() => void makeCandidates()}>
                      生成候选
                    </Button>
                  )}
                  {role === 'me' && (
                    <Button size="sm" loading={busy} disabled={!draft.trim()} disabledReason="请先写回复" onClick={() => void checkMine()}>
                      评估这句
                    </Button>
                  )}
                  <Button size="sm" loading={busy} disabled={!draft.trim()} disabledReason="请先输入内容" onClick={() => void send()}>
                    保存
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busy}
                    disabled={messages.length === 0}
                    disabledReason="请先保存至少一条内容"
                    onClick={() => void judge()}
                  >
                    分析
                  </Button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </PageShell>
  )
}

function MemoryNote({ reflection, onUndo }: { reflection: Reflection; onUndo: () => void }) {
  const kept = reflection.changes.filter((item) => item.content && !item.skipped && item.op !== 'NOOP')
  if (reflection.reverted_at) {
    return <p className="mt-2 text-[13px] leading-5 text-ink-muted">已撤回刚才的记录</p>
  }
  if (kept.length === 0) {
    return <p className="mt-2 text-[13px] leading-5 text-ink-muted">本次没有新的记录</p>
  }
  return (
    <div className="mt-2 rounded-[6px] bg-surface-muted px-3 py-2">
      <p className="text-[13px] text-ink-secondary">已记录</p>
      <ul className="mt-1 space-y-0.5">
        {kept.map((item, index) => (
          <li key={index} className="text-[13px] leading-5 text-ink">
            {item.content}
          </li>
        ))}
      </ul>
      <button type="button" className="mt-1 text-[13px] text-primary" onClick={onUndo}>
        撤销
      </button>
    </div>
  )
}
