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
import ContextPicker from '../components/ContextPicker'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'
import Modal from '../components/Modal'
import Segmented from '../components/Segmented'
import {
  contextLabelOf,
  CUSTOM_CONTEXT_DEFAULT_DIMENSIONS,
  DEFAULT_CONTEXT,
  dimensionKeysOf,
  dimensionsOf,
  isPresetContext,
  SCORE_LEVELS,
  type Dimension,
} from '../data/personaCatalog'

type Tab = 'library' | 'archive' | 'import'
const TABS: { key: Tab; label: string }[] = [
  { key: 'library', label: '人设库' },
  { key: 'archive', label: '会话档案' },
  { key: 'import', label: '导入数据' },
]

/** 上游瞬断自动重试：最多 2 次、间隔 10 秒，进度经 onHint 提示；非 retryable 直接抛。 */
const RETRY_MAX = 2
const RETRY_DELAY_MS = 10_000

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withAutoRetry<T>(run: () => Promise<T>, onHint: (text: string) => void): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await run()
    } catch (err) {
      if (!(err instanceof ApiError) || !err.retryable || attempt >= RETRY_MAX) throw err
      attempt += 1
      onHint(`上游模型抖动，自动重试中（${attempt}/${RETRY_MAX}），约 10 秒后再次尝试…`)
      await sleep(RETRY_DELAY_MS)
    }
  }
}

