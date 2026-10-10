import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  analyze,
  appendMessage,
  defaultLlmSupportsVision,
  explainDecision,
  fetchMaterialFile,
  polish,
  createConversation,
  listConversations,
  listMessages,
  reflect,
  replyStream,
  revertReflection,
  uploadImage,
  type ChatMessage,
  type Conversation,
  type Reflection,
} from '../api/chat'
import Button from '../components/Button'
import MessageReport, { type ReportEntry } from '../components/MessageReport'
import { controlClass } from '../components/Field'
import { EmptyState, Notice } from '../components/layout'
import Modal from '../components/Modal'
import ReplyFloat, { type ReplyCard } from '../components/ReplyFloat'
import Segmented from '../components/Segmented'
import { listProfiles, type PersonaProfileView } from '../api/personas'
import {
  IconChat,
  IconCheck,
  IconChevronDown,
  IconClose,
  IconPlus,
  IconRefresh,
  IconSparkle,
  IconUpload,
  IconWarning,
} from '../components/icons'
import { contextLabelOf } from '../data/personaCatalog'

interface Props {
  currentId: number | null
  setCurrentId: (id: number | null) => void
  onOpenSettings: () => void
  /** 自动翻译开关：关闭时回复管线 loading 里不出现「解读来话」一步 */
  autoTranslate: boolean
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

/** 行内文字按钮：用于「为什么这么判」这类次要动作，不抢主按钮的注意力。 */
const LINK_CHIP =
  'inline-flex items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[13px] font-medium ' +
  'text-primary transition-colors duration-150 hover:bg-primary-soft'

/**
 * 分析报告的登录会话级缓存：按来话消息 id 存。
 * 聊天页切走再切回仍在，刷新页面才清空。
 */
const reportCache = new Map<number, ReportEntry>()

export default function ChatPage({ currentId, setCurrentId, onOpenSettings, autoTranslate }: Props) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [role, setRole] = useState<'other' | 'me'>('other')
  const [creating, setCreating] = useState(false)
  const [groupMode, setGroupMode] = useState(false)
  const [speakerKey, setSpeakerKey] = useState('')
  const [profiles, setProfiles] = useState<PersonaProfileView[]>([])
  const [soloProfileId, setSoloProfileId] = useState<number | null>(null)
  const [memberProfileIds, setMemberProfileIds] = useState<number[]>([])
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [previousDraft, setPreviousDraft] = useState<string | null>(null)
  const [pickedText, setPickedText] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [images, setImages] = useState<PendingImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [visionReady, setVisionReady] = useState<boolean | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  /** 群聊时手动「帮我回复」选的对象成员 key（自动触发走消息里的发言成员） */
  const [replyTarget, setReplyTarget] = useState('')
  /** 帮我回复管线：每个会话只留最新一份，浮在回复框上方（内存级，刷新页面即清） */
  const [replyByConv, setReplyByConv] = useState<Record<number, ReplyCard | null>>({})
  /** 分析报告：按来话消息 id 存，登录会话内可见（写入 reportCache） */
  const [reports, setReports] = useState<Record<number, ReportEntry>>({})
  /** 报告展开状态的用户覆盖：不设时「最新一条来话的报告」默认展开 */
  const [reportOpenOverrides, setReportOpenOverrides] = useState<Record<number, boolean>>({})
  const streamRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  // 聊天页内嵌人设速览：默认折叠，点头部「人设」切换
  const [personaOpen, setPersonaOpen] = useState(false)

  const current = conversations.find((item) => item.id === currentId) ?? null
  const chosenSoloProfile = profiles.find((item) => item.id === soloProfileId) ?? null
  /** 当前会话的帮我回复浮层 */
  const replyWork = currentId !== null ? replyByConv[currentId] ?? null : null
  /** 最近一条带报告的来话：它的报告默认展开 */
  let latestReportId: number | null = null
  for (const message of messages) {
    if (message.role === 'other' && reports[message.id]) latestReportId = message.id
  }

