import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
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
import Field from '../components/Field'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

interface Props {
  onLogout: () => void
  onBack: () => void
}

interface FormState {
  id: number | null
  kind: ProviderKind
  name: string
  endpoint_url: string
  api_key: string
  model: string
  supports_vision: boolean
  context_window_tokens: number
}

const BLANK: FormState = {
  id: null,
  kind: 'jev',
  name: '',
  endpoint_url: '',
  api_key: '',
  model: '',
  supports_vision: false,
  context_window_tokens: 64000,
}

export default function SettingsPage({ onLogout, onBack }: Props) {
  const [rows, setRows] = useState<ProviderView[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<number | null>(null)
  const [results, setResults] = useState<Record<number, ConnectionTestResult>>({})

  const reload = useCallback(async () => {
    try {
      setRows(await listProviders())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败')
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
    setError(null)
    try {
      if (form.id === null) {
        await createProvider({
          kind: form.kind,
          name: form.name,
          endpoint_url: form.endpoint_url,
          api_key: form.api_key,
          model: form.model,
          supports_vision: form.supports_vision,
          context_window_tokens: form.context_window_tokens,
        })
      } else {
        // 不传 api_key 表示保持原值
        const payload: Record<string, unknown> = {
          name: form.name,
          endpoint_url: form.endpoint_url,
          model: form.model,
          supports_vision: form.supports_vision,
          context_window_tokens: form.context_window_tokens,
        }
        if (form.api_key) payload.api_key = form.api_key
        await updateProvider(form.id, payload)
      }
      setForm(null)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function runTest(row: ProviderView) {
    setTesting(row.id)
    setError(null)
    try {
      const result = await testProvider(row.id, row.kind === 'jev')
      setResults((prev) => ({ ...prev, [row.id]: result }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '测试失败')
    } finally {
      setTesting(null)
    }
  }

  async function remove(row: ProviderView) {
    if (!window.confirm(`确认删除配置「${row.name}」？该操作不可撤销。`)) return
    try {
      await deleteProvider(row.id)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  return (
    <PageShell>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-[52px] max-w-5xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <button type="button" className="text-[13px] text-primary" onClick={onBack}>
              返回
            </button>
            <span className="text-[16px] font-semibold leading-6 text-ink">系统设置</span>
          </div>
          <Button size="sm" onClick={onLogout}>
            退出
          </Button>
        </div>
      </header>

      <PageBody>
        <PageHeader
          title="提供方配置"
          description="JEV 与 LLM 均为自配端点（完整 URL + Key + 模型），系统不做任何 provider 预设。"
          actions={
            <Button variant="primary" onClick={() => setForm({ ...BLANK })}>
              新增配置
            </Button>
          }
        />

        {error && (
          <div className="mb-4">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}

        {form && (
          <div className="mb-4">
            <DataCard title={form.id === null ? '新增配置' : `编辑配置 #${form.id}`}>
              <form onSubmit={submit} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">
                      类型
                    </span>
                    <select
                      value={form.kind}
                      disabled={form.id !== null}
                      onChange={(e) => setForm({ ...form, kind: e.target.value as ProviderKind })}
                      className="h-9 w-full rounded-[6px] border border-border bg-surface px-3 disabled:bg-surface-muted"
                    >
                      <option value="jev">JEV（System One 决策模型）</option>
                      <option value="llm">LLM（OpenAI 兼容）</option>
                    </select>
                  </label>
                  <Field
                    label="名称"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="便于自己辨认，如「主 JEV」"
                    required
                  />
                </div>

                <Field
                  label="完整端点 URL"
                  value={form.endpoint_url}
                  onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
                  placeholder={
                    form.kind === 'jev'
                      ? 'https://api.typesafe.ai/v1/systemone'
                      : 'https://api.example.com/v1/chat/completions'
                  }
                  required
                  hint="系统不做路径拼接，请填完整地址"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="模型"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder={form.kind === 'jev' ? 'jev-latest' : 'gpt-4o-mini'}
                    required
                    hint={form.kind === 'jev' ? '建议钉住版本 ID（别名会漂）' : undefined}
                  />
                  <Field
                    label="API Key"
                    type="password"
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    required={form.id === null}
                    placeholder={form.id === null ? '粘贴 Key' : '留空表示保持原值'}
                    hint={form.id === null ? '加密存储，接口只回掩码' : '留空即保持原密钥不变'}
                  />
                </div>

                {form.kind === 'llm' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="上下文窗口（token）"
                      type="number"
                      value={String(form.context_window_tokens)}
                      onChange={(e) =>
                        setForm({ ...form, context_window_tokens: Number(e.target.value) || 64000 })
                      }
                      hint="按你模型的实际窗口填，默认 64K"
                    />
                    <label className="flex items-center gap-2 pt-6 text-[13px] text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={form.supports_vision}
                        onChange={(e) => setForm({ ...form, supports_vision: e.target.checked })}
                      />
                      支持图片（多模态）
                    </label>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button type="submit" variant="primary" loading={busy}>
                    保存
                  </Button>
                  <Button type="button" onClick={() => setForm(null)}>
                    取消
                  </Button>
                </div>
              </form>
            </DataCard>
          </div>
        )}

        <DataCard title="已配置的提供方">
          {loading ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">加载中…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="还没有任何配置"
              description="添加一个 JEV 端点用于决策，再添加一个 LLM 端点用于生成文本。两者都需自备 URL 与 Key。"
              action={
                <Button variant="primary" onClick={() => setForm({ ...BLANK })}>
                  新增配置
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const result = results[row.id]
                return (
                  <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-ink">{row.name}</span>
                          <StatusTag tone={row.kind === 'jev' ? 'primary' : 'info'}>
                            {row.kind === 'jev' ? 'JEV' : 'LLM'}
                          </StatusTag>
                          {row.is_default && <StatusTag tone="success">默认</StatusTag>}
                        </div>
                        <p className="mono mt-1 truncate text-[13px] text-ink-muted">
                          {row.endpoint_url}
                        </p>
                        <p className="mono mt-0.5 text-[13px] text-ink-muted">
                          模型 {row.model} · Key {row.api_key_masked}
                          {row.kind === 'llm' && ` · 窗口 ${row.context_window_tokens}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          loading={testing === row.id}
                          onClick={() => void runTest(row)}
                        >
                          测试连通
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            setForm({
                              id: row.id,
                              kind: row.kind,
                              name: row.name,
                              endpoint_url: row.endpoint_url,
                              api_key: '',
                              model: row.model,
                              supports_vision: row.supports_vision,
                              context_window_tokens: row.context_window_tokens,
                            })
                          }
                        >
                          编辑
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => void remove(row)}>
                          删除
                        </Button>
                      </div>
                    </div>

                    {result && (
                      <div className="mt-3 rounded-[6px] bg-surface-muted p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusTag tone={result.ok ? 'success' : 'danger'}>
                            {result.ok ? '测试通过' : '测试失败'}
                          </StatusTag>
                          <span className="text-[13px] text-ink-secondary">
                            耗时 {result.latency_ms} ms
                          </span>
                          {result.model_reported && (
                            <span className="mono text-[13px] text-ink-muted">
                              作答模型 {result.model_reported}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
                          {result.detail}
                        </p>

                        {result.smoke && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] text-ink-secondary">健康度</span>
                              <span
                                className={`mono text-[14px] font-medium ${
                                  result.smoke.health >= 80 ? 'text-success' : 'text-warning'
                                }`}
                              >
                                {result.smoke.health}%
                              </span>
                              <span className="text-[13px] text-ink-muted">
                                ({result.smoke.passed}/{result.smoke.total} 通过)
                              </span>
                            </div>
                            <ul className="mt-2 space-y-1">
                              {result.smoke.outcomes.map((item) => (
                                <li key={item.name} className="flex items-center gap-2 text-[13px]">
                                  <StatusTag tone={item.passed ? 'success' : 'danger'}>
                                    {item.passed ? '通过' : '未过'}
                                  </StatusTag>
                                  <span className="text-ink-secondary">{item.name}</span>
                                  <span className="mono text-ink-muted">
                                    期望 {item.expected} · 实际 {item.actual}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </DataCard>
      </PageBody>
    </PageShell>
  )
}
