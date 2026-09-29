import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { listConversations, type Conversation } from '../api/chat'
import {
  buildPersona,
  commitChat,
  createProfile,
  deleteProfile,
  fetchPersonaBatch,
  getPersona,
  importQa,
  listProfiles,
  personaUsage,
  previewChat,
  updateProfile,
  type ChatPreview,
  type PersonaBatch,
  type PersonaContext,
  type PersonaProfileView,
  type PersonaView,
} from '../api/personas'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell } from '../components/layout'

type SelfItem =
  | { key: string; kind: 'score'; statement: string }
  | { key: string; kind: 'choice'; statement: string; options: [string, string][] }

const SCORE_OPTIONS: [string, number][] = [
  ['符合', 7],
  ['一般', 4],
  ['不太符合', 1],
]

const ATTACHMENT_OPTIONS: [string, string][] = [
  ['既能亲近也能独立', 'secure'],
  ['常要确认对方还在意', 'anxious'],
  ['太近了会想退开', 'avoidant'],
  ['时近时远，说不清', 'disorganized'],
]

const LOVE_LANGUAGE_OPTIONS: [string, string][] = [
  ['听到肯定的话', 'words'],
  ['专属的陪伴时间', 'time'],
  ['收到用心的礼物', 'gifts'],
  ['对方为我做事', 'service'],
  ['肢体上的亲近', 'touch'],
]

const CONFLICT_OPTIONS: [string, string][] = [
  ['坚持我的立场', 'competing'],
  ['一起找两边都接受的办法', 'collaborating'],
  ['各退一步', 'compromising'],
  ['先放着，缓一缓', 'avoiding'],
  ['我让步，息事宁人', 'accommodating'],
]

const DISC_OPTIONS: [string, string][] = [
  ['直接，先冲结果', 'dominance'],
  ['热情，靠说服和关系', 'influence'],
  ['耐心，求稳求节奏', 'steadiness'],
  ['严谨，细节要核对', 'conscientiousness'],
]

const SELF_FORMS: Record<PersonaContext, SelfItem[]> = {
  romance: [
    { key: 'openness', kind: 'score', statement: '我喜欢尝试新的想法和做法' },
    { key: 'conscientiousness', kind: 'score', statement: '我做事有计划，答应的事会做完' },
    { key: 'extraversion', kind: 'score', statement: '和人相处让我更有精神' },
    { key: 'agreeableness', kind: 'score', statement: '我通常先考虑对方的感受' },
    { key: 'emotional_stability', kind: 'score', statement: '有压力时我大体稳得住' },
    { key: 'attachment', kind: 'choice', statement: '和亲近的人相处时，我最像哪种？', options: ATTACHMENT_OPTIONS },
    { key: 'love_language', kind: 'choice', statement: '被在乎的时候，我最在意哪种？', options: LOVE_LANGUAGE_OPTIONS },
    { key: 'conflict_style', kind: 'choice', statement: '有分歧时我通常怎么做？', options: CONFLICT_OPTIONS },
  ],
  workplace: [
    { key: 'openness', kind: 'score', statement: '我乐于接受新工具和新流程' },
    { key: 'conscientiousness', kind: 'score', statement: '我按计划交付，截止时间记得牢' },
    { key: 'extraversion', kind: 'score', statement: '群体场合让我更来劲' },
    { key: 'agreeableness', kind: 'score', statement: '我会先照顾协作方的感受' },
    { key: 'emotional_stability', kind: 'score', statement: '工作有压力时我大体稳得住' },
    { key: 'disc', kind: 'choice', statement: '我的工作风格最像哪种？', options: DISC_OPTIONS },
    { key: 'conflict_style', kind: 'choice', statement: '工作有分歧时我通常怎么做？', options: CONFLICT_OPTIONS },
  ],
}

const CONTEXT_LABELS: Record<PersonaContext, string> = { romance: '恋爱', workplace: '职场' }

