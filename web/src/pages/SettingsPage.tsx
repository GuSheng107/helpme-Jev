import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { avatarDataUrl, changePassword, updateAvatar, updateProfile, type UserSummary } from '../api/auth'
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
import { toast, toastError } from '../components/toast'
import Field from '../components/Field'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

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

const COPY: Record<ProviderKind, { title: string; address: string; model: string; test: string }> = {
  llm: {
    title: '表达模型',
    address: 'https://api.example.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    test: '发一条最小对话，确认地址、密钥和模型可用。',
  },
  jev: {
    title: '决策模型',
    address: 'https://api.typesafe.ai/v1/systemone',
    model: 'jev-latest',
    test: '先确认协议连通，再跑一组标准用例，给出健康度。',
  },
}

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

/** 设置：表达模型和决策模型完全分开，下面只留账号自己的数据操作。 */
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
      let saved: ProviderView
      if (form.id === null) {
        saved = await createProvider({
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
      } else {
        const payload: Record<string, unknown> = {
          protocol: form.kind === 'llm' ? form.protocol : 'openai',
          name: form.name,
          endpoint_url: form.endpoint_url,
          model: form.model,
        }
        if (form.kind === 'llm') {
          payload.supports_vision = form.supports_vision
          payload.context_window_tokens = form.context_window_tokens
        }
        if (form.api_key) payload.api_key = form.api_key
        saved = await updateProvider(form.id, payload)
      }
      const checked = await testProvider(saved.id)
      setResults((prev) => ({ ...prev, [saved.id]: checked }))
      if (!checked.ok) {
        if (form.id === null) {
          await deleteProvider(saved.id)
          toast(checked.detail || '连通性测试未通过，配置未保存', 'danger')
        } else {
          await reload()
          toast(`配置已保存但已停用：${checked.detail || '连通性测试未通过'}`, 'danger')
        }
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
      toast(result.ok ? '连接成功' : result.detail || '连接失败', result.ok ? 'success' : 'danger')
    } catch (err) {
      toastError(err, '连接失败')
    } finally {
      setTesting(null)
    }
  }

  async function toggle(row: ProviderView) {
    if (!row.is_enabled && row.last_test_ok !== true) {
      toast('连通性测试通过后才能启用', 'danger')
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
    if (!window.confirm(`删除「${row.name}」？删除后需要重新填写。`)) return
    try {
      await deleteProvider(row.id)
      await reload()
      toast('已删除')
    } catch (err) {
      toastError(err, '删除失败')
    }
  }

  async function downloadExport(format: 'json' | 'markdown') {
    setExporting(true)
    try {
      const blob = await exportAccountData(format)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `helpme-jev-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'md'}`
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
      <PageBody>
        <PageHeader title="设置" description="账号、表达模型和决策模型。" />
        <div className="mb-4">
          <AccountCard user={user} onUserChange={onUserChange} />
        </div>
        <div className="space-y-4">
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

          <DataCard title="导出数据">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] leading-5 text-ink-secondary">
                下载原始 JSON 数据，或生成便于阅读的 Markdown 摘要。
              </p>
              <Button size="sm" loading={exporting} onClick={() => void downloadExport('json')}>
                下载 JSON
              </Button>
              <Button size="sm" loading={exporting} onClick={() => void downloadExport('markdown')}>
                下载 Markdown
              </Button>
            </div>
          </DataCard>

          <DataCard title="注销账号">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] leading-5 text-ink-secondary">
                账号、会话、人设和配置会全部删除，无法恢复。建议先下载一份数据。
              </p>
              <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                注销账号
              </Button>
            </div>
          </DataCard>
          {confirmDelete && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 px-4" onClick={() => setConfirmDelete(false)}>
              <form
                className="w-full max-w-md space-y-4 rounded-[10px] border border-border bg-surface p-5 shadow-[0_16px_48px_rgb(15_23_42/0.18)]"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault()
                  void destroyAccount()
                }}
              >
                <h3 className="text-[16px] font-semibold text-ink">确认注销</h3>
                <p className="text-[13px] leading-5 text-ink-secondary">
                  将删除该账号下的全部数据，包括会话、人设、记忆、配置和上传的图片，并退出登录。此操作无法恢复。
                </p>
                <Field label="登录密码" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
                <div className="flex justify-end gap-2">
                  <Button type="button" onClick={() => { setConfirmDelete(false); setConfirmPassword('') }}>取消</Button>
                  <Button type="submit" variant="danger" loading={deleting} disabled={!confirmPassword} disabledReason="请输入密码">
                    确认注销
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}

