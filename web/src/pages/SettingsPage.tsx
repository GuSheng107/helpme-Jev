import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  forgetMemory,
  listMemories,
  listReflections,
  revertReflection,
  type MemoryItem,
  type Reflection,
} from '../api/chat'
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
  const [memories, setMemories] = useState<MemoryItem[]>([])
  const [reflections, setReflections] = useState<Reflection[]>([])

  const reload = useCallback(async () => {
    try {
      const [providers, noted, history] = await Promise.all([
        listProviders(),
        listMemories(),
        listReflections(),
      ])
      setRows(providers)
      setMemories(noted.items)
      setReflections(history)
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

  async function undoReflection(id: number) {
    try {
      await revertReflection(id)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '撤销失败')
    }
  }

  async function dropMemory(id: number) {
    try {
      await forgetMemory(id)
      setMemories((current) => current.filter((item) => item.id !== id))
      setReflections(await listReflections())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function runTest(row: ProviderView) {
    setTesting(row.id)
    setError(null)
    try {
      const result = await testProvider(row.id, row.kind === 'jev')
      setResults((prev) => ({ ...prev, [row.id]: result }))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '连接失败')
    } finally {
      setTesting(null)
    }
  }

  async function remove(row: ProviderView) {
    if (!window.confirm(`删除「${row.name}」？删除后需要重新填写。`)) return
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
            <span className="text-[16px] font-semibold leading-6 text-ink">设置</span>
          </div>
          <Button size="sm" onClick={onLogout}>
            退出
          </Button>
        </div>
      </header>

      <PageBody>
        <PageHeader
          title="连接"
          description="判断和生成文本各需填写地址、密钥与模型。"
          actions={
            <Button variant="primary" onClick={() => setForm({ ...BLANK })}>
              添加
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
            <DataCard title={form.id === null ? '添加连接' : '修改连接'}>
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
                      <option value="jev">判断</option>
                      <option value="llm">写句子</option>
                    </select>
                  </label>
                  <Field
                    label="名称"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="便于识别的名称"
                    required
                  />
                </div>

                <Field
                  label="地址"
                  value={form.endpoint_url}
                  onChange={(e) => setForm({ ...form, endpoint_url: e.target.value })}
                  placeholder={
                    form.kind === 'jev'
                      ? 'https://api.typesafe.ai/v1/systemone'
                      : 'https://api.example.com/v1/chat/completions'
                  }
                  required
                  hint="请填写完整地址"
                />

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="模型名"
                    value={form.model}
                    onChange={(e) => setForm({ ...form, model: e.target.value })}
                    placeholder={form.kind === 'jev' ? 'jev-latest' : 'gpt-4o-mini'}

                    required
                    hint={form.kind === 'jev' ? '建议填写具体版本，jev-latest 会随官方更新变化' : undefined}
                  />
                  <Field
                    label="密钥"
                    type="password"
                    value={form.api_key}
                    onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                    required={form.id === null}
                    placeholder={form.id === null ? '粘贴密钥' : '留空则保持不变'}
                    hint={form.id === null ? '仅保存在本机，保存后不再显示全文' : '留空则保持原密钥'}
                  />
                </div>

                {form.kind === 'llm' && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label="上下文长度"
                      type="number"
                      value={String(form.context_window_tokens)}
                      onChange={(e) =>
                        setForm({ ...form, context_window_tokens: Number(e.target.value) || 64000 })
                      }
                      hint="按该模型的上下文长度填写，不确定可保持默认"
                    />
                    <label className="flex items-center gap-2 pt-6 text-[13px] text-ink-secondary">
                      <input
                        type="checkbox"
                        checked={form.supports_vision}
                        onChange={(e) => setForm({ ...form, supports_vision: e.target.checked })}
                      />
                      支持图片
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

        <div className="mb-4">
          <DataCard title="已记录">
            {memories.length === 0 ? (
              <EmptyState title="暂无记录" description="判断完成后，相关事实会自动记录在这里。" />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {memories.map((item) => (
                  <li key={item.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                    <div>
                      <p className="text-[14px] leading-[22px] text-ink">{item.content}</p>
                      <p className="mt-0.5 text-[13px] leading-5 text-ink-muted">
                        {item.subject}
                        {item.counterpart_key ? ` · ${item.counterpart_key}` : ''} · {item.category}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => void dropMemory(item.id)}>
                      删除
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </DataCard>
        </div>

        {reflections.some((item) => !item.reverted_at && item.changes.some((change) => change.content)) && (
          <div className="mb-4">
            <DataCard title="最近变更">
              <ul className="space-y-3">
                {reflections
                  .filter((item) => !item.reverted_at)
                  .map((item, index) => {
                    const lines = item.changes.filter((change) => change.content && !change.skipped)
                    if (lines.length === 0) return null
                    return (
                      <li key={item.id} className="flex items-start justify-between gap-3">
                        <ul>
                          {lines.map((change, line) => (
                            <li key={line} className="text-[14px] leading-[22px] text-ink">
                              {change.content}
                            </li>
                          ))}
                        </ul>
                        {index === 0 && (
                          <Button size="sm" onClick={() => void undoReflection(item.id)}>
                            撤销
                          </Button>
                        )}
                      </li>
                    )
                  })}
              </ul>
            </DataCard>
          </div>
        )}

        <DataCard title="已添加">
          {loading ? (
            <p className="py-6 text-center text-[13px] text-ink-muted">加载中…</p>
          ) : rows.length === 0 ? (
            <EmptyState
              title="尚未添加连接"
              description="请先添加「判断」，再添加「写句子」。地址与密钥由你自行提供。"
              action={
                <Button variant="primary" onClick={() => setForm({ ...BLANK })}>
                  添加
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
                            {row.kind === 'jev' ? '判断' : '写句子'}
                          </StatusTag>
                          {row.is_default && <StatusTag tone="success">默认</StatusTag>}
                        </div>
                        <p className="mono mt-1 truncate text-[13px] text-ink-muted">
                          {row.endpoint_url}
                        </p>
                        <p className="mono mt-0.5 text-[13px] text-ink-muted">
                          {row.model} · {row.api_key_masked}
                          {row.kind === 'llm' && ` · 窗口 ${row.context_window_tokens}`}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button
                          size="sm"
                          loading={testing === row.id}
                          onClick={() => void runTest(row)}
                        >
                          测试连接
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
                            {result.ok ? '连接成功' : '连接失败'}
                          </StatusTag>
                          <span className="text-[13px] text-ink-secondary">
                            耗时 {result.latency_ms} ms
                          </span>
                          {result.model_reported && (
                            <span className="mono text-[13px] text-ink-muted">
                              {result.model_reported}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
                          {result.detail}
                        </p>

                        {result.smoke && (
                          <div className="mt-3">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] text-ink-secondary">准确率</span>
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