  // 当前会话的人设速览条目：单聊取对方档案，群聊取每位成员档案
  const personaPeek = current
    ? current.is_group
      ? current.members
          .map((member) => ({ member, profile: profiles.find((p) => p.key === member.key) }))
          .filter((entry) => entry.profile)
      : [{ member: null, profile: profiles.find((p) => p.key === current.counterpart_key) }]
    : []
  const hasPersonaPeek = personaPeek.some((entry) => entry.profile)

  // 显示名动态走人设库：档案改名后，列表 / 头部 / 发言人标签即时跟随新昵称，
  // 无需回改会话快照（key 冻结，改名只影响显示）
  function displayName(key: string, fallback: string): string {
    return profiles.find((item) => item.key === key)?.nickname || fallback
  }

  // 档案必选：新建弹窗里默认选中第一个档案；选中项被删时回落
  useEffect(() => {
    if (soloProfileId !== null && !profiles.some((item) => item.id === soloProfileId)) {
      setSoloProfileId(profiles[0]?.id ?? null)
    } else if (soloProfileId === null && profiles.length > 0) {
      setSoloProfileId(profiles[0].id)
    }
  }, [profiles, soloProfileId])

  // 挂载时把登录会话内的历史报告从模块缓存接回来
  useEffect(() => {
    const seeded: Record<number, ReportEntry> = {}
    reportCache.forEach((entry, id) => {
      seeded[id] = entry
    })
    setReports(seeded)
  }, [])

  /** 写报告：组件状态与模块缓存同步，切走页面再回来不丢 */
  function setReport(id: number, entry: ReportEntry | null) {
    setReports((prev) => {
      const next = { ...prev }
      if (entry) next[id] = entry
      else delete next[id]
      return next
    })
    if (entry) reportCache.set(id, entry)
    else reportCache.delete(id)
  }

  // 人设前置兜底：会话涉及的对象/成员在档案库缺席（如档案被删）时禁止新增记录
  const missingProfileNames = current
    ? current.is_group
      ? current.members
          .filter((member) => !profiles.some((p) => p.key === member.key))
          .map((member) => member.name)
      : profiles.some((p) => p.key === current.counterpart_key)
        ? []
        : [current.counterpart_name || current.title]
    : []
  const chatLocked = current !== null && missingProfileNames.length > 0

  const reloadList = useCallback(async () => {
    setConversations(await listConversations())
  }, [])