export default function PersonaPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [subject, setSubject] = useState<'me' | 'other'>('other')
  const [context, setContext] = useState<PersonaContext>('romance')
  const [persona, setPersona] = useState<PersonaView | null>(null)
  const [usage, setUsage] = useState({ adopted: 0, rewritten: 0 })
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ChatPreview | null>(null)
  const [otherLabels, setOtherLabels] = useState('')
  const [qa, setQa] = useState('')
  const [selfAnswers, setSelfAnswers] = useState<Record<string, string | number>>({})
  const [memberKey, setMemberKey] = useState('me')
  const [batch, setBatch] = useState<PersonaBatch | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 人设库
  const [profiles, setProfiles] = useState<PersonaProfileView[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [pNickname, setPNickname] = useState('')
  const [pAvatar, setPAvatar] = useState('')
  const [pContext, setPContext] = useState<PersonaContext>('romance')
  const [pAnswers, setPAnswers] = useState<Record<string, string | number>>({})
  const [editingId, setEditingId] = useState<number | null>(null)
  const [eNickname, setENickname] = useState('')

  const current = conversations.find((item) => item.id === currentId) ?? null

  // 群聊：选中的是我还是哪位成员；单聊不用这个状态
  const groupSel = current?.is_group
    ? memberKey === 'me'
      ? { key: current.counterpart_key, subject: 'me' as const }
      : { key: memberKey, subject: 'other' as const }
    : { key: current?.counterpart_key ?? '', subject }
  const effectiveSubject = groupSel.subject
  // 人设库档案优先展示（与判断链路同源）：key 命中档案时，推断档案不再显示
  const linkedProfile =
    current && effectiveSubject === 'other'
      ? profiles.find((item) => item.key === groupSel.key)
      : undefined

  useEffect(() => {
    listConversations()
      .then((rows) => {
        setConversations(rows)
        setCurrentId(rows[0]?.id ?? null)
        const kind = rows[0]?.scenario_kind
        if (kind === 'workplace') setContext('workplace')
      })
      .catch(() => setError('会话未能载入'))
    personaUsage().then(setUsage).catch(() => undefined)
    listProfiles().then(setProfiles).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!current) return
    const kind = current.scenario_kind
    if (kind === 'romance' || kind === 'workplace') setContext(kind)
    setMemberKey('me')
    setPersona(null)
    setBatch(null)
  }, [current])

  useEffect(() => {
    if (!current?.is_group) return
    let cancelled = false
    // 情境跟随恋爱 / 职场切换，和下方单份档案保持一致
    fetchPersonaBatch(current.id, context)
      .then((result) => {
        // 快速切换会话时，慢的旧响应不能覆盖新会话的批量档案
        if (!cancelled) setBatch(result)
      })
      .catch(() => {
        if (!cancelled) setError('群成员档案未能载入')
      })
    return () => {
      cancelled = true
    }
  }, [current, context])

  useEffect(() => {
    if (!current) return
    let cancelled = false
    getPersona(groupSel.key, groupSel.subject, context)
      .then((view) => {
        if (!cancelled) setPersona(view)
      })
      .catch(() => {
        if (!cancelled) setPersona(null)
      })
    return () => {
      cancelled = true
    }
  }, [current, groupSel.key, groupSel.subject, context])

  function pickConversation(id: number) {
    setCurrentId(id)
    setPersona(null)
  }

  async function build() {
    if (currentId === null) return
    if (effectiveSubject === 'me' && Object.keys(selfAnswers).length === 0) {
      setError('请先作答，至少选一项')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const built = await buildPersona(
        currentId,
        effectiveSubject,
        effectiveSubject === 'me' ? selfAnswers : {},
        context,
        current?.is_group && effectiveSubject === 'other' ? groupSel.key : '',
      )
      setPersona(built)
      setNotice(built.kept ? built.reason || '已保留原档案' : '档案已更新')
      if (current?.is_group) {
        fetchPersonaBatch(current.id, context).then(setBatch).catch(() => undefined)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '建模未完成')
    } finally {
      setBusy(false)
    }
  }

  function labels() {
    const custom = otherLabels
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    return custom.length > 0 ? custom : undefined
  }

  async function previewImport() {
    if (currentId === null || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await previewChat(currentId, text, labels()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '预览未完成')
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (currentId === null || preview === null) return
    setBusy(true)
    try {
      const saved = await commitChat(currentId, text, labels())
      setNotice(`已导入 ${saved.imported} 条，跳过 ${saved.skipped} 条`)
      setPreview(null)
      setText('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '导入未完成')
    } finally {
      setBusy(false)
    }
  }

  async function saveQa() {
    setBusy(true)
    setError(null)
    try {
      const saved = await importQa(qa, currentId)
      setNotice(`已导入 ${saved.imported} 组问答`)
      setQa('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '问答未导入')
    } finally {
      setBusy(false)
    }
  }

  const selfItems = SELF_FORMS[context]
  const wizardItems = SELF_FORMS[pContext]

  function onProfileAvatarFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = 96
        canvas.height = 96
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        const scale = Math.max(96 / img.width, 96 / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (96 - w) / 2, (96 - h) / 2, w, h)
        setPAvatar(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  async function saveProfile() {
    if (!pNickname.trim()) {
      setError('请先填写昵称')
      return
    }
    if (Object.keys(pAnswers).length === 0) {
      setError('请至少回答一道题')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await createProfile({
        nickname: pNickname.trim(),
        avatar_base64: pAvatar,
        context: pContext,
        answers: pAnswers,
      })
      setProfiles(await listProfiles())
      setWizardOpen(false)
      setPNickname('')
      setPAvatar('')
      setPAnswers({})
      setNotice('人设已保存，聊天里可以直接选用')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '人设未生成')
    } finally {
      setBusy(false)
    }
  }

  async function renameProfile(profile: PersonaProfileView) {
    const nickname = eNickname.trim()
    if (!nickname) return
    setBusy(true)
    setError(null)
    try {
      const updated = await updateProfile(profile.id, { nickname })
      setProfiles((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setEditingId(null)
      setNotice('昵称已更新')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更新未完成')
    } finally {
      setBusy(false)
    }
  }

  async function removeProfile(profile: PersonaProfileView) {
    const confirmed = await confirmAction({
      title: '删除人设',
      message: `删除「${profile.nickname}」后，已有聊天不受影响，但判断时不再带上这份人设。`,
      confirmText: '删除',
      tone: 'danger',
    })
    if (!confirmed) return
    try {
      await deleteProfile(profile.id)
      setProfiles((prev) => prev.filter((item) => item.id !== profile.id))
      setNotice('人设已删除')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除未完成')
    }
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="人设档案"
          description="按情境分档：恋爱与职场各一份，互不覆盖。这不是临床诊断。"
        />
        {current?.scenario_kind === 'custom' && (
          <div className="mb-3"><Notice>此会话使用我的场景中的人设题；恋爱 / 职场用于区分档案和自评表。</Notice></div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <div className="mb-3"><Notice tone="info">{notice}</Notice></div>}
        <div className="space-y-4">
            <DataCard title={`人设库${profiles.length > 0 ? `（${profiles.length}）` : ''}`}>
              <p className="mb-3 text-[13px] text-ink-muted">
                先答题、由语言模型生成人设，聊天（单聊 / 群聊）创建时直接选用。
              </p>
              {profiles.length === 0 && !wizardOpen && (
                <p className="text-[14px] text-ink-secondary">还没有人设，点「新建人设」开始。</p>
              )}
              {profiles.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {profiles.map((profile) => (
                    <li key={profile.id} className="flex items-start gap-3 rounded-[6px] bg-surface-muted px-3 py-2">
                      {profile.avatar_base64 ? (
                        <img
                          src={profile.avatar_base64}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[16px] text-primary">
                          {profile.nickname.slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        {editingId === profile.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              className="w-40 rounded-[6px] border border-border px-2 py-1 text-[14px]"
                              value={eNickname}
                              onChange={(event) => setENickname(event.target.value)}
                            />
                            <Button size="sm" variant="primary" loading={busy} onClick={() => void renameProfile(profile)}>
                              保存
                            </Button>
                            <Button size="sm" onClick={() => setEditingId(null)}>取消</Button>
                          </div>
                        ) : (
                          <p className="text-[14px] text-ink">
                            {profile.nickname}
                            <span className="ml-2 text-[12px] text-ink-muted">
                              {CONTEXT_LABELS[profile.context]}　置信度 {profile.confidence}%
                            </span>
                          </p>
                        )}
                        {profile.summary && (
                          <p className="mt-0.5 text-[13px] leading-5 text-ink-secondary">{profile.summary}</p>
                        )}
                        {profile.traits.length > 0 && (
                          <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                            {profile.traits.map((trait) => `${trait.title} ${trait.text}`).join('　')}
                          </p>
                        )}
                      </div>
                      {editingId !== profile.id && (
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            onClick={() => {
                              setEditingId(profile.id)
                              setENickname(profile.nickname)
                            }}
                          >
                            改名
                          </Button>
                          <Button size="sm" onClick={() => void removeProfile(profile)}>删除</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!wizardOpen ? (
                <Button size="sm" variant="primary" onClick={() => setWizardOpen(true)}>新建人设</Button>
              ) : (
                <div className="space-y-3 rounded-[6px] border border-border p-3">
                  <div className="flex items-center gap-3">
                    {pAvatar ? (
                      <img src={pAvatar} alt="" className="h-14 w-14 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-muted text-[12px] text-ink-muted">
                        头像
                      </span>
                    )}
                    <label className="cursor-pointer text-[13px] text-primary">
                      上传头像
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0]
                          event.target.value = ''
                          if (file) onProfileAvatarFile(file)
                        }}
                      />
                    </label>
                  </div>
                  <div>
                    <span className="mb-1 block text-[12px] text-ink-muted">昵称</span>
                    <input
                      className="w-full rounded-[6px] border border-border px-2 py-1.5 text-[14px]"
                      value={pNickname}
                      onChange={(event) => setPNickname(event.target.value)}
                      placeholder="给这个人设起个名字"
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-[12px] text-ink-muted">场景</span>
                    <div className="flex rounded-[6px] border border-border p-0.5">
                      {(['romance', 'workplace'] as const).map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={`rounded-[4px] px-3 py-1 text-[13px] ${
                            pContext === item ? 'bg-primary text-white' : 'text-ink-secondary'
                          }`}
                          onClick={() => {
                            setPContext(item)
                            setPAnswers({})
                          }}
                        >
                          {CONTEXT_LABELS[item]}
                        </button>
                      ))}
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {wizardItems.map((item) => (
                      <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[13px] leading-5 text-ink-secondary">{item.statement}</span>
                        <select
                          className="rounded-[6px] border border-border px-2 py-1 text-[13px]"
                          value={String(pAnswers[item.key] ?? '')}
                          onChange={(event) => {
                            const raw = event.target.value
                            if (!raw) {
                              setPAnswers((prev) => {
                                const next = { ...prev }
                                delete next[item.key]
                                return next
                              })
                              return
                            }
                            setPAnswers((prev) => ({
                              ...prev,
                              [item.key]: item.kind === 'score' ? Number(raw) : raw,
                            }))
                          }}
                        >
                          <option value="">未作答</option>
                          {item.kind === 'score'
                            ? SCORE_OPTIONS.map(([label, value]) => (
                                <option key={value} value={value}>{label}</option>
                              ))
                            : item.options.map(([label, value]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                        </select>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[12px] text-ink-muted">
                    以「TA」的口吻作答即可，保存后由语言模型生成人设速写。
                  </p>
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" loading={busy} onClick={() => void saveProfile()}>
                      生成并保存
                    </Button>
                    <Button size="sm" onClick={() => setWizardOpen(false)}>取消</Button>
                  </div>
                </div>
              )}
            </DataCard>
            {conversations.length === 0 ? (
          <EmptyState title="还没有聊天对象" description="人设保存后，去聊天里新建会话并选用它。" />
        ) : (
            <>
                <DataCard title="档案">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-[6px] border border-border px-2 py-1 text-[14px]"
                  value={currentId ?? ''}
                  onChange={(event) => pickConversation(Number(event.target.value))}
                >
                  {conversations.map((item) => (
                    <option key={item.id} value={item.id}>{item.counterpart_name || item.title}</option>
                  ))}
                </select>
                <div className="flex rounded-[6px] border border-border p-0.5">
                  {(['romance', 'workplace'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`rounded-[4px] px-2 py-0.5 text-[13px] ${
                        context === item ? 'bg-primary text-white' : 'text-ink-secondary'
                      }`}
                      onClick={() => setContext(item)}
                    >
                      {CONTEXT_LABELS[item]}
                    </button>
                  ))}
                </div>
                {current?.is_group ? (
                  <select
                    className="rounded-[6px] border border-border px-2 py-1 text-[14px]"
                    value={memberKey}
                    onChange={(event) => setMemberKey(event.target.value)}
                  >
                    <option value="me">我（自评）</option>
                    {current.members.map((member) => (
                      <option key={member.key} value={member.key}>{member.name}（从对话推断）</option>
                    ))}
                  </select>
                ) : (
                  <div className="flex rounded-[6px] border border-border p-0.5">
                    {(['other', 'me'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        className={`rounded-[4px] px-2 py-0.5 text-[13px] ${
                          subject === item ? 'bg-primary text-white' : 'text-ink-secondary'
                        }`}
                        onClick={() => setSubject(item)}
                      >
                        {item === 'me' ? '我' : '对方'}
                      </button>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  disabled={Boolean(linkedProfile)}
                  disabledReason="已有人设库档案，判断以档案为准；如需重建请先删除档案"
                  onClick={() => void build()}
                >
                  {effectiveSubject === 'me' ? '提交自评' : '从对话推断'}
                </Button>
              </div>
              {effectiveSubject === 'me' && (
                <ul className="mb-3 space-y-2">
                  {selfItems.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] leading-5 text-ink-secondary">{item.statement}</span>
                      <select
                        className="rounded-[6px] border border-border px-2 py-1 text-[13px]"
                        value={String(selfAnswers[item.key] ?? '')}
                        onChange={(event) => {
                          const raw = event.target.value
                          setSelfAnswers((prev) => ({
                            ...prev,
                            [item.key]: item.kind === 'score' ? Number(raw) : raw,
                          }))
                        }}
                      >
                        <option value="">未作答</option>
                        {item.kind === 'score'
                          ? SCORE_OPTIONS.map(([label, value]) => (
                              <option key={value} value={value}>{label}</option>
                            ))
                          : item.options.map(([label, value]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[13px] text-ink-muted">
                {current?.is_group
                  ? `${memberKey === 'me' ? '我' : current.members.find((member) => member.key === memberKey)?.name ?? memberKey}　`
                  : ''}
                {CONTEXT_LABELS[linkedProfile?.context ?? persona?.context ?? context]}情境　置信度 {linkedProfile?.confidence ?? persona?.confidence ?? 0}%　版本 {linkedProfile?.version ?? persona?.version ?? 0}
                {linkedProfile && <span className="ml-2 text-primary">（人设库档案）</span>}
              </p>
              <ul className="mt-2 space-y-1">
                {(linkedProfile?.traits ?? persona?.traits ?? []).map((trait) => (
                  <li key={trait.key} className="flex justify-between gap-2 text-[14px]">
                    <span className="text-ink-secondary">
                      {trait.title}
                      {trait.weak_science && (
                        <span className="ml-1 text-[11px] text-ink-muted">（该框架证据有限）</span>
                      )}
                    </span>
                    <span className="text-ink">{trait.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-ink-muted">
                直接采用 {usage.adopted} 次，手动改写 {usage.rewritten} 次
              </p>
            </DataCard>
            {current?.is_group && batch && (
              <DataCard title={`群成员档案（${batch.participants.length} 人）`}>
                <ul className="space-y-2">
                  {batch.participants.map((participant) => (
                    <li key={participant.key} className="rounded-[6px] bg-surface-muted px-3 py-2">
                      <p className="text-[14px] text-ink">
                        {participant.name}
                        <span className="ml-2 text-[12px] text-ink-muted">
                          置信度 {participant.persona.confidence}%　版本 {participant.persona.version}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[13px] leading-5 text-ink-secondary">
                        {participant.persona.traits.length > 0
                          ? participant.persona.traits
                              .map((trait) => `${trait.title} ${trait.text}`)
                              .join('　')
                          : '还没有档案，可在上方选中后「从对话推断」'}
                      </p>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[13px] text-ink-muted">
                  共享上下文（记忆）{batch.memories.length} 条
                </p>
              </DataCard>
            )}
            <DataCard title="导入聊天记录">
              <textarea
                className="min-h-28 w-full rounded-[6px] border border-border p-2 text-[14px]"
                placeholder={'我: 在吗\nTA: 没怎么'}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              {current?.is_group ? (
                <p className="mt-2 text-[13px] text-ink-muted">群聊按成员名识别发言归属，无需填标签</p>
              ) : (
                <input
                  className="mt-2 w-full rounded-[6px] border border-border px-2 py-1 text-[13px]"
                  placeholder="对方标签（选填，逗号分隔，默认认 她 / 他 / TA，这里可以补充名字）"
                  value={otherLabels}
                  onChange={(event) => setOtherLabels(event.target.value)}
                />
              )}
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" loading={busy} onClick={() => void previewImport()}>预览</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={preview === null} disabledReason="请先预览" onClick={() => void confirmImport()}>
                  确认导入
                </Button>
                {preview === null && (
                  <span className="text-[12px] text-ink-muted">先点「预览」，确认结果后才能导入</span>
                )}
              </div>
              {preview && (
                <p className="mt-2 text-[13px] text-ink-secondary">
                  认出 {preview.count} 条，跳过 {preview.skipped} 条。确认后才会入库。
                </p>
              )}
            </DataCard>
            <DataCard title="导入问答">
              <textarea
                className="min-h-24 w-full rounded-[6px] border border-border p-2 text-[14px]"
                placeholder='[{"question":"雷区？","answer":"不要提前任"}]'
                value={qa}
                onChange={(event) => setQa(event.target.value)}
              />
              <Button className="mt-2" size="sm" loading={busy} disabled={!qa.trim()} disabledReason="请先粘贴问答" onClick={() => void saveQa()}>
                导入
              </Button>
            </DataCard>
              </>
            )}
          </div>
      </PageBody>
    </PageShell>
  )
}
