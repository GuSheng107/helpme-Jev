import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  createScenario,
  deleteScenario,
  listAllScenarios,
  updateScenario,
  type CustomScenario,
} from '../api/scenarios'
import Button from '../components/Button'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell } from '../components/layout'

const KIND_LABELS: Record<string, string> = {
  romance: '恋爱',
  workplace: '职场',
  custom: '自定义',
  general: '通用',
}

interface Props {
  onBack: () => void
}

export default function ScenarioPage({ onBack }: Props) {
  const [rows, setRows] = useState<CustomScenario[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [questionsJson, setQuestionsJson] = useState('')
  const [copyingId, setCopyingId] = useState<number | null>(null)
  const [copyName, setCopyName] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function reload() {
    listAllScenarios()
      .then(setRows)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : '场景未能载入'))
  }

  useEffect(reload, [])

  function startEdit(row: CustomScenario) {
    setEditingId(row.id)
    setName(row.name)
    setDescription(row.description)
    setQuestionsJson(row.judge_questions ?? '')
    setError(null)
    setNotice('')
  }

  function startCopy(row: CustomScenario) {
    setCopyingId(row.id)
    setCopyName(`${row.name}（副本）`)
    setError(null)
  }

  async function copy() {
    if (copyingId === null || !copyName.trim()) return
    setBusy(true)
    setError(null)
    try {
      await createScenario(copyName.trim(), copyingId)
      reload()
      setNotice('已复制，现在可以自由改题')
      setCopyingId(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '复制未完成')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (editingId === null) return
    setBusy(true)
    setError(null)
    try {
      await updateScenario(editingId, {
        name: name.trim(),
        description: description.trim(),
        judge_questions: questionsJson.trim(),
      })
      reload()
      setNotice('题集已保存')
      setEditingId(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存未完成')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (confirmDeleteId === null) return
    setBusy(true)
    setError(null)
    try {
      await deleteScenario(confirmDeleteId)
      reload()
      setNotice('场景已删除；使用它的会话回到默认场景')
      setConfirmDeleteId(null)
      if (editingId === confirmDeleteId) setEditingId(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除未完成')
    } finally {
      setBusy(false)
    }
  }

  const editing = rows.find((row) => row.id === editingId) ?? null

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="自定义场景"
          description="复制任一预设场景后自由改题；新建会话时就能选它。"
          actions={<Button onClick={onBack}>返回</Button>}
        />
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && (
          <div className="mb-3">
            <Notice tone="info">{notice}</Notice>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState title="还没有场景" description="刷新一下，或联系管理员。" />
        ) : (
          <div className="space-y-3">
            {rows.map((row) => (
              <DataCard key={row.id} title={row.name}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-[4px] bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-muted">
                    {row.is_builtin ? '内置' : KIND_LABELS[row.kind] ?? row.kind}
                  </span>
                  <span className="text-[13px] text-ink-secondary">{row.description}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {copyingId === row.id ? (
                    <>
                      <input
                        className="w-44 rounded-[6px] border border-border px-2 py-1 text-[14px]"
                        value={copyName}
                        onChange={(event) => setCopyName(event.target.value)}
                        placeholder="新场景的名字"
                      />
                      <Button size="sm" variant="primary" loading={busy} disabled={!copyName.trim()} disabledReason="请输入名字" onClick={() => void copy()}>
                        复制
                      </Button>
                      <Button size="sm" onClick={() => setCopyingId(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => startCopy(row)}>
                        复制
                      </Button>
                      {!row.is_builtin && (
                        <>
                          {editingId === row.id ? (
                            <Button size="sm" onClick={() => setEditingId(null)}>
                              收起编辑
                            </Button>
                          ) : (
                            <Button size="sm" onClick={() => startEdit(row)}>
                              改题
                            </Button>
                          )}
                          {confirmDeleteId === row.id ? (
                            <>
                              <Button size="sm" variant="danger" loading={busy} onClick={() => void remove()}>
                                确认删除
                              </Button>
                              <Button size="sm" onClick={() => setConfirmDeleteId(null)}>
                                手滑了
                              </Button>
                            </>
                          ) : (
                            <Button size="sm" variant="danger" onClick={() => setConfirmDeleteId(row.id)}>
                              删除
                            </Button>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>
                {editingId === row.id && editing && (
                  <div className="mt-3 space-y-2 border-t border-border-subtle pt-3">
                    <div>
                      <span className="mb-1 block text-[12px] text-ink-muted">名字</span>
                      <input
                        className="w-full rounded-[6px] border border-border px-2 py-1.5 text-[14px]"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[12px] text-ink-muted">描述</span>
                      <input
                        className="w-full rounded-[6px] border border-border px-2 py-1.5 text-[14px]"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                      />
                    </div>
                    <div>
                      <span className="mb-1 block text-[12px] text-ink-muted">判断题集（JSON）</span>
                      <textarea
                        className="mono min-h-56 w-full rounded-[6px] border border-border p-2 text-[12px] leading-5"
                        value={questionsJson}
                        onChange={(event) => setQuestionsJson(event.target.value)}
                        spellCheck={false}
                      />
                      <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                        每道题：{'{ type: "noul|choice|score", instructions: 英文判别说明, criteria: …, title: 中文标题, labels: { 枚举值: 中文 } }'}。
                        title / labels 只用于展示，发给 Jev 前会剥掉。内置场景复制时已自动带上中文。
                      </p>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" onClick={() => startEdit(row)}>
                        重置
                      </Button>
                      <Button size="sm" variant="primary" loading={busy} onClick={() => void save()}>
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </DataCard>
            ))}
          </div>
        )}
      </PageBody>
    </PageShell>
  )
}