const MAX_AVATAR_BYTES = 1024 * 1024

function AccountCard({
  user,
  onUserChange,
}: {
  user: UserSummary
  onUserChange: (user: UserSummary) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [displayName, setDisplayName] = useState(user.display_name)
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [busy, setBusy] = useState(false)

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

  async function savePassword(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      onUserChange(await changePassword(oldPassword, newPassword))
      setOldPassword('')
      setNewPassword('')
      toast('密码已修改')
    } catch (err) {
      toastError(err, '修改失败')
    } finally {
      setBusy(false)
    }
  }

  function pickAvatar(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_AVATAR_BYTES) {
      toast('头像不能超过 1MB')
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      const raw = String(reader.result || '')
      const payload = raw.includes(',') ? raw.split(',')[1] : raw
      setBusy(true)
      try {
        onUserChange(await updateAvatar(payload))
        toast('头像已更新')
      } catch (err) {
        toastError(err, '头像未更新')
      } finally {
        setBusy(false)
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <DataCard title="账号">
      <div className="flex items-center gap-4">
        {user.avatar_base64 ? (
          <img src={avatarDataUrl(user.avatar_base64)} alt="" className="h-14 w-14 rounded-full object-cover" />
        ) : (
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary text-[18px] font-medium text-white">
            {(user.display_name || user.username).slice(0, 1)}
          </span>
        )}
        <div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(event) => pickAvatar(event.target.files?.[0])} />
          <Button size="sm" loading={busy} onClick={() => fileRef.current?.click()}>更换头像</Button>
          <p className="mt-1 text-[12px] text-ink-muted">PNG 或 JPEG，不超过 1MB。没有头像时显示昵称首字。</p>
        </div>
      </div>
      <form onSubmit={saveProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="用户名" value={user.username} disabled hint="登录名创建后不可修改" />
        <Field label="昵称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        <div><Button type="submit" size="sm" variant="primary" loading={busy}>保存资料</Button></div>
      </form>
      <form onSubmit={savePassword} className="mt-4 grid gap-3 border-t border-border-subtle pt-4 sm:grid-cols-2">
        <Field label="原密码" type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required />
        <Field label="新密码" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required hint="至少 10 位，含字母、数字和符号" />
        <div><Button type="submit" size="sm" loading={busy} disabled={!oldPassword || !newPassword} disabledReason="请填写原密码和新密码">修改密码</Button></div>
      </form>
    </DataCard>
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
  return (
    <DataCard
      title={copy.title}
      actions={rows.length === 0 ? <Button size="sm" variant="primary" onClick={onAdd}>添加</Button> : undefined}
    >
      <p className="mb-3 text-[13px] text-ink-muted">{copy.test}</p>
      {form && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/30 px-4" onClick={onCancel}>
          <form
            onSubmit={onSubmit}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-lg space-y-3 rounded-[10px] border border-border bg-surface p-5 shadow-[0_16px_48px_rgb(15_23_42/0.18)]"
          >
            <h3 className="text-[16px] font-semibold text-ink">{form.id === null ? `添加${copy.title}` : `编辑${copy.title}`}</h3>
            <Field label="名称" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} required />
            {kind === 'llm' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">协议</span>
                  <select
                    value={form.protocol}
                    onChange={(event) => onChange({ ...form, protocol: event.target.value as FormState['protocol'] })}
                    className="h-9 w-full rounded-[6px] border border-border bg-surface px-3"
                  >
                    <option value="openai">OpenAI Chat Completions</option>
                    <option value="openai_responses">OpenAI Responses</option>
                    <option value="anthropic">Anthropic Messages</option>
                  </select>
                </label>
              </div>
            )}
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
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="模型" value={form.model} onChange={(event) => onChange({ ...form, model: event.target.value })} required placeholder={form.protocol === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini'} />
              <Field label="API Key" type="password" value={form.api_key} onChange={(event) => onChange({ ...form, api_key: event.target.value })} required={form.id === null} placeholder={form.id === null ? 'sk-...' : '留空则保持不变'} />
            </div>
            {kind === 'llm' && (
              <details className="rounded-[8px] border border-border">
                <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-ink-secondary">高级配置</summary>
                <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-[13px] font-medium text-ink-secondary">上下文窗口</span>
                      <span className="flex gap-1">
                        {[['128K', 131072], ['256K', 262144], ['1M', 1048576]].map(([label, value]) => (
                          <button key={label} type="button" className="rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-muted hover:text-primary" onClick={() => onChange({ ...form, context_window_tokens: Number(value) })}>
                            {label}
                          </button>
                        ))}
                      </span>
                    </div>
                    <input
                      type="number"
                      value={form.context_window_tokens}
                      onChange={(event) => onChange({ ...form, context_window_tokens: Number(event.target.value) || 64000 })}
                      className="h-9 w-full rounded-[6px] border border-border bg-surface px-3"
                    />
                  </div>
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">图片输入</span>
                    <select
                      value={form.supports_vision ? 'yes' : 'no'}
                      onChange={(event) => onChange({ ...form, supports_vision: event.target.value === 'yes' })}
                      className="h-9 w-full rounded-[6px] border border-border bg-surface px-3"
                    >
                      <option value="no">不支持</option>
                      <option value="yes">支持</option>
                    </select>
                  </label>
                </div>
              </details>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" onClick={onCancel}>取消</Button>
              <Button type="submit" variant="primary" loading={busy}>保存</Button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <p className="py-4 text-center text-[13px] text-ink-muted">加载中…</p>
      ) : rows.length === 0 ? (
        <EmptyState title={`还没有${copy.title}`} description="每种只能配置一个。" />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const result = results[row.id]
            return (
              <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                <div>
                  <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{row.name}</span>
                      <StatusTag tone={row.last_test_ok ? 'success' : row.last_tested_at ? 'danger' : 'info'}>
                        {row.last_tested_at ? (row.last_test_ok ? '测试成功' : '测试失败') : '未测试'}
                      </StatusTag>
                    </div>
                    <p className="mono mt-1 truncate text-[13px] text-ink-muted">{row.endpoint_url}</p>
                    <p className="mono mt-0.5 text-[13px] text-ink-muted">
                      {kind === 'llm' && `${{ openai: 'OpenAI', openai_responses: 'OpenAI Responses', anthropic: 'Anthropic' }[row.protocol] ?? 'OpenAI'} · `}
                      {row.model}
                      {kind === 'llm' && row.supports_vision ? ' · 可看图' : ''}
                    </p>
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                  <span className="text-[13px] text-ink-secondary">{row.is_enabled ? '已启用' : '已停用'}</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={row.is_enabled}
                    aria-label={row.is_enabled ? '停用' : '启用'}
                    onClick={() => void onToggle(row)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${row.is_enabled ? 'bg-[#409eff]' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${row.is_enabled ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" loading={testing === row.id} onClick={() => void onTest(row)}>测试</Button>
                  <Button size="sm" onClick={() => onEdit(row)}>编辑</Button>
                  <Button size="sm" variant="danger" onClick={() => void onRemove(row)}>删除</Button>
                </div>
                {result && (
                  <div className="mt-3 rounded-[6px] bg-surface-muted p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusTag tone={result.ok ? 'success' : 'danger'}>{result.ok ? '连接成功' : '连接失败'}</StatusTag>
                      <span className="text-[13px] text-ink-secondary">耗时 {result.latency_ms} ms</span>
                    </div>
                    <p className="mt-2 text-[13px] leading-5 text-ink-secondary">{result.detail}</p>
                    {result.smoke && (
                      <p className="mt-2 text-[13px] text-ink-secondary">
                        健康度 {result.smoke.health}%（{result.smoke.passed}/{result.smoke.total} 通过）
                      </p>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </DataCard>
  )
}