  useEffect(() => {
    void reloadList().catch((err: unknown) => {
      setError(err instanceof ApiError ? err.message : '聊天列表加载失败')
    })
    listProfiles().then(setProfiles).catch(() => undefined)
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
    setSpeakerKey('')
    setReplyTarget('')
    setRole('other')
    setReportOpenOverrides({})
    let cancelled = false
    void listMessages(currentId)
      .then((rows) => {
        // 快速切换会话时，慢的旧响应不能覆盖新会话的内容
        if (!cancelled) setMessages(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : '内容加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [currentId])

  // 消息更新时贴底：新内容出来不用手动翻
  useEffect(() => {
    const el = streamRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, reports])

  async function create() {
    // 人设前置：单聊必选档案；群聊成员全部来自档案（后端同规则兜底）。
    // 场景与关系不在这里选：后端按人设档位自动推导。
    if (groupMode) {
      const picked = profiles.filter((item) => memberProfileIds.includes(item.id))
      if (picked.length === 0) {
        setError('群聊至少要一位成员（从人设库选择）')
        return
      }
      // 群名从成员昵称生成：后端要求非空标题稳住群档
      const names = picked.map((item) => item.nickname)
      const title = `${names.slice(0, 3).join('、')}${names.length > 3 ? '等' : ''}的群聊`
      await submitCreate({ title, member_profile_ids: memberProfileIds })
      return
    }
    const soloProfile = chosenSoloProfile
    if (!soloProfile) {
      setError('请先从人设库选用一个档案')
      return
    }
    await submitCreate({
      title: `和${soloProfile.nickname}的聊天`,
      profile_id: soloProfile.id,
    })
  }

  async function submitCreate(payload: Parameters<typeof createConversation>[0]) {
    setBusy(true)
    setError(null)
    try {
      const created = await createConversation(payload)
      await reloadList()
      setCurrentId(created.id)
      setCreating(false)
      setGroupMode(false)
      setSoloProfileId(null)
      setMemberProfileIds([])
      setListOpen(false)
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
    if (busy || currentId === null || (!draft.trim() && images.length === 0)) return
    if (chatLocked) {
      setError('人设档案缺失，无法新增记录；请先在人设库重建同名档案')
      return
    }
    const wantsSpeaker = current?.is_group && role === 'other'
    if (wantsSpeaker && !speakerKey) {
      setError('请先选择发言成员')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const source =
        role === 'me' && pickedText !== null
          ? draft.trim() === pickedText
            ? 'candidate'
            : 'rewrite'
          : 'manual'
      const text = draft.trim()
      const message = await appendMessage(
        currentId,
        role,
        text,
        source,
        images.map((item) => item.materialId),
        wantsSpeaker ? speakerKey : '',
      )
      setPickedText(null)
      setMessages((prev) => [...prev, message])
      setDraft('')
      setImages((prev) => {
        prev.forEach((item) => URL.revokeObjectURL(item.url))
        return []
      })
      // 对方来话自动处理：分析报告挂在这条消息下方，同时起帮我回复管线
      if (role === 'other') {
        const target = wantsSpeaker ? speakerKey : ''
        void runAnalysis(currentId, message.id)
        void runAutoReply(currentId, text, target, message.id)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  /** 起一份帮我回复管线：浮层按阶段推进；新管线顶掉旧浮层。 */
  async function runAutoReply(
    conversationId: number,
    hint: string,
    targetMember: string,
    messageId: number | null,
  ) {
    const fresh: ReplyCard = {
      id: messageId ?? 0,
      conversationId,
      targetMember,
      targetName: targetMember
        ? displayName(
            targetMember,
            current?.members.find((member) => member.key === targetMember)?.name ?? targetMember,
          )
        : '',
      messageId,
      hint: hint.slice(0, 24),
      running: true,
      // 点击后先按设置显示计划；服务端 plan 事件再对齐。翻译关着时不闪「解读来话」。
      plan: autoTranslate ? ['translate', 'score', 'draft', 'rank'] : ['score', 'draft', 'rank'],
      progress: 0,
      scores: null,
      candidates: [],
      blocked: null,
      ranked: true,
      error: null,
    }
    setReplyByConv((prev) => ({ ...prev, [conversationId]: fresh }))
    try {
      const result = await replyStream(
        { conversation_id: conversationId, target_member: targetMember },
        (event) => {
          if (event.stage === 'plan') {
            updateReply(conversationId, { plan: event.steps ?? [], progress: 0 })
          } else if (event.stage === 'score_done') {
            updateReply(conversationId, { scores: event.scores ?? null })
            bumpProgress(conversationId)
          } else if (event.stage === 'translate_done' || event.stage === 'draft_done' || event.stage === 'done') {
            bumpProgress(conversationId)
          }
        },
      )
      updateReply(conversationId, {
        scores: result.scores,
        candidates: result.candidates,
        blocked: result.blocked,
        ranked: result.ranked !== false,
        running: false,
      })
    } catch (err) {
      updateReply(conversationId, { running: false, error: err instanceof ApiError ? err.message : '回复未生成' })
    }
  }

  function updateReply(conversationId: number, patch: Partial<ReplyCard>) {
    setReplyByConv((prev) => {
      const card = prev[conversationId]
      if (!card) return prev
      return { ...prev, [conversationId]: { ...card, ...patch } }
    })
  }

  function bumpProgress(conversationId: number) {
    setReplyByConv((prev) => {
      const card = prev[conversationId]
      if (!card) return prev
      return { ...prev, [conversationId]: { ...card, progress: card.progress + 1 } }
    })
  }

  /** 点选候选：填入输入框（切到「我」），按采用推荐记录，并收起浮层 */
  function pickCandidate(text: string) {
    setRole('me')
    setDraft(text)
    setPickedText(text)
    if (currentId !== null) {
      setReplyByConv((prev) => ({ ...prev, [currentId]: null }))
    }
  }

  /** 浮层里的失败重试：按记录的会话与目标成员重跑管线 */
  function retryReply() {
    if (currentId === null) return
    const card = replyByConv[currentId]
    if (!card || card.running) return
    void runAutoReply(card.conversationId, card.hint, card.targetMember, card.messageId)
  }

  /** 重新生成候选：锚定最新一条来话 */
  function regenerateReply() {
    if (currentId === null) return
    const last = [...messages].reverse().find((item) => item.role === 'other')
    void runAutoReply(
      currentId,
      last?.content ?? '',
      replyTarget || last?.speaker || '',
      last?.id ?? null,
    )
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

  /** 对方来话自动分析：报告按消息 id 缓存，本次登录内都可见 */
  async function runAnalysis(conversationId: number, messageId: number) {
    setReport(messageId, { result: null, loading: true, error: null, reason: null, explaining: false })
    try {
      const judged = await analyze(conversationId)
      setReport(messageId, { result: judged, loading: false, error: null, reason: null, explaining: false })
      void review(conversationId)
    } catch (err) {
      setReport(messageId, {
        result: null,
        loading: false,
        error: err instanceof ApiError ? err.message : '分析失败',
        reason: null,
        explaining: false,
      })
    }
  }

  /** 为什么这么判：按消息就地取文，结果同样留在缓存里 */
  async function explainFor(messageId: number) {
    if (currentId === null) return
    const entry = reports[messageId]
    if (!entry?.result || entry.explaining) return
    setReport(messageId, { ...entry, explaining: true })
    try {
      const explained = await explainDecision(currentId, entry.result)
      setReport(messageId, { ...entry, explaining: false, reason: explained.reason })
    } catch (err) {
      setReport(messageId, {
        ...entry,
        explaining: false,
        reason: err instanceof ApiError ? err.message : '说明未生成',
      })
    }
  }

  async function polishDraft() {
    // 润色只对自己的回复开放：对方的话是原始记录，不该被改写
    if (role !== 'me' || !draft.trim()) return
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside
          className={`${listOpen ? 'block' : 'hidden'} border-b border-border bg-surface lg:block lg:w-[268px] lg:shrink-0 lg:border-b-0 lg:border-r`}
        >
          <div className="flex h-14 items-center justify-between px-4">
            <span className="flex items-center gap-2 text-[14px] font-semibold tracking-tight text-ink">
              <IconChat className="h-[18px] w-[18px] text-ink-muted" />
              聊天
            </span>
            <Button
              size="sm"
              variant={creating ? 'secondary' : 'primary'}
              onClick={() => setCreating((value) => !value)}
            >
              {creating ? '取消' : '新建'}
            </Button>
          </div>
          {conversations.length === 0 && !creating ? (
            <EmptyState title="暂无聊天" description="新建一位对象，再粘贴对方发来的内容。" />
          ) : (
            <ul className="space-y-0.5 px-2 pb-3">
              {conversations.map((item) => {
                const active = item.id === currentId
                const label = item.is_group
                  ? item.title
                  : displayName(item.counterpart_key, item.counterpart_name || item.title)
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-150 ${
                        active ? 'bg-primary-soft' : 'hover:bg-surface-muted'
                      }`}
                      onClick={() => {
                        setCurrentId(item.id)
                        setReflection(null)
                        setPickedText(null)
                        setListOpen(false)
                      }}
                    >
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center text-[13px] ${
                          item.is_group ? 'rounded-[9px]' : 'rounded-full'
                        } ${active ? 'bg-primary/10 text-primary' : 'bg-surface-muted text-ink-muted'}`}
                      >
                        {item.is_group ? '群' : label.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[14px] ${
                            active ? 'font-medium text-primary' : 'text-ink'
                          }`}
                        >
                          {label}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-muted">
                          {item.relationship && <span className="truncate">{item.relationship}</span>}
                          {item.is_group && <span className="shrink-0">群聊</span>}
                          {item.scenario_kind === 'workplace' && <span className="shrink-0">职场</span>}
                          {item.scenario_kind === 'custom' && <span className="shrink-0">自定义</span>}
                        </span>
                      </span>
                      {item.message_count > 0 && (
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                          {item.message_count}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                className="shrink-0 rounded-[8px] border border-border bg-surface px-2 py-1 text-[12px] text-ink-secondary transition-colors duration-150 hover:border-border-strong hover:bg-surface-muted hover:text-ink lg:hidden"
                onClick={() => setListOpen((value) => !value)}
              >
                列表
              </button>
              {!current?.is_group && current && (() => {
                const profile = profiles.find((item) => item.key === current.counterpart_key)
                return profile?.avatar_base64 ? (
                  <img
                    src={profile.avatar_base64}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-border"
                  />
                ) : (
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-muted text-[13px] text-ink-muted">
                    {(current.counterpart_name || current.title).slice(0, 1)}
                  </span>
                )
              })()}
              <span className="truncate text-[16px] font-semibold tracking-tight text-ink">
                {current
                  ? current.is_group
                    ? current.title
                    : displayName(current.counterpart_key, current.counterpart_name || current.title)
                  : 'HelpMe'}
              </span>
              {current?.is_group && (
                <span className="shrink-0 rounded-[6px] bg-surface-muted px-1.5 py-0.5 text-[12px] text-ink-muted">
                  {current.members.length + 1} 人
                </span>
              )}
              {hasPersonaPeek && (
                <button
                  type="button"
                  aria-expanded={personaOpen}
                  onClick={() => setPersonaOpen((value) => !value)}
                  className="ml-1 flex shrink-0 items-center gap-1 rounded-[6px] bg-surface-muted px-2 py-1 text-[12px] text-ink-secondary transition-colors duration-150 hover:text-ink"
                >
                  人设
                  <IconChevronDown
                    className={`h-3.5 w-3.5 transition-transform duration-200 ${personaOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="新建聊天"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-primary transition-colors duration-150 hover:bg-primary-soft lg:hidden"
              onClick={() => {
                setListOpen(true)
                setCreating(true)
              }}
            >
              <IconPlus className="h-5 w-5" />
            </button>
          </header>

          {personaOpen && hasPersonaPeek && (
            <div className="border-b border-border-subtle bg-surface-muted px-4 py-2.5">
              <div className="flex flex-wrap gap-2">
                {personaPeek.map(({ member, profile }) => {
                  if (!profile) return null
                  return (
                    <div
                      key={profile.key}
                      className="flex max-w-full min-w-[240px] flex-1 items-start gap-2 rounded-[6px] border border-border bg-surface px-2.5 py-2"
                    >
                      {profile.avatar_base64 ? (
                        <img src={profile.avatar_base64} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[14px] text-primary">
                          {profile.nickname.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {profile.nickname}
                          <span className="ml-1.5 text-[11px] font-normal text-ink-muted">
                            {contextLabelOf(profile.context, profile.context_label)} · 置信度 {profile.confidence}%
                          </span>
                        </p>
                        {profile.summary ? (
                          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-ink-secondary">{profile.summary}</p>
                        ) : (
                          <p className="mt-0.5 text-[12px] text-ink-muted">还没有速写：到「人设」页补全画像</p>
                        )}
                        {profile.traits.length > 0 && (
                          <p className="mt-0.5 truncate text-[12px] text-ink-muted" title={profile.traits.map((t) => `${t.title} ${t.text}`).join('　')}>
                            {profile.traits.map((t) => `${t.title} ${t.text}`).join('　')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 pt-3">
              <Notice tone="danger">
                {error}
                {(error.includes('设置') || error.includes('接上')) && (
                  <button type="button" className="ml-2 font-medium underline decoration-current/40 underline-offset-2 transition-colors duration-150 hover:decoration-current" onClick={onOpenSettings}>
                    去设置
                  </button>
                )}
              </Notice>
            </div>
          )}

          {current === null ? (
            <EmptyState title="请选择聊天" description="在左侧新建或打开已有聊天。手机端点击右上角「+」新建。" />
          ) : (
            <>
              <div ref={streamRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5">
                {messages.length === 0 && (
                  <EmptyState title="暂无内容" description="在下方粘贴对方的话，发送者选「对方」，然后保存。" />
                )}
                {messages.map((message) => {
                  const badge = message.role === 'me' ? SOURCE_BADGES[message.source] : undefined
                  const imageAttachments = (message.attachments ?? []).filter(
                    (item) => item.type === 'image',
                  )
                  const speakerName =
                    current?.is_group && message.role === 'other' && message.speaker
                      ? displayName(
                          message.speaker,
                          current.members.find((member) => member.key === message.speaker)?.name ??
                            message.speaker,
                        )
                      : null
                  // 挂在这条来话下的分析报告；最新一条来话默认展开，其余默认折叠
                  const entry = message.role === 'other' ? reports[message.id] : undefined
                  return (
                    <div key={message.id} className="space-y-2">
                      <div
                        className={`flex flex-col ${message.role === 'me' ? 'items-end' : 'items-start'}`}
                      >
                        {speakerName && (
                          <span className="mb-1 text-[11px] text-ink-muted">{speakerName}</span>
                        )}
                        {message.content && (
                          <p
                            className={`max-w-[min(82%,560px)] whitespace-pre-wrap break-words rounded-[14px] px-3.5 py-2.5 text-[14px] leading-[22px] ${
                              message.role === 'me'
                                ? 'bg-primary-soft text-ink ring-1 ring-primary-border/70'
                                : 'border border-border bg-surface text-ink shadow-xs'
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
                      {entry && (
                        <MessageReport
                          entry={entry}
                          scenarioKind={current?.scenario_kind ?? 'romance'}
                          open={reportOpenOverrides[message.id] ?? message.id === latestReportId}
                          onToggle={(open) =>
                            setReportOpenOverrides((prev) => ({ ...prev, [message.id]: open }))
                          }
                          onExplain={() => void explainFor(message.id)}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="sticky bottom-0 border-t border-border bg-surface px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
                {replyWork && (
                  <ReplyFloat
                    card={replyWork}
                    onPick={pickCandidate}
                    onRetry={() => void retryReply()}
                    onClose={() => {
                      if (currentId !== null) {
                        setReplyByConv((prev) => ({ ...prev, [currentId]: null }))
                      }
                    }}
                  />
                )}
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <Segmented
                    value={role}
                    size="sm"
                    ariaLabel="这条消息是谁说的"
                    options={[
                      { value: 'other', label: '对方' },
                      { value: 'me', label: '我' },
                    ]}
                    onChange={(item) => {
                      setRole(item)
                      // 切去保存对方消息时，候选已不适用，清掉免得误记为「改写」
                      if (item === 'other') setPickedText(null)
                    }}
                  />
                  {current?.is_group && (
                    <select
                      className="ml-auto h-8 cursor-pointer rounded-[8px] border border-border bg-surface px-2 text-[13px] text-ink shadow-xs transition-colors duration-150 hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                      value={replyTarget}
                      aria-label="要回复哪位成员"
                      onChange={(event) => setReplyTarget(event.target.value)}
                    >
                      <option value="">回复对象：自动</option>
                      {current.members.map((member) => (
                        <option key={member.key} value={member.key}>
                          {displayName(member.key, member.name)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {current?.is_group && role === 'other' && (
                  <select
                    className={controlClass + ' mb-2.5 cursor-pointer'}
                    value={speakerKey}
                    aria-label="发言成员"
                    onChange={(event) => setSpeakerKey(event.target.value)}
                  >
                    <option value="">请选择发言成员</option>
                    {current.members.map((member) => (
                      <option key={member.key} value={member.key}>
                        {displayName(member.key, member.name)}
                      </option>
                    ))}
                  </select>
                )}
                {role === 'me' && pickedText !== null && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-[6px] bg-primary-soft px-3 py-1.5">
                    <p className="text-[12px] leading-5 text-ink-secondary">
                      {draft.trim() === pickedText
                        ? '已选用候选，原样发送将记录为「采用推荐」'
                        : '候选已被改动，发送将记录为「改写推荐」'}
                    </p>
                    <button
                      type="button"
                      className={LINK_CHIP + ' shrink-0'}
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
                          className="block h-16 w-16 cursor-zoom-in overflow-hidden rounded-[8px] border border-border transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-sm"
                          onClick={() => setLightbox(item.url)}
                          aria-label="查看大图"
                        >
                          <img src={item.url} alt="" className="h-full w-full object-cover" />
                        </button>
                        <button
                          type="button"
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[12px] leading-none text-white shadow-sm transition-transform duration-150 hover:scale-110 active:scale-95"
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
                {chatLocked && (
                  <Notice tone="danger">
                    人设档案缺失（{missingProfileNames.join('、')}）：已锁定输入，先到「人设」页重建同名档案即可继续。
                  </Notice>
                )}
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    // 回车直接保存，shift+回车换行；输入法组词的回车不算
                    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault()
                      void send()
                    }
                  }}
                  onPaste={onPaste}
                  rows={2}
                  disabled={chatLocked}
                  placeholder={
                    visionReady === false
                      ? role === 'other'
                        ? '粘贴对方发来的内容（当前模型不支持看图，图片无法添加）'
                        : '写下你要回复的话'
                      : role === 'other'
                        ? current?.is_group
                          ? '粘贴群里的发言，上方选择发言成员'
                          : '粘贴对方发来的内容，也可以直接贴聊天截图'
                        : '写下你要回复的话'
                  }
                  className="w-full resize-none rounded-[10px] border border-border bg-surface px-3.5 py-2.5 text-ink shadow-xs transition-colors duration-150 placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
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
                    className={LINK_CHIP + ' mt-1'}
                    onClick={() => {
                      setDraft(previousDraft)
                      setPreviousDraft(null)
                    }}
                  >
                    撤回润色
                  </button>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={uploading}
                      disabled={visionReady === false}
                      disabledReason="当前默认模型不支持看图"
                      onClick={() => fileInput.current?.click()}
                    >
                      <IconUpload className="h-4 w-4" />
                      图片
                    </Button>
                    {role === 'me' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy}
                        disabled={!draft.trim()}
                        disabledReason="请先输入内容"
                        onClick={() => void polishDraft()}
                      >
                        润色
                      </Button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      className="text-primary"
                      loading={replyWork?.running ?? false}
                      disabled={messages.length === 0}
                      disabledReason="请先保存至少一条内容"
                      onClick={() => regenerateReply()}
                    >
                      <IconSparkle className="h-4 w-4" />
                      帮我回复
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={busy}
                      disabled={chatLocked || (!draft.trim() && images.length === 0)}
                      disabledReason={chatLocked ? '人设档案缺失，先重建同名档案' : '请先输入内容或贴图'}
                      onClick={() => void send()}
                    >
                      保存
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
      {lightbox !== null && <Lightbox url={lightbox} onClose={() => setLightbox(null)} />}

      {creating && (
        <Modal size="sm" scroll="hidden" labelledBy="new-chat-title" className="flex flex-col" onClose={() => setCreating(false)} busy={busy}>
          <div className="flex min-h-0 flex-col">
            <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
              <div>
                <h2 id="new-chat-title" className="text-[16px] font-semibold tracking-tight text-ink">
                  新建聊天
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-ink-muted">
                  选好人设就开聊，场景与关系按人设档自动带上。
                </p>
              </div>
              <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setCreating(false)} aria-label="关闭新建聊天">
                关闭
              </Button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
              <Segmented
                fluid
                value={groupMode ? 'group' : 'solo'}
                ariaLabel="会话类型"
                options={[
                  { value: 'solo', label: '单聊' },
                  { value: 'group', label: '群聊' },
                ]}
                onChange={(next) => setGroupMode(next === 'group')}
              />
              {profiles.length === 0 ? (
                <p className="rounded-[8px] bg-warning-soft px-3 py-2 text-[13px] leading-5 text-warning">
                  人设库还是空的——先到「人设」页建好人设，再回来开始聊天。
                </p>
              ) : (
                <div className="space-y-1.5" role="group" aria-label={groupMode ? '选择群成员' : '选择人设'}>
                  {profiles.map((profile) => {
                    const picked = groupMode
                      ? memberProfileIds.includes(profile.id)
                      : soloProfileId === profile.id
                    return (
                      <PersonRow
                        key={profile.id}
                        profile={profile}
                        picked={picked}
                        disabled={busy}
                        onPick={() =>
                          groupMode
                            ? setMemberProfileIds((prev) =>
                                prev.includes(profile.id)
                                  ? prev.filter((id) => id !== profile.id)
                                  : [...prev, profile.id],
                              )
                            : setSoloProfileId(profile.id)
                        }
                      />
                    )
                  })}
                </div>
              )}
              {groupMode && profiles.length > 0 && (
                <p className="text-[12px] text-ink-muted">群聊可多选；群名按成员昵称自动生成。</p>
              )}
            </div>
            <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button
                type="button"
                variant="primary"
                loading={busy}
                disabled={groupMode ? memberProfileIds.length === 0 : soloProfileId === null}
                disabledReason={groupMode ? '请先选择群成员' : '请先选一个人设'}
                onClick={() => void create()}
              >
                创建会话
              </Button>
            </footer>
          </div>
        </Modal>
      )}
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
      className="block h-16 w-16 cursor-zoom-in overflow-hidden rounded-[8px] border border-border bg-surface-muted transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-sm"
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

/** 新建聊天弹窗里的一行：头像 + 昵称 + 档位；单聊单选、群聊多选。 */
function PersonRow({
  profile,
  picked,
  disabled,
  onPick,
}: {
  profile: PersonaProfileView
  picked: boolean
  disabled?: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      data-person-option
      aria-pressed={picked}
      disabled={disabled}
      onClick={onPick}
      className={`flex w-full items-center gap-3 rounded-[10px] border px-3 py-2 text-left transition-colors duration-150 ${
        picked
          ? 'border-primary bg-primary-soft/60'
          : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted'
      } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
    >
      {profile.avatar_base64 ? (
        <img
          src={profile.avatar_base64}
          alt=""
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-border"
        />
      ) : (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-[14px] text-primary">
          {profile.nickname.slice(0, 1)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink">{profile.nickname}</span>
        {profile.summary && (
          <span className="mt-0.5 block truncate text-[12px] text-ink-muted">{profile.summary}</span>
        )}
      </span>
      <span className="shrink-0 rounded-[6px] bg-surface-sunken px-1.5 py-px text-[12px] text-ink-secondary">
        {contextLabelOf(profile.context, profile.context_label)}
      </span>
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
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-[16px] leading-none text-ink"
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
      <button type="button" className={LINK_CHIP + ' mt-1'} onClick={onUndo}>
        撤销
      </button>
    </div>
  )
}
