import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  analyze,
  appendMessage,
  clarify,
  defaultLlmSupportsVision,
  draftReplies,
  explainDecision,
  evaluateReply,
  fetchMaterialFile,
  polish,
  createConversation,
  listConversations,
  listMessages,
  listScenarios,
  reflect,
  revertReflection,
  uploadImage,
  type AnalyzeResult,
  type Candidate,
  type ChatMessage,
  type Conversation,
  type Reflection,
  type Scenario,
} from '../api/chat'
import Button from '../components/Button'
import DecisionPanel from '../components/DecisionPanel'
import Field from '../components/Field'
import { EmptyState, Notice } from '../components/layout'
import Modal from '../components/Modal'

interface Props {
  currentId: number | null
  setCurrentId: (id: number | null) => void
  onOpenSettings: () => void
}

/** 我方消息的来源徽标：manual 不标（默认就是自己写的），标出来的是特殊的 */
const SOURCE_BADGES: Partial<Record<ChatMessage['source'], string>> = {
  candidate: '采用推荐',
  rewrite: '改写推荐',
  import: '导入',
}

/** 输入框里一张待发送的图（已上传，objectURL 供预览） */
interface PendingImage {
  materialId: number
  url: string
}

/** 一条消息最多带的图片数 */
const MAX_IMAGES = 9