export default function PersonaPage() {
  const [tab, setTab] = useState<Tab>('library')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [subject, setSubject] = useState<'me' | 'other'>('other')
  const [context, setContext] = useState<string>(DEFAULT_CONTEXT)
  // 自定义档位的档位名与勾选的维度（内置档位不用这两个）
  const [customLabel, setCustomLabel] = useState('')
  const [customKeys, setCustomKeys] = useState<string[]>(CUSTOM_CONTEXT_DEFAULT_DIMENSIONS)
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
  const [retryHint, setRetryHint] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 人设库
  const [profiles, setProfiles] = useState<PersonaProfileView[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
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
  const linkedIsPlaceholder = Boolean(linkedProfile) && (linkedProfile?.traits.length ?? 0) === 0

  useEffect(() => {
    listConversations()
      .then((rows) => {
        setConversations(rows)
        setCurrentId(rows[0]?.id ?? null)
        const kind = rows[0]?.scenario_kind
        if (kind === 'workplace') setContext('workplace')
      })
      .catch(() => setError('会话未能载入'))
    personaUsage()
      .then(setUsage)
      .catch(() => undefined)
    listProfiles()
      .then(setProfiles)
      .catch(() => undefined)
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
    fetchPersonaBatch(current.id, context)
      .then((result) => {
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
    setRetryHint('')
    try {
      const built = await withAutoRetry(
        () =>
          buildPersona(
            currentId,
            effectiveSubject,
            effectiveSubject === 'me' ? selfAnswers : {},
            context,
            current?.is_group && effectiveSubject === 'other' ? groupSel.key : '',
            isPresetContext(context) ? '' : customLabel.trim(),
            dimensionKeysOf(context, customKeys),
          ),
        setRetryHint,
      )
      setPersona(built)
      setNotice(built.kept ? built.reason || '已保留原档案' : '档案已更新')
      listProfiles()
        .then(setProfiles)
        .catch(() => undefined)
      if (current?.is_group) {
        fetchPersonaBatch(current.id, context).then(setBatch).catch(() => undefined)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '建模未完成')
    } finally {
      setRetryHint('')
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

  const selfDimensions = dimensionsOf(context, customKeys)

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="人设"
          description="同一个人在不同档位各存一份，互不覆盖。不做临床诊断。"
          actions={
            tab === 'library' ? (
              <Button size="sm" variant="primary" onClick={() => setWizardOpen(true)}>
                新建人设
              </Button>
            ) : undefined
          }
        />

        <div className="mb-5 flex gap-1 border-b border-border">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`relative -mb-px px-3.5 py-2.5 text-[13px] transition-colors duration-150 ${
                tab === item.key ? 'font-semibold text-primary' : 'text-ink-secondary hover:text-ink'
              }`}
            >
              {item.label}
              {tab === item.key && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" aria-hidden />
              )}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        {retryHint && (
          <div className="mb-4">
            <Notice tone="warning">{retryHint}</Notice>
          </div>
        )}
        {notice && (
          <div className="mb-4">
            <Notice tone="success">{notice}</Notice>
          </div>
        )}

        {tab === 'library' && (
          <section className="space-y-4">
            <p className="text-[13px] leading-5 text-ink-muted">
              选好档位、按维度作答，保存后在新建聊天时可直接选用。
            </p>
            {profiles.length === 0 ? (
              <DataCard>
                <EmptyState
                  title="还没有人设"
                  description="先给聊天对象建一份，判断时会带上 TA 的性格特点。"
                  action={
                    <Button size="sm" variant="primary" onClick={() => setWizardOpen(true)}>
                      新建人设
                    </Button>
                  }
                />
              </DataCard>
            ) : (
              <div className="grid gap-3.5 md:grid-cols-2">
                {profiles.map((profile) => (
                  <article
                    key={profile.id}
                    className="group rounded-[14px] border border-border bg-surface p-4 shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar src={profile.avatar_base64} name={profile.nickname} size={44} />
                      <div className="min-w-0 flex-1">
                        {editingId === profile.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              className="h-8 w-36 rounded-[8px] border border-border px-2.5 text-[13px] focus:border-primary focus:outline-none"
                              value={eNickname}
                              onChange={(event) => setENickname(event.target.value)}
                              autoFocus
                            />
                            <Button size="sm" variant="primary" loading={busy} onClick={() => void renameProfile(profile)}>
                              保存
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                              取消
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-[14px] font-semibold text-ink">{profile.nickname}</h3>
                            <StatusTag tone={profile.context === 'workplace' ? 'primary' : 'info'}>
                              {contextLabelOf(profile.context, profile.context_label)}
                            </StatusTag>
                          </div>
                        )}
                        <p className="mt-1 text-[12px] tabular-nums text-ink-faint">
                          置信度 {profile.confidence}% · 版本 {profile.version}
                        </p>
                      </div>
                    </div>

                    {profile.summary && (
                      <p className="mt-3 rounded-[10px] bg-surface-muted px-3 py-2 text-[13px] leading-5 text-ink-secondary">
                        {profile.summary}
                      </p>
                    )}

                    {profile.traits.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {profile.traits.map((trait) => (
                          <span
                            key={trait.key}
                            className="inline-flex items-center gap-1 rounded-[6px] border border-border-subtle px-2 py-0.5 text-[12px] text-ink-secondary"
                          >
                            <span className="text-ink-faint">{trait.title}</span>
                            {trait.text}
                          </span>
                        ))}
                      </div>
                    )}

                    {editingId !== profile.id && (
                      <div className="mt-4 flex justify-end gap-1.5 opacity-70 transition-opacity duration-150 group-hover:opacity-100">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(profile.id)
                            setENickname(profile.nickname)
                          }}
                        >
                          改名
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-danger hover:bg-danger-soft"
                          onClick={() => void removeProfile(profile)}
                        >
                          删除
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'archive' && (
          <section className="space-y-4">
            {conversations.length === 0 ? (
              <DataCard>
                <EmptyState title="还没有聊天对象" description="先在「聊天」页新建会话，再回来查看档案。" />
              </DataCard>
            ) : (
              <>
                <DataCard title="档案">
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <select
                      className="h-9 rounded-[8px] border border-border bg-surface px-2.5 text-[14px] text-ink focus:border-primary focus:outline-none"
                      value={currentId ?? ''}
                      onChange={(event) => pickConversation(Number(event.target.value))}
                    >
                      {conversations.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.counterpart_name || item.title}
                        </option>
                      ))}
                    </select>
                    {current?.is_group ? (
                      <select
                        className="h-9 rounded-[8px] border border-border bg-surface px-2.5 text-[14px] text-ink focus:border-primary focus:outline-none"
                        value={memberKey}
                        onChange={(event) => setMemberKey(event.target.value)}
                      >
                        <option value="me">我（自评）</option>
                        {current.members.map((member) => (
                          <option key={member.key} value={member.key}>
                            {member.name}（从对话推断）
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Segmented
                        value={subject}
                        options={[
                          { value: 'other', label: '对方' },
                          { value: 'me', label: '我' },
                        ]}
                        onChange={setSubject}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="primary"
                      className="ml-auto"
                      loading={busy}
                      disabled={Boolean(linkedProfile) && !linkedIsPlaceholder}
                      disabledReason="已有人设库档案，判断以档案为准；自评请切到「我」，或到人设库用同名昵称补全"
                      onClick={() => void build()}
                    >
                      {effectiveSubject === 'me' ? '提交自评' : linkedIsPlaceholder ? '补全占位档案' : '从对话推断'}
                    </Button>
                  </div>

                  <div className="mb-4">
                    <p className="text-[13px] font-medium text-ink-secondary">人设档</p>
                    <div className="mt-2">
                      <ContextPicker
                        value={context}
                        label={customLabel}
                        keys={customKeys}
                        disabled={busy}
                        onChange={(value) => {
                          setContext(value)
                          setSelfAnswers({})
                        }}
                        onLabel={setCustomLabel}
                        onKeys={(keys) => {
                          setCustomKeys(keys)
                          setSelfAnswers({})
                        }}
                      />
                    </div>
                  </div>

                  {effectiveSubject === 'me' && (
                    <div className="mb-4 space-y-3">
                      {selfDimensions.map((dim) => (
                        <DimensionRow
                          key={dim.key}
                          dimension={dim}
                          value={selfAnswers[dim.key]}
                          onChange={(value) =>
                            setSelfAnswers((prev) => ({ ...prev, [dim.key]: value }))
                          }
                        />
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3 text-[13px] text-ink-muted">
                    <span>
                      {current?.is_group
                        ? `${memberKey === 'me' ? '我' : (current.members.find((member) => member.key === memberKey)?.name ?? memberKey)}　`
                        : ''}
                      {contextLabelOf(
                        linkedProfile?.context ?? persona?.context ?? context,
                        linkedProfile?.context_label,
                      )}
                      档
                    </span>
                    <span className="tabular-nums">
                      置信度 {linkedProfile?.confidence ?? persona?.confidence ?? 0}% · 版本{' '}
                      {linkedProfile?.version ?? persona?.version ?? 0}
                    </span>
                    {linkedProfile && <StatusTag tone="primary">人设库档案</StatusTag>}
                  </div>

                  {linkedIsPlaceholder && (
                    <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
                      这是待补全的占位档案：点上方「补全占位档案」用这段对话补全，或到人设库用同名昵称补全。
                    </p>
                  )}

                  {(linkedProfile?.traits ?? persona?.traits ?? []).length > 0 ? (
                    <ul className="mt-3 divide-y divide-border-subtle">
                      {(linkedProfile?.traits ?? persona?.traits ?? []).map((trait) => (
                        <li key={trait.key} className="flex items-baseline justify-between gap-3 py-2">
                          <span className="text-[13px] text-ink-secondary">{trait.title}</span>
                          <span className="text-right text-[14px] text-ink">{trait.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[13px] text-ink-muted">还没有档案内容。</p>
                  )}

                  <p className="mt-4 text-[12px] text-ink-faint">
                    候选直接采用 {usage.adopted} 次，手动改写 {usage.rewritten} 次
                  </p>
                </DataCard>

                {current?.is_group && batch && (
                  <DataCard title={`群成员档案`} description={`共 ${batch.participants.length} 人`}>
                    <ul className="space-y-2">
                      {batch.participants.map((participant) => (
                        <li key={participant.key} className="rounded-[10px] bg-surface-muted px-3.5 py-2.5">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
                            {participant.name}
                            <span className="text-[12px] tabular-nums text-ink-faint">
                              置信度 {participant.persona.confidence}% · 版本 {participant.persona.version}
                            </span>
                          </p>
                          <p className="mt-1 text-[13px] leading-5 text-ink-secondary">
                            {participant.persona.traits.length > 0
                              ? participant.persona.traits.map((trait) => `${trait.title} ${trait.text}`).join('　')
                              : '还没有档案，可在上方选中后「从对话推断」'}
                          </p>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-[12px] text-ink-faint">共享上下文（记忆）{batch.memories.length} 条</p>
                  </DataCard>
                )}
              </>
            )}
          </section>
        )}

        {tab === 'import' && (
          <section className="space-y-4">
            <DataCard title="导入聊天记录" description="粘贴过往对话，按说话人分开保存，判断时会参考。">
              <textarea
                className="min-h-32 w-full rounded-[10px] border border-border bg-surface p-3 text-[14px] leading-6 text-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                placeholder={'我: 在吗\nTA: 没怎么'}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              {current?.is_group ? (
                <p className="mt-2 text-[13px] text-ink-muted">群聊按成员名识别发言归属，无需填标签</p>
              ) : (
                <input
                  className="mt-2 h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-[13px] text-ink focus:border-primary focus:outline-none"
                  placeholder="对方标签（选填，逗号分隔，默认认 她 / 他 / TA）"
                  value={otherLabels}
                  onChange={(event) => setOtherLabels(event.target.value)}
                />
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button size="sm" loading={busy} onClick={() => void previewImport()}>
                  预览
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy}
                  disabled={preview === null}
                  disabledReason="请先预览"
                  onClick={() => void confirmImport()}
                >
                  确认导入
                </Button>
                {preview === null && <span className="text-[12px] text-ink-muted">先点「预览」，确认结果后才能导入</span>}
              </div>
              {preview && (
                <p className="mt-2 text-[13px] text-ink-secondary">
                  认出 {preview.count} 条，跳过 {preview.skipped} 条。确认后才会入库。
                </p>
              )}
            </DataCard>

            <DataCard title="导入问答" description="用 JSON 数组补充已知的事实。">
              <textarea
                className="min-h-24 w-full rounded-[10px] border border-border bg-surface p-3 font-mono text-[13px] leading-6 text-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                placeholder='[{"question":"雷区？","answer":"不要提前任"}]'
                value={qa}
                onChange={(event) => setQa(event.target.value)}
              />
              <Button
                className="mt-3"
                size="sm"
                loading={busy}
                disabled={!qa.trim()}
                disabledReason="请先粘贴问答"
                onClick={() => void saveQa()}
              >
                导入
              </Button>
            </DataCard>
          </section>
        )}
      </PageBody>

      {wizardOpen && (
        <ProfileWizard
          onClose={() => setWizardOpen(false)}
          onSaved={async () => {
            setWizardOpen(false)
            setProfiles(await listProfiles())
            setNotice('人设已保存，聊天里可以直接选用')
          }}
        />
      )}
    </PageShell>
  )
}

/* ------------------------------------------------------------------ 建档向导 */

function ProfileWizard({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState('')
  const [context, setContext] = useState<string>(DEFAULT_CONTEXT)
  const [contextLabel, setContextLabel] = useState('')
  const [dimensionKeys, setDimensionKeys] = useState<string[]>(CUSTOM_CONTEXT_DEFAULT_DIMENSIONS)
  const [answers, setAnswers] = useState<Record<string, string | number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const dimensions = dimensionsOf(context, dimensionKeys)
  const answered = Object.keys(answers).length

  function onAvatarFile(file: File) {
    // 现代浏览器解码 <img> 时会自动按 EXIF 方向摆正，drawImage 拿到的已是转正后的像素
    if (!file.type.startsWith('image/')) {
      setError('头像需要是图片文件')
      return
    }
    setError('')
    const reader = new FileReader()
    reader.onerror = () => setError('头像读取失败，请换一张试试')
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => setError('头像读取失败，请换一张试试')
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
        setAvatar(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!nickname.trim()) {
      setError('请先填写昵称')
      return
    }
    if (answered === 0) {
      setError('请至少回答一道题')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createProfile({
        nickname: nickname.trim(),
        avatar_base64: avatar,
        context,
        context_label: isPresetContext(context) ? '' : contextLabel.trim(),
        dimension_keys: dimensionKeysOf(context, dimensionKeys),
        answers,
      })
      await onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '人设未生成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal size="lg" scroll="hidden" busy={busy} onClose={onClose} labelledBy="profile-wizard-title" className="flex flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div>
          <h2 id="profile-wizard-title" className="text-[16px] font-semibold tracking-tight text-ink">
            新建人设
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">按你了解的 TA 作答，至少一题；不确定的留空即可。</p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          关闭
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex items-center gap-4">
          {avatar ? (
            <img src={avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface-muted text-[16px] text-ink-faint">
              {nickname.slice(0, 1) || '头'}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary">昵称</label>
            <input
              className="h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-[14px] text-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="给这个人设起个名字"
              autoFocus
            />
          </div>
          <label className="mt-5 cursor-pointer self-start rounded-[8px] border border-border px-3 py-1.5 text-[13px] text-ink-secondary transition-colors hover:bg-surface-muted">
            {avatar ? '换头像' : '上传头像'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) onAvatarFile(file)
              }}
            />
          </label>
        </div>

        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-secondary">人设档</p>
          <ContextPicker
            value={context}
            label={contextLabel}
            keys={dimensionKeys}
            disabled={busy}
            onChange={(value) => {
              setContext(value)
              setAnswers({})
            }}
            onLabel={setContextLabel}
            onKeys={(keys) => {
              setDimensionKeys(keys)
              setAnswers({})
            }}
          />
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-secondary">按你了解的 TA 作答</p>
            <p className="text-[12px] tabular-nums text-ink-muted">
              已答 {answered}/{dimensions.length}
            </p>
          </div>
          <div className="divide-y divide-border-subtle">
            {dimensions.map((dim) => (
              <DimensionRow
                key={dim.key}
                dimension={dim}
                value={answers[dim.key]}
                onChange={(value) => setAnswers((prev) => ({ ...prev, [dim.key]: value }))}
              />
            ))}
          </div>
        </div>

        <p className="text-[12px] leading-5 text-ink-muted">
          维度取自公开的人格框架，不做临床诊断。保存后按作答生成一句速写。
        </p>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button size="sm" onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
          生成并保存
        </Button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ 作答控件 */

function DimensionRow({
  dimension,
  value,
  onChange,
  disabled,
}: {
  dimension: Dimension
  value: string | number | undefined
  onChange: (value: string | number) => void
  disabled?: boolean
}) {
  return (
    <div className="py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-[13px] font-medium text-ink">{dimension.title}</p>
        <p className="text-[12px] text-ink-muted">{dimension.question}</p>
      </div>
      <div className="mt-2.5">
        {dimension.type === 'score' ? (
          <ScorePicker
            value={typeof value === 'number' ? value : undefined}
            disabled={disabled}
            onChange={onChange}
          />
        ) : (
          <ChoicePicker
            dimension={dimension}
            value={typeof value === 'string' ? value : undefined}
            disabled={disabled}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  )
}

function ScorePicker({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined
  onChange: (value: number) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1" role="group">
        {SCORE_LEVELS.map((label, index) => {
          const selected = value === index
          const filled = value !== undefined && index < value
          return (
            <button
              key={label}
              type="button"
              disabled={disabled}
              title={label}
              aria-label={label}
              aria-pressed={selected}
              onClick={() => onChange(index)}
              className={`h-7 flex-1 rounded-[6px] border transition-all duration-150 ${
                selected
                  ? 'border-primary bg-primary shadow-xs'
                  : filled
                    ? 'border-primary-border bg-primary-soft'
                    : 'border-border bg-surface hover:border-border-strong hover:bg-surface-muted'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            />
          )
        })}
      </div>
      <span
        className={`w-14 shrink-0 text-right text-[12px] tabular-nums ${
          value === undefined ? 'text-ink-faint' : 'font-medium text-ink'
        }`}
      >
        {value === undefined ? '未作答' : SCORE_LEVELS[value]}
      </span>
    </div>
  )
}

function ChoicePicker({
  dimension,
  value,
  onChange,
  disabled,
}: {
  dimension: Dimension
  value: string | undefined
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const selected = dimension.options?.find((option) => option.value === value)
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group">
        {(dimension.options ?? []).map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              title={option.note}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`rounded-[8px] border px-3 py-1.5 text-[13px] transition-all duration-150 ${
                active
                  ? 'border-primary bg-primary-soft font-medium text-primary'
                  : 'border-border bg-surface text-ink-secondary hover:border-border-strong hover:bg-surface-muted hover:text-ink'
              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {selected && <p className="mt-2 text-[12px] text-ink-muted">{selected.note}</p>}
    </div>
  )
}

function Avatar({ src, name, size }: { src: string; name: string; size: number }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover ring-1 ring-border"
      />
    )
  }
  return (
    <span
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      className="grid shrink-0 place-items-center rounded-full bg-primary-soft font-medium text-primary"
    >
      {name.slice(0, 1)}
    </span>
  )
}
