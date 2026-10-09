import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { avatarDataUrl, changePassword, updateAutoTranslate, updateAvatar, updateProfile, type UserSummary } from '../api/auth'
import { deleteAccount, exportAccountData } from '../api/logs'
import {
  createProvider,
  deleteProvider,
  listProviders,
  testProvider,
  updateProvider,
  type ConnectionTestResult,
  type ProviderKind,
  type ProviderView,
} from '../api/providers'
import Button from '../components/Button'
import { ConfirmDialog, confirmAction } from '../components/confirm'
import Field, { controlClass } from '../components/Field'
import Modal from '../components/Modal'
import Switch from '../components/Switch'
import { toast, toastError } from '../components/toast'
import { DataCard, EmptyState, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'
import { IconDecide, IconSparkle } from '../components/icons'
import { formatLocalDate } from '../utils/datetime'

interface Props {
  user: UserSummary
  onUserChange: (user: UserSummary) => void
  onLogout: () => void
}

interface FormState {
  id: number | null
  kind: ProviderKind
  protocol: 'openai' | 'openai_responses' | 'anthropic'
  name: string
  endpoint_url: string
  api_key: string
  model: string
  supports_vision: boolean
  context_window_tokens: number
}

const COPY: Record<ProviderKind, { title: string; role: string; address: string; model: string }> = {
  llm: {
    title: '语言模型',
    role: '起草回复、润色与翻译走这里',
    address: 'https://api.example.com/v1/chat/completions',
    model: 'gpt-4o-mini',
  },
  jev: {
    title: '决策模型',
    role: '判断意图、评分与排序走这里',
    address: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
  },
}

const PROTOCOL_LABELS: Record<FormState['protocol'], string> = {
  openai: 'OpenAI',
  openai_responses: 'OpenAI Responses',
  anthropic: 'Anthropic',
}

const CONTEXT_PRESETS: [string, number][] = [['128K', 131072], ['256K', 262144], ['1M', 1048576]]

function blank(kind: ProviderKind): FormState {
  return {
    id: null,
    kind,
    protocol: 'openai',
    name: '',
    endpoint_url: '',
    api_key: '',
    model: '',
    supports_vision: false,
    context_window_tokens: 64000,
  }
}

/** 64000 → 63K，131072 → 128K，1048576 → 1M */
function formatTokens(value: number): string {
  if (value >= 1048576 && value % 1048576 === 0) return `${value / 1048576}M`
  return `${Math.round(value / 1024)}K`
}

/** 设置：语言模型和决策模型完全分开，下面只留账号自己的数据操作。 */
export default function SettingsPage({ user, onUserChange, onLogout }: Props) {
  const [rows, setRows] = useState<ProviderView[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, ConnectionTestResult>>({})
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const reload = useCallback(async () => {
    try {
      setRows(await listProviders())
    } catch (err) {
      toastError(err, '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!form) return
    setBusy(true)
    try {
      if (form.id !== null) {
        await updateProvider(form.id, {
          name: form.name,
          ...(form.kind === 'llm' ? { context_window_tokens: form.context_window_tokens } : {}),
        })
        setForm(null)
        await reload()
        toast('已保存')
        return
      }
      const saved = await createProvider({
        kind: form.kind,
        protocol: form.kind === 'llm' ? form.protocol : 'openai',
        name: form.name,
        endpoint_url: form.endpoint_url,
        api_key: form.api_key,
        model: form.model,
        supports_vision: form.kind === 'llm' && form.supports_vision,
        context_window_tokens: form.kind === 'llm' ? form.context_window_tokens : 64000,
        is_default: !rows.some((row) => row.kind === form.kind),
      })
      const checked = await testProvider(saved.id)
      setResults((prev) => ({ ...prev, [saved.id]: checked }))
      if (!checked.ok) {
        await deleteProvider(saved.id)
        toast(checked.detail || '连通性测试未通过，配置未保存', 'error')
        return
      }
      setForm(null)
      await reload()
      toast('连通正常，已保存')
    } catch (err) {
      toastError(err, '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function runTest(row: ProviderView) {
    setTesting(row.id)
    try {
      const result = await testProvider(row.id)
      setResults((prev) => ({ ...prev, [row.id]: result }))
      await reload()
      toast(result.ok ? '连接成功' : result.detail || '连接失败', result.ok ? 'success' : 'error')
    } catch (err) {
      toastError(err, '连接失败')
    } finally {
      setTesting(null)
    }
  }

  async function toggle(row: ProviderView) {
    if (!row.is_enabled && row.last_test_ok !== true) {
      toast('连通性测试通过后才能启用', 'warning')
      return
    }
    try {
      await updateProvider(row.id, { is_enabled: !row.is_enabled })
      await reload()
      toast(row.is_enabled ? '已停用' : '已启用')
    } catch (err) {
      toastError(err, '操作失败')
    }
  }

  async function remove(row: ProviderView) {
    if (!await confirmAction({
      title: '删除模型配置',
      message: `删除「${row.name}」？删除后需要重新填写。`,
      confirmText: '确认删除',
      tone: 'danger',
    })) return
    try {
      await deleteProvider(row.id)
      await reload()
      toast('已删除')
    } catch (err) {
      toastError(err, '删除失败')
    }
  }

  async function downloadExport() {
    setExporting(true)
    try {
      const blob = await exportAccountData()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `helpme-jev-${formatLocalDate()}.md`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast('已开始下载')
    } catch (err) {
      toastError(err, '导出未完成')
    } finally {
      setExporting(false)
    }
  }

  async function destroyAccount() {
    if (!confirmPassword) return
    setDeleting(true)
    try {
      await deleteAccount(confirmPassword)
      toast('账号已注销')
      onLogout()
    } catch (err) {
      toastError(err, '注销未完成')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <PageShell>
      <PageBody className="flex h-full max-h-full min-h-0 w-full flex-col !py-0">
        <div className="pt-6 sm:pt-8">
          <PageHeader title="设置" description="账号资料、两个模型的连接，以及你自己的数据。" />
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-6 sm:pb-8">
          <AccountCard user={user} onUserChange={onUserChange} />

          {(['llm', 'jev'] as const).map((kind) => (
            <ProviderSection
              key={kind}
              kind={kind}
              rows={rows.filter((row) => row.kind === kind)}
              loading={loading}
              form={form?.kind === kind ? form : null}
              busy={busy}
              testing={testing}
              results={results}
              onAdd={() => setForm(blank(kind))}
              onEdit={(row) =>
                setForm({
                  id: row.id,
                  kind: row.kind,
                  protocol: row.protocol,
                  name: row.name,
                  endpoint_url: row.endpoint_url,
                  api_key: '',
                  model: row.model,
                  supports_vision: row.supports_vision,
                  context_window_tokens: row.context_window_tokens,
                })
              }
              onCancel={() => setForm(null)}
              onChange={setForm}
              onSubmit={submit}
              onTest={runTest}
              onToggle={toggle}
              onRemove={remove}
            />
          ))}

          <TranslationCard user={user} onUserChange={onUserChange} />

          <DataCard title="数据与账号" description="导出留档，或彻底注销账号。">
            <div className="divide-y divide-border-subtle">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-ink">导出个人数据</p>
                  <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
                    会话、人设、记忆与设置打包成一份 Markdown 文件。
                  </p>
                </div>
                <Button size="sm" loading={exporting} onClick={() => void downloadExport()}>
                  导出
                </Button>
              </div>

              {user.role !== 'admin' && (
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">注销账号</p>
                    <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
                      账号、会话、人设、记忆和上传的图片会全部删除，无法恢复。
                    </p>
                  </div>
                  <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                    注销账号
                  </Button>
                </div>
              )}
            </div>
          </DataCard>

          {confirmDelete && (
            <ConfirmDialog
              title="确认注销"
              message="将删除该账号下的全部数据，包括会话、人设、记忆、配置和上传的图片，并退出登录。此操作无法恢复。"
              confirmText="确认注销"
              tone="danger"
              busy={deleting}
              confirmDisabled={!confirmPassword}
              onConfirm={() => void destroyAccount()}
              onCancel={() => { setConfirmDelete(false); setConfirmPassword('') }}
            >
              <Field label="登录密码" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            </ConfirmDialog>
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}

const MAX_AVATAR_BYTES = 1024 * 1024

/** 自动翻译开关：原生 JEV 对中文不友好，默认开；自训练中文 JEV 的用户可关。 */
function TranslationCard({
  user,
  onUserChange,
}: {
  user: UserSummary
  onUserChange: (user: UserSummary) => void
}) {
  const [busy, setBusy] = useState(false)

  async function toggle(next: boolean) {
    setBusy(true)
    try {
      onUserChange(await updateAutoTranslate(next))
      toast(next ? '已开启自动翻译' : '已关闭自动翻译')
    } catch (err) {
      toastError(err, '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DataCard title="翻译" description="中文输入交给 JEV 判断前，是否先由语言模型译成英文。">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-ink">自动翻译</p>
          <p className="mt-0.5 max-w-xl text-[13px] leading-5 text-ink-muted">
            原生 JEV 对中文并不友好，建议保持开启；如果你的 JEV 是自己训练的中文模型，可以关闭。
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[13px] text-ink-secondary">
          <span>{user.auto_translate ? '已开启' : '已关闭'}</span>
          <Switch
            checked={user.auto_translate}
            disabled={busy}
            label={user.auto_translate ? '关闭自动翻译' : '开启自动翻译'}
            onChange={(next) => void toggle(next)}
          />
        </label>
      </div>
    </DataCard>
  )
}

function AccountCard({
  user,
  onUserChange,
}: {
  user: UserSummary
  onUserChange: (user: UserSummary) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [displayName, setDisplayName] = useState(user.display_name)
  const [busy, setBusy] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [editorSrc, setEditorSrc] = useState<string | null>(null)

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      onUserChange(await updateProfile(displayName))
      toast('昵称已更新')
    } catch (err) {
      toastError(err, '保存失败')
    } finally {
      setBusy(false)
    }
  }

  function pickAvatar(file: File | undefined) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setEditorSrc(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  return (
    <DataCard title="账号">
      <div className="flex flex-wrap items-center gap-4">
        {user.avatar_base64 ? (
          <img
            src={avatarDataUrl(user.avatar_base64)}
            alt=""
            className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-border"
          />
        ) : (
          <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-primary text-[20px] font-semibold text-white">
            {(user.display_name || user.username).slice(0, 1)}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[16px] font-semibold tracking-tight text-ink">
              {user.display_name || user.username}
            </span>
            <StatusTag tone={user.role === 'admin' ? 'primary' : 'info'}>
              {user.role === 'admin' ? '管理员' : '用户'}
            </StatusTag>
          </div>
          <p className="mono mt-1 truncate text-[13px] text-ink-muted">{user.username}</p>
          <p className="mt-1 text-[12px] text-ink-faint">
            没有头像时显示昵称首字；选择图片后可拖动和缩放裁剪。
          </p>
        </div>

        <div className="shrink-0">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(event) => { pickAvatar(event.target.files?.[0]); event.target.value = '' }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()}>更换头像</Button>
        </div>
      </div>

      <form onSubmit={saveProfile} className="mt-4 grid gap-3.5 border-t border-border-subtle pt-4 sm:grid-cols-2">
        <Field label="昵称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required autoComplete="nickname" />
        <Field label="用户名" value={user.username} disabled hint="登录名创建后不可修改" />
        <div className="flex flex-wrap items-end justify-between gap-3 sm:col-span-2">
          <p className="text-[12px] leading-5 text-ink-muted">
            密码至少 10 位，需包含字母、数字和符号。
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={() => setPwdOpen(true)}>修改密码</Button>
            <Button type="submit" size="sm" variant="primary" loading={busy}>保存资料</Button>
          </div>
        </div>
      </form>

      {pwdOpen && (
        <PasswordModal onClose={() => setPwdOpen(false)} onSaved={(next) => { setPwdOpen(false); onUserChange(next); toast('密码已修改') }} />
      )}
      {editorSrc && (
        <AvatarEditorModal src={editorSrc} onClose={() => setEditorSrc(null)} onSaved={(next) => { setEditorSrc(null); onUserChange(next); toast('头像已更新') }} />
      )}
    </DataCard>
  )
}

function PasswordModal({ onClose, onSaved }: { onClose: () => void; onSaved: (user: UserSummary) => void }) {
  const titleId = useId()
  const [oldPwd, setOldPwd] = useState('')
  const [nextPwd, setNextPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [busy, setBusy] = useState(false)

  const problem = !nextPwd || !confirmPwd ? null
    : nextPwd.length < 10 ? '新密码至少 10 位'
      : !(/[A-Za-z]/.test(nextPwd) && /\d/.test(nextPwd) && /[^A-Za-z0-9]/.test(nextPwd)) ? '新密码需同时包含字母、数字和符号'
        : nextPwd !== confirmPwd ? '两次输入的新密码不一致'
          : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || !oldPwd || problem) return
    setBusy(true)
    try {
      onSaved(await changePassword(oldPwd, nextPwd))
    } catch (err) {
      toastError(err, '修改失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal size="sm" scroll="hidden" onClose={onClose} busy={busy} labelledBy={titleId} initialFocusSelector="input" className="flex flex-col">
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <h3 id={titleId} className="text-[16px] font-semibold tracking-tight text-ink">修改密码</h3>
          <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={onClose} aria-label="关闭修改密码弹窗">关闭</Button>
        </header>
        <div className="space-y-3.5 px-5 py-5">
          <Field label="原密码" type="password" value={oldPwd} onChange={(event) => setOldPwd(event.target.value)} required autoComplete="current-password" />
          <Field label="新密码" type="password" value={nextPwd} onChange={(event) => setNextPwd(event.target.value)} required autoComplete="new-password" hint="至少 10 位，含字母、数字和符号" />
          <Field label="再输一次新密码" type="password" value={confirmPwd} onChange={(event) => setConfirmPwd(event.target.value)} required autoComplete="new-password" />
          {problem && <p className="text-[13px] leading-5 text-danger">{problem}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!oldPwd || !nextPwd || !confirmPwd || problem !== null}
            disabledReason={problem ?? '请填写完整'}>确认修改</Button>
        </footer>
      </form>
    </Modal>
  )
}

const AVATAR_BOX = 288
const AVATAR_OUTPUT = 256
const HALF_PI = Math.PI / 2

function AvatarEditorModal({ src, onClose, onSaved }: { src: string; onClose: () => void; onSaved: (user: UserSummary) => void }) {
  const titleId = useId()
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [uploading, setUploading] = useState(false)
  const dragRef = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      setImg(image)
      setZoom(1)
      setRotation(0)
      setOffset({ x: 0, y: 0 })
    }
    image.src = src
  }, [src])

  const swapped = img ? Math.round(rotation / HALF_PI) % 2 !== 0 : false
  const base = img
    ? Math.max(
      AVATAR_BOX / (swapped ? img.naturalHeight : img.naturalWidth),
      AVATAR_BOX / (swapped ? img.naturalWidth : img.naturalHeight),
    )
    : 1

  function clampOffset(x: number, y: number, nextZoom: number) {
    if (!img) return { x: 0, y: 0 }
    const effW = (swapped ? img.naturalHeight : img.naturalWidth) * base * nextZoom
    const effH = (swapped ? img.naturalWidth : img.naturalHeight) * base * nextZoom
    const maxX = Math.max(0, (effW - AVATAR_BOX) / 2)
    const maxY = Math.max(0, (effH - AVATAR_BOX) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, x)), y: Math.min(maxY, Math.max(-maxY, y)) }
  }

  // 缩放 / 旋转后把画面拉回有效范围，避免拖出圆形裁剪框。
  useEffect(() => {
    setOffset((prev) => clampOffset(prev.x, prev.y, zoom))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, rotation, img])

  async function confirmCrop() {
    if (!img || uploading) return
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_OUTPUT
    canvas.height = AVATAR_OUTPUT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const ratio = AVATAR_OUTPUT / AVATAR_BOX
    ctx.translate(AVATAR_OUTPUT / 2 + offset.x * ratio, AVATAR_OUTPUT / 2 + offset.y * ratio)
    ctx.rotate(rotation)
    ctx.scale(base * zoom * ratio, base * zoom * ratio)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
    const dataUrl = canvas.toDataURL('image/png')
    const payload = dataUrl.slice(dataUrl.indexOf(',') + 1)
    if (payload.length * 3 / 4 > MAX_AVATAR_BYTES) {
      toast('裁剪结果超过 1MB，请缩小图片后重试', 'warning')
      return
    }
    setUploading(true)
    try {
      onSaved(await updateAvatar(payload))
    } catch (err) {
      toastError(err, '头像未更新')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Modal size="sm" scroll="hidden" onClose={onClose} busy={uploading} labelledBy={titleId} className="flex flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <h3 id={titleId} className="text-[16px] font-semibold tracking-tight text-ink">更换头像</h3>
        <Button size="sm" variant="ghost" type="button" disabled={uploading} onClick={onClose} aria-label="关闭头像编辑弹窗">关闭</Button>
      </header>
      <div className="space-y-4 px-5 py-5">
        <div className="flex justify-center">
          <div
            className="group relative h-72 w-72 cursor-grab touch-none select-none overflow-hidden rounded-full bg-surface-muted ring-1 ring-border ring-inset active:cursor-grabbing"
            onPointerDown={(event) => {
              dragRef.current = { px: event.clientX, py: event.clientY, ox: offset.x, oy: offset.y }
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current
              if (!drag) return
              setOffset(clampOffset(drag.ox + event.clientX - drag.px, drag.oy + event.clientY - drag.py, zoom))
            }}
            onPointerUp={() => { dragRef.current = null }}
            onPointerCancel={() => { dragRef.current = null }}
          >
            {img && (
              <img src={src} alt="" draggable={false} className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                style={{
                  width: img.naturalWidth * base * zoom,
                  height: img.naturalHeight * base * zoom,
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}rad)`,
                }} />
            )}
            <span className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-ink/10 ring-inset" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" type="button" disabled={uploading || !img}
            onClick={() => setRotation((value) => value + HALF_PI)}>旋转</Button>
          <input type="range" min={1} max={3} step={0.01} value={zoom} disabled={uploading || !img}
            onChange={(event) => setZoom(Number(event.target.value))} className="min-w-0 flex-1 accent-primary" aria-label="缩放" />
          <span className="tnum w-12 text-right text-[12px] text-ink-muted">{Math.round(zoom * 100)}%</span>
        </div>
        <p className="text-[12px] leading-5 text-ink-muted">
          拖动调整位置，滑动缩放；确认后裁剪为 {AVATAR_OUTPUT}×{AVATAR_OUTPUT} 的方形图。
        </p>
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3">
        <Button type="button" variant="ghost" disabled={uploading} onClick={onClose}>取消</Button>
        <Button type="button" variant="primary" loading={uploading} disabled={!img} disabledReason="图片尚未载入" onClick={() => void confirmCrop()}>确认</Button>
      </footer>
    </Modal>
  )
}

function ProviderSection({
  kind,
  rows,
  loading,
  form,
  busy,
  testing,
  results,
  onAdd,
  onEdit,
  onCancel,
  onChange,
  onSubmit,
  onTest,
  onToggle,
  onRemove,
}: {
  kind: ProviderKind
  rows: ProviderView[]
  loading: boolean
  form: FormState | null
  busy: boolean
  testing: number | null
  results: Record<number, ConnectionTestResult>
  onAdd: () => void
  onEdit: (row: ProviderView) => void
  onCancel: () => void
  onChange: (form: FormState) => void
  onSubmit: (event: React.FormEvent) => void
  onTest: (row: ProviderView) => void
  onToggle: (row: ProviderView) => void
  onRemove: (row: ProviderView) => void
}) {
  const copy = COPY[kind]
  const formTitleId = useId()
  return (
    <DataCard
      title={copy.title}
      description={copy.role}
      actions={
        rows.length === 0 ? (
          <Button size="sm" variant="primary" onClick={onAdd}>添加配置</Button>
        ) : undefined
      }
    >
      {form && (
        <Modal size="md" labelledBy={formTitleId} initialFocusSelector="input" onClose={onCancel} busy={busy}>
          <form onSubmit={onSubmit} className="space-y-3.5 p-5 sm:p-6">
            <div>
              <h3 id={formTitleId} className="text-[16px] font-semibold tracking-tight text-ink">
                {form.id === null ? `添加${copy.title}` : `编辑${copy.title}`}
              </h3>
              <p className="mt-1 text-[13px] leading-5 text-ink-muted">
                {form.id === null
                  ? '保存前会先测一次连通性；测不通就不落库。'
                  : '地址与密钥不可改；要换服务请新建一个配置。'}
              </p>
            </div>

            <Field label="名称（页面显示）" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} required placeholder={kind === 'llm' ? '例如：主力 GPT' : '例如：JEV 生产'} />

            {kind === 'llm' && form.id === null && (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">协议</span>
                <select
                  value={form.protocol}
                  onChange={(event) => onChange({ ...form, protocol: event.target.value as FormState['protocol'] })}
                  className={controlClass + ' cursor-pointer'}
                >
                  <option value="openai">OpenAI Chat Completions</option>
                  <option value="openai_responses">OpenAI Responses</option>
                  <option value="anthropic">Anthropic Messages</option>
                </select>
              </label>
            )}

            {form.id === null && (
              <>
                <Field
                  label={kind === 'llm' ? 'API Base URL' : '接口地址'}
                  value={form.endpoint_url}
                  onChange={(event) => onChange({ ...form, endpoint_url: event.target.value })}
                  required
                  placeholder={
                    kind === 'llm'
                      ? form.protocol === 'anthropic'
                        ? 'https://api.anthropic.com/v1'
                        : 'https://api.openai.com/v1'
                      : copy.address
                  }
                />
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="模型" value={form.model} onChange={(event) => onChange({ ...form, model: event.target.value })} required placeholder={form.protocol === 'anthropic' ? 'claude-sonnet-4-5' : copy.model} />
                  <Field label="API Key" type="password" value={form.api_key} onChange={(event) => onChange({ ...form, api_key: event.target.value })} required placeholder="sk-..." autoComplete="off" />
                </div>
              </>
            )}

            {kind === 'llm' && (
              <div className="rounded-[12px] border border-border-subtle bg-surface-muted/60">
                <div className="flex items-center justify-between gap-3 px-3.5 pt-3">
                  <div>
                    <p className="text-[13px] font-medium text-ink-secondary">上下文窗口</p>
                    <p className="mt-0.5 text-[12px] text-ink-muted">
                      决定历史对话能带多长，超出会被截断。
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {CONTEXT_PRESETS.map(([label, value]) => (
                      <button
                        key={label}
                        type="button"
                        className={`rounded-[7px] border px-2 py-0.5 text-[12px] transition-colors duration-150 ${
                          form.context_window_tokens === value
                            ? 'border-primary-border bg-primary-soft text-primary'
                            : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink-secondary'
                        }`}
                        onClick={() => onChange({ ...form, context_window_tokens: value })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="grid items-end gap-3 p-3.5 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">Token 数</span>
                    <input
                      type="number"
                      min={1000}
                      max={2000000}
                      value={form.context_window_tokens}
                      onChange={(event) => onChange({ ...form, context_window_tokens: Number(event.target.value) || 64000 })}
                      className={controlClass + ' tnum'}
                    />
                  </label>
                  {form.id === null && (
                    <label className="block">
                      <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">图片输入</span>
                      <select
                        value={form.supports_vision ? 'yes' : 'no'}
                        onChange={(event) => onChange({ ...form, supports_vision: event.target.value === 'yes' })}
                        className={controlClass + ' cursor-pointer'}
                      >
                        <option value="no">不支持</option>
                        <option value="yes">支持（可读聊天里的图片）</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>取消</Button>
              <Button type="submit" variant="primary" loading={busy}>{form.id === null ? '测试并保存' : '保存'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {loading ? (
        <ul className="space-y-3">
          {[0, 1].map((row) => (
            <li key={row} className="flex items-center gap-4">
              <span className="skeleton h-10 w-10 shrink-0 rounded-[11px]" />
              <span className="min-w-0 flex-1 space-y-2">
                <span className="skeleton block h-4 w-32" />
                <span className="skeleton block h-3.5 w-2/3" />
              </span>
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <EmptyState
          title={`还没有${copy.title}`}
          description={`${copy.role}。每种只能配一个，填好后会先测连通性。`}
          action={<Button size="sm" variant="primary" onClick={onAdd}>添加配置</Button>}
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const result = results[row.id]
            return (
              <li key={row.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
                  <span
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border border-border bg-surface-muted text-ink-secondary"
                    aria-hidden
                  >
                    {kind === 'llm' ? <IconSparkle className="h-5 w-5" /> : <IconDecide className="h-5 w-5" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-ink">{row.name}</span>
                      <StatusTag tone={row.last_test_ok ? 'success' : row.last_tested_at ? 'danger' : 'info'}>
                        {row.last_tested_at ? (row.last_test_ok ? '测试成功' : '测试失败') : '未测试'}
                      </StatusTag>
                      {!row.is_enabled && <StatusTag tone="info">已停用</StatusTag>}
                    </div>
                    <p className="mono mt-1.5 truncate text-[12px] text-ink-muted" title={row.endpoint_url}>
                      {row.endpoint_url}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-ink-secondary">
                      {kind === 'llm' && (
                        <span>{PROTOCOL_LABELS[row.protocol] ?? 'OpenAI'}</span>
                      )}
                      <span className="mono">{row.model}</span>
                      {kind === 'llm' && row.supports_vision && <span>· 可看图</span>}
                      {kind === 'llm' && <span>· 窗口 {formatTokens(row.context_window_tokens)}</span>}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-2.5">
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-secondary">
                      <span>{row.is_enabled ? '已启用' : '已停用'}</span>
                      <Switch
                        checked={row.is_enabled}
                        label={row.is_enabled ? `停用${row.name}` : `启用${row.name}`}
                        onChange={() => void onToggle(row)}
                      />
                    </label>
                    <div className="flex items-center gap-0.5">
                      <Button size="sm" variant="ghost" loading={testing === row.id} onClick={() => void onTest(row)}>测试</Button>
                      <Button size="sm" variant="ghost" onClick={() => onEdit(row)}>编辑</Button>
                      <Button size="sm" variant="ghost-danger" onClick={() => void onRemove(row)}>删除</Button>
                    </div>
                  </div>
                </div>

                {result && <TestResult result={result} />}
              </li>
            )
          })}
        </ul>
      )}
    </DataCard>
  )
}

/** 连通性测试结果：结论、耗时、诊断文本与健康度条。 */
function TestResult({ result }: { result: ConnectionTestResult }) {
  const health = result.smoke ? Math.max(0, Math.min(100, result.smoke.health)) : 0
  return (
    <div
      className={`mt-3 rounded-[10px] border px-3.5 py-3 ${
        result.ok ? 'border-success/20 bg-success-soft/60' : 'border-danger/20 bg-danger-soft/60'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusTag tone={result.ok ? 'success' : 'danger'}>
          {result.ok ? '连接成功' : '连接失败'}
        </StatusTag>
        <span className="tnum text-[12px] text-ink-muted">耗时 {result.latency_ms} ms</span>
      </div>
      <p className="mt-2 text-[13px] leading-5 text-ink-secondary">{result.detail}</p>
      {result.smoke && (
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-ink-muted">健康度</span>
            <span className="tnum text-ink">
              {result.smoke.health}%
              <span className="ml-1 text-ink-muted">（{result.smoke.passed}/{result.smoke.total} 通过）</span>
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface/80">
            <div
              className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                health >= 80 ? 'bg-success' : health >= 50 ? 'bg-warning' : 'bg-danger'
              }`}
              style={{ width: `${health}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