export default function ChatPage({ currentId, setCurrentId, onOpenSettings }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [role, setRole] = useState<'other' | 'me'>('other')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState<number | null>(null)
  const [result, setResult] = useState<AnalyzeResult | null>(null)
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [step, setStep] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [questions, setQuestions] = useState<string[]>([])
  const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [pickedText, setPickedText] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [images, setImages] = useState<PendingImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [visionReady, setVisionReady] = useState<boolean | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const current = conversations.find((item) => item.id === currentId) ?? null

  const reloadList = useCallback(async () => {
    setConversations(await listConversations())
  }, [])

  useEffect(() => {
    void reloadList().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : '聊天列表加载失败')
    })
    listScenarios()
      .then((rows) => {
        setScenarios(rows)
        setScenarioId(rows[0]?.id ?? null)
      })
      .catch(() => undefined)
    void defaultLlmSupportsVision().then(setVisionReady)
  }, [reloadList])

  useEffect(() => {
    if (currentId === null) {
      setMessages([])
      return
    }
    setImages((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.url))
      return []
    })
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
        scenario_id: scenarioId,
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

  async function addImages(files: File[]) {
    if (currentId === null) return
    const images_ = files.filter((file) => file.type.startsWith('image/'))
    if (images_.length === 0) return
    if (visionReady === false) {
      setError('当前默认语言模型不支持看图。可在设置里换用支持视觉的模型后再贴图。')
      return
    }
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setError(`一条消息最多带 ${MAX_IMAGES} 张图`)
      return
    }
    const accepted = images_.slice(0, room)
    if (accepted.length < images_.length) setError(`一条消息最多带 ${MAX_IMAGES} 张图，多余的已忽略`)
    setUploading(true)
    setError(null)
    try {
      for (const file of accepted) {
        const saved = await uploadImage(currentId, file)
        setImages((prev) => [...prev, { materialId: saved.id, url: URL.createObjectURL(file) }])
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '图片上传未完成')
    } finally {
      setUploading(false)
    }
  }

  function onPaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    event.preventDefault()
    void addImages(files)
  }

  function removeImage(materialId: number) {
    setImages((prev) => {
      const target = prev.find((item) => item.materialId === materialId)
      if (target) URL.revokeObjectURL(target.url)
      return prev.filter((item) => item.materialId !== materialId)
    })
  }

  async function send() {
    if (currentId === null || (!draft.trim() && images.length === 0)) return
    setBusy(true)
    setError(null)
    try {
      const source =
        role === 'me' && pickedText !== null
          ? draft.trim() === pickedText
            ? 'candidate'
            : 'rewrite'
          : 'manual'
      const message = await appendMessage(
        currentId,
        role,
        draft.trim(),
        source,
        images.map((item) => item.materialId),
      )
      setPickedText(null)
      setMessages((prev) => [...prev, message])
      setDraft('')
      setImages((prev) => {
        prev.forEach((item) => URL.revokeObjectURL(item.url))
        return []
      })
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

  async function explain() {
    if (currentId === null || !result) return
    setBusy(true)
    setError(null)
    try {
      const explained = await explainDecision(currentId, result)
      setReason(explained.reason)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '说明未生成')
    } finally {
      setBusy(false)
    }
  }

  async function makeCandidates() {
    if (currentId === null || !result || result.high_danger) return
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
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
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
              <div>
                <span className="mb-1 block text-[12px] text-ink-muted">场景</span>
                <select
                  className="w-full rounded-[6px] border border-border px-2 py-1.5 text-[14px] text-ink"
                  value={scenarioId ?? ''}
                  onChange={(event) =>
                    setScenarioId(event.target.value === '' ? null : Number(event.target.value))
                  }
                >
                  <optgroup label="系统内置">
                    {scenarios.filter((item) => item.is_builtin).map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </optgroup>
                  {scenarios.some((item) => !item.is_builtin) && (
                    <optgroup label="我的场景">
                      {scenarios.filter((item) => !item.is_builtin).map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <Field
                label="关系（可选，如 同事 / 恋人 / 客户）"
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
                      setPickedText(null)
                      setListOpen(false)
                    }}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="truncate">{item.counterpart_name || item.title}</span>
                      {item.scenario_kind === 'workplace' && (
                        <span className="shrink-0 rounded-[4px] bg-surface-muted px-1 text-[11px] text-ink-muted">职场</span>
                      )}
                      {item.scenario_kind === 'custom' && (
                        <span className="shrink-0 rounded-[4px] bg-surface-muted px-1 text-[11px] text-ink-muted">自定义</span>
                      )}
                    </span>
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
              {result && <DecisionPanel result={result} scenarioKind={current?.scenario_kind ?? 'romance'} />}
              {result && (
                <div className="mx-4 mt-3">
                  <button type="button" className="text-[13px] text-primary" onClick={() => void explain()}>
                    为什么这么判
                  </button>
                  {reason && (
                    <p className="mt-1 text-[13px] leading-[22px] text-ink-secondary">
                      {reason}
                      <span className="text-ink-muted">（由语言模型解读，仅供参考）</span>
                    </p>
                  )}
                </div>
              )}
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
                          setPickedText(item.text)
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
                {messages.map((message) => {
                  const badge = message.role === 'me' ? SOURCE_BADGES[message.source] : undefined
                  const imageAttachments = (message.attachments ?? []).filter(
                    (item) => item.type === 'image',
                  )
                  return (
                    <div
                      key={message.id}
                      className={`flex flex-col ${message.role === 'me' ? 'items-end' : 'items-start'}`}
                    >
                      {message.content && (
                        <p
                          className={`max-w-[80%] whitespace-pre-wrap break-words rounded-[12px] px-3 py-2 text-[14px] leading-[22px] ${
                            message.role === 'me'
                              ? 'bg-primary-soft text-ink'
                              : 'border border-border bg-surface text-ink'
                          }`}
                        >
                          {message.content}
                        </p>
                      )}
                      {imageAttachments.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {imageAttachments.map((attachment) => (
                            <AttachmentThumb
                              key={attachment.id}
                              materialId={attachment.id}
                              onOpen={(url) => setLightbox(url)}
                            />
                          ))}
                        </div>
                      )}
                      {badge && (
                        <span className="mt-0.5 text-[11px] text-ink-muted">{badge}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="sticky bottom-0 border-t border-border bg-surface px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
                <div className="mb-2 flex gap-2">
                  <button
                    type="button"
                    className={`h-8 rounded-[6px] px-3 text-[13px] ${role === 'other' ? 'bg-primary text-white' : 'border border-border text-ink'}`}
                    onClick={() => {
                      setRole('other')
                      // 切去保存对方消息时，候选已不适用，清掉免得误记为「改写」
                      setPickedText(null)
                    }}
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
                {role === 'me' && pickedText !== null && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-[6px] bg-primary-soft px-3 py-1.5">
                    <p className="text-[12px] leading-5 text-ink-secondary">
                      {draft.trim() === pickedText
                        ? '已选用候选，原样发送将记录为「采用推荐」'
                        : '候选已被改动，发送将记录为「改写推荐」'}
                    </p>
                    <button
                      type="button"
                      className="shrink-0 text-[12px] text-primary"
                      onClick={() => setPickedText(null)}
                    >
                      按自己写的算
                    </button>
                  </div>
                )}
                {images.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {images.map((item) => (
                      <div key={item.materialId} className="relative">
                        <button
                          type="button"
                          className="block h-16 w-16 overflow-hidden rounded-[8px] border border-border"
                          onClick={() => setLightbox(item.url)}
                          aria-label="查看大图"
                        >
                          <img src={item.url} alt="" className="h-full w-full object-cover" />
                        </button>
                        <button
                          type="button"
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[12px] leading-none text-white"
                          onClick={() => removeImage(item.materialId)}
                          aria-label="移除这张图"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <span className="self-end text-[11px] text-ink-muted">
                      {images.length}/{MAX_IMAGES}
                    </span>
                  </div>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={onPaste}
                  rows={2}
                  placeholder={
                    visionReady === false
                      ? role === 'other'
                        ? '粘贴对方发来的内容（当前模型不支持看图，图片无法添加）'
                        : '写下你要回复的话'
                      : role === 'other'
                        ? '粘贴对方发来的内容，也可以直接贴聊天截图'
                        : '写下你要回复的话'
                  }
                  className="w-full resize-none rounded-[6px] border border-border px-3 py-2 text-ink outline-none"
                />
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    void addImages(files)
                  }}
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
                  <Button
                    size="sm"
                    loading={uploading}
                    disabled={visionReady === false}
                    disabledReason="当前默认模型不支持看图"
                    onClick={() => fileInput.current?.click()}
                  >
                    图片
                  </Button>
                  <Button size="sm" loading={busy} disabled={!draft.trim()} disabledReason="请先输入内容" onClick={() => void polishDraft()}>
                    润色
                  </Button>
                  {result && !result.context_sufficient && (
                    <Button size="sm" loading={busy} onClick={() => void askMore()}>
                      继续问
                    </Button>
                  )}
                  {result && !result.high_danger && (
                    <Button size="sm" loading={busy} onClick={() => void makeCandidates()}>
                      生成候选
                    </Button>
                  )}
                  {role === 'me' && (
                    <Button size="sm" loading={busy} disabled={!draft.trim()} disabledReason="请先写回复" onClick={() => void checkMine()}>
                      评估这句
                    </Button>
                  )}
                  <Button size="sm" loading={busy} disabled={!draft.trim() && images.length === 0} disabledReason="请先输入内容或贴图" onClick={() => void send()}>
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
      {lightbox !== null && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  )
}

/** 消息里的图片缩略图：懒加载原图（带鉴权），点击放大。 */
function AttachmentThumb({
  materialId,
  onOpen,
}: {
  materialId: number
  onOpen: (url: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let alive = true
    fetchMaterialFile(materialId)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (alive) setUrl(objectUrl)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [materialId])

  return (
    <button
      type="button"
      className="block h-16 w-16 overflow-hidden rounded-[8px] border border-border bg-surface-muted"
      onClick={() => url && onOpen(url)}
      aria-label="查看大图"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-[11px] text-ink-muted">
          加载中
        </span>
      )}
    </button>
  )
}

/** 大图查看：沿用全站弹窗的遮罩与键盘行为。 */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <Modal size="full" surface="media" scroll="visible" ariaLabel="图片预览" overlayClassName="bg-black/80" onClose={onClose}>
      <img
        src={url}
        alt=""
        className="max-h-[85vh] max-w-full rounded-[8px] object-contain"
      />
      <button
        type="button"
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[18px] leading-none text-ink"
        onClick={onClose}
        aria-label="关闭"
      >
        ×
      </button>
    </Modal>
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
