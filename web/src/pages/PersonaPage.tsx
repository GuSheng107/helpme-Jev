import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { listConversations, listScenarios, type Conversation, type Scenario } from '../api/chat'
import {
  commitChat,
  createProfile,
  deleteProfile,
  importQa,
  listProfiles,
  previewChat,
  updateProfile,
  type ChatPreview,
  type PersonaProfileView,
} from '../api/personas'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'
import Modal from '../components/Modal'
import Segmented from '../components/Segmented'
import {
  contextLabelOf,
  DEFAULT_CONTEXT,
  dimensionKeysOf,
  dimensionsOf,
  genderLabelOf,
  isPresetContext,
  personaKeysOf,
  resolveDimensions,
  SCORE_LEVELS,
  SELF_DIMENSIONS,
  GENDER_OPTIONS,
  type Dimension,
} from '../data/personaCatalog'

type Tab = 'library' | 'import'
const TABS: { key: Tab; label: string }[] = [
  { key: 'library', label: '人设库' },
  { key: 'import', label: '导入数据' },
]

export default function PersonaPage() {
  const [tab, setTab] = useState<Tab>('library')
  // 导入数据挂在会话上：会话带了场景与对象，导入内容跟着场景走
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ChatPreview | null>(null)
  const [otherLabels, setOtherLabels] = useState('')
  const [qa, setQa] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 人设库
  const [profiles, setProfiles] = useState<PersonaProfileView[]>([])
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [eNickname, setENickname] = useState('')

  const current = conversations.find((item) => item.id === currentId) ?? null

  useEffect(() => {
    listConversations()
      .then((rows) => {
        setConversations(rows)
        setCurrentId(rows[0]?.id ?? null)
      })
      .catch(() => setError('会话未能载入'))
    listProfiles()
      .then(setProfiles)
      .catch(() => undefined)
  }, [])

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

  function labels() {
    const custom = otherLabels
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    return custom.length > 0 ? custom : undefined
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="人设"
          description="人设按场景档位生成，同一个人在不同档各存一份，互不覆盖。"
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
                            {profile.subject === 'me' ? (
                              <StatusTag tone="primary">我</StatusTag>
                            ) : (
                              <StatusTag tone={profile.context === 'workplace' ? 'primary' : 'info'}>
                                {contextLabelOf(profile.context, profile.context_label)}
                              </StatusTag>
                            )}
                            {profile.subject === 'me' && genderLabelOf(profile.gender) && (
                              <StatusTag tone="info">{genderLabelOf(profile.gender)}</StatusTag>
                            )}
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

        {tab === 'import' && (
          <section className="space-y-4">
            <DataCard title="导入聊天记录" description="粘贴过往对话，按说话人分开保存，判断时会参考。">
              <label className="mb-3 block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
                  导入到哪个会话
                </span>
                <select
                  className="h-9 w-full cursor-pointer rounded-[8px] border border-border bg-surface px-2.5 text-[14px] text-ink shadow-xs transition-colors duration-150 hover:border-border-strong focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
                  value={currentId ?? ''}
                  onChange={(event) => {
                    setCurrentId(event.target.value === '' ? null : Number(event.target.value))
                    setPreview(null)
                  }}
                >
                  {conversations.length === 0 && <option value="">还没有会话</option>}
                  {conversations.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.counterpart_name || item.title}
                      {item.is_group ? '（群聊）' : ''}
                    </option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[12px] leading-5 text-ink-muted">
                  导入内容跟随会话的场景与对象；还没有会话就先到「聊天」页新建。
                </span>
              </label>

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
                <Button size="sm" loading={busy} disabled={currentId === null} disabledReason="请先选择会话" onClick={() => void previewImport()}>
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
  const [mode, setMode] = useState<'other' | 'self'>('other')
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState('')
  const [gender, setGender] = useState('')
  const [context, setContext] = useState<string>(DEFAULT_CONTEXT)
  const [answers, setAnswers] = useState<Record<string, string | number>>({})
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // 档位跟随场景：内置恋爱 / 职场 + 用户自建场景
  useEffect(() => {
    listScenarios()
      .then((rows) => setScenarios(rows.filter((item) => item.kind === 'custom')))
      .catch(() => undefined)
  }, [])

  const contextOptions = [
    { key: 'romance', label: '恋爱', hint: '亲密关系' },
    { key: 'workplace', label: '职场', hint: '同事与上下级' },
    ...scenarios.map((item) => ({ key: item.slug, label: item.name, hint: `自定义场景 · ${item.name}` })),
  ]
  const selectedScenario = scenarios.find((item) => item.slug === context)

  // 档位 → 维度：内置按预设；场景档用场景自带的人设题集（只取维度库内的题）
  const dimensions: Dimension[] = mode === 'self'
    ? SELF_DIMENSIONS
    : selectedScenario
      ? resolveDimensions(personaKeysOf(selectedScenario.persona_questions))
      : dimensionsOf(context)
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
      setError(mode === 'self' ? '请先填写称呼' : '请先填写昵称')
      return
    }
    if (answered === 0) {
      setError('请至少回答一道题')
      return
    }
    if (mode !== 'self' && !isPresetContext(context) && dimensions.length === 0) {
      setError('这个场景还没有可用的人设题，先到场景里补人设题集')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createProfile({
        nickname: nickname.trim(),
        avatar_base64: avatar,
        subject: mode === 'self' ? 'me' : 'other',
        gender,
        context: mode === 'self' ? 'self' : context,
        context_label: '',
        dimension_keys:
          mode === 'self'
            ? []
            : selectedScenario
              ? personaKeysOf(selectedScenario.persona_questions)
              : dimensionKeysOf(context),
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
          <p className="mt-1 text-[13px] text-ink-muted">
            {mode === 'self'
              ? '「我」的人设全场景通用一份，候选回复会按你的口吻起草。'
              : '按你了解的 TA 作答，至少一题；不确定的留空即可。'}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
          关闭
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        {error && <Notice tone="danger">{error}</Notice>}

        <Segmented
          value={mode}
          ariaLabel="给谁建档"
          options={[
            { value: 'other', label: '对方' },
            { value: 'self', label: '我自己' },
          ]}
          onChange={(next) => {
            setMode(next as 'other' | 'self')
            setAnswers({})
            setError('')
          }}
        />

        <div className="flex items-center gap-4">
          {avatar ? (
            <img src={avatar} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover ring-1 ring-border" />
          ) : (
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-surface-muted text-[16px] text-ink-faint">
              {nickname.slice(0, 1) || '头'}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <label className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
              {mode === 'self' ? '称呼' : '昵称'}
            </label>
            <input
              className="h-9 w-full rounded-[8px] border border-border bg-surface px-3 text-[14px] text-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder={mode === 'self' ? '平时对方怎么叫你' : '给这个人设起个名字'}
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
          <p className="mb-1.5 text-[13px] font-medium text-ink-secondary">性别</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="性别">
            {GENDER_OPTIONS.map((option) => {
              const active = gender === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  aria-pressed={active}
                  onClick={() => setGender(option.value)}
                  className={`rounded-[8px] border px-3 py-1.5 text-[13px] transition-all duration-150 ${
                    active
                      ? 'border-primary bg-primary-soft font-medium text-primary'
                      : 'border-border bg-surface text-ink-secondary hover:border-border-strong hover:bg-surface-muted hover:text-ink'
                  } ${busy ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-ink-muted">影响候选回复里的措辞与称呼，可以不选。</p>
        </div>

        {mode === 'other' && (
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-ink-secondary">人设档</p>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="人设档">
              {contextOptions.map((option) => {
                const active = context === option.key
                return (
                  <button
                    key={option.key}
                    type="button"
                    disabled={busy}
                    aria-pressed={active}
                    title={option.hint}
                    onClick={() => {
                      setContext(option.key)
                      setAnswers({})
                    }}
                    className={`rounded-[8px] border px-3 py-1.5 text-[13px] transition-all duration-150 ${
                      active
                        ? 'border-primary bg-primary-soft font-medium text-primary'
                        : 'border-border bg-surface text-ink-secondary hover:border-border-strong hover:bg-surface-muted hover:text-ink'
                    } ${busy ? 'cursor-not-allowed opacity-60' : ''}`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2 text-[12px] leading-5 text-ink-muted">
              {contextOptions.find((item) => item.key === context)?.hint}
            </p>
          </div>
        )}

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-medium text-ink-secondary">
              {mode === 'self' ? '按你自己的情况作答' : '按你了解的 TA 作答'}
            </p>
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
          {mode === 'self'
            ? '维度取自沟通风格，不做临床诊断。保存后按作答生成一句速写，起草时全场景生效。'
            : '维度取自公开的人格框架，不做临床诊断。保存后按作答生成一句速写。'}
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
