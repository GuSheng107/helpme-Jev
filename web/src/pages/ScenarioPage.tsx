import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { deleteScenario, listAllScenarios, type CustomScenario } from '../api/scenarios'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import { DataCard, Notice, PageBody, PageHeader, PageShell } from '../components/layout'
import Modal from '../components/Modal'
import ScenarioEditor from './ScenarioEditor'
import { questionCount, QuestionSetView } from './ScenarioQuestions'

type EditorTarget = { mode: 'new' | 'copy' | 'edit'; source?: CustomScenario }
type ViewTab = 'prompt' | 'judge' | 'persona'
const viewTabs: { key: ViewTab; label: string }[] = [
  { key: 'prompt', label: '回复提示词' },
  { key: 'judge', label: '判断题集' },
  { key: 'persona', label: '人设题集' },
]

export default function ScenarioPage() {
  const [rows, setRows] = useState<CustomScenario[]>([])
  const [loading, setLoading] = useState(true)
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [view, setView] = useState<CustomScenario | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [deletingId, setDeletingId] = useState<number | null>(null)

  async function reload() {
    try {
      setRows(await listAllScenarios())
      setError('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '场景未能载入')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void reload() }, [])

  async function remove(row: CustomScenario) {
    if (!await confirmAction({
      title: '删除场景',
      message: `删除「${row.name}」？使用它的会话将回到默认场景。`,
      confirmText: '确认删除',
      tone: 'danger',
    })) return
    setDeletingId(row.id)
    setError('')
    try {
      await deleteScenario(row.id)
      if (editor?.source?.id === row.id) setEditor(null)
      if (view?.id === row.id) setView(null)
      setNotice('场景已删除；使用它的会话回到默认场景')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除未完成')
    } finally {
      setDeletingId(null)
    }
  }

  const builtins = rows.filter((row) => row.is_builtin)
  const customs = rows.filter((row) => !row.is_builtin)
  const openEditor = (target: EditorTarget) => { setEditor(target); setNotice('') }

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="场景"
          description="查看系统内置场景，或创建自己的场景。"
          actions={<Button size="sm" variant="primary" onClick={() => openEditor({ mode: 'new' })}>新建场景</Button>}
        />
        {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
        {notice && <div className="mb-3"><Notice tone="success">{notice}</Notice></div>}
        <div className="space-y-4">
          <ScenarioGroup title="系统内置" rows={builtins} loading={loading} empty="还没有内置场景"
            onView={setView} onCopy={(row) => openEditor({ mode: 'copy', source: row })} />
          <ScenarioGroup title="我的场景" rows={customs} loading={loading} empty="还没有场景，可以新建或复制一个系统内置场景"
            onView={setView} onCopy={(row) => openEditor({ mode: 'copy', source: row })}
            onEdit={(row) => openEditor({ mode: 'edit', source: row })}
            onDelete={(row) => void remove(row)} deletingId={deletingId} />
        </div>
        {view && <ScenarioView key={view.id} row={view} onClose={() => setView(null)}
          onCopy={() => { setView(null); openEditor({ mode: 'copy', source: view }) }}
          onEdit={!view.is_builtin ? () => { setView(null); openEditor({ mode: 'edit', source: view }) } : undefined} />}
        {editor && <ScenarioEditor key={`${editor.mode}-${editor.source?.id ?? 'blank'}`}
          mode={editor.mode} source={editor.source} onCancel={() => setEditor(null)}
          onSaved={(message) => { setEditor(null); setNotice(message); void reload() }} />}
      </PageBody>
    </PageShell>
  )
}

function ScenarioGroup({ title, rows, loading, empty, onView, onCopy, onEdit, onDelete, deletingId }: {
  title: string
  rows: CustomScenario[]
  loading: boolean
  empty: string
  onView: (row: CustomScenario) => void
  onCopy: (row: CustomScenario) => void
  onEdit?: (row: CustomScenario) => void
  onDelete?: (row: CustomScenario) => void
  deletingId?: number | null
}) {
  return (
    <DataCard title={title}>
      {rows.length === 0 && <p className="py-2 text-[13px] text-ink-muted">{loading ? '载入中…' : empty}</p>}
      <div className="divide-y divide-border-subtle">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h3 className="text-[14px] font-semibold text-ink">{row.name}</h3>
                <span className="text-[11px] text-ink-muted">判断题 {questionCount(row.judge_questions)} · 人设题 {questionCount(row.persona_questions)}</span>
              </div>
              {row.description && <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-ink-secondary">{row.description}</p>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button size="sm" onClick={() => onView(row)}>查看</Button>
              {onEdit && <Button size="sm" onClick={() => onEdit(row)}>编辑</Button>}
              <Button size="sm" onClick={() => onCopy(row)}>复制</Button>
              {onDelete && <Button size="sm" variant="text" loading={deletingId === row.id} onClick={() => onDelete(row)}>删除</Button>}
            </div>
          </div>
        ))}
      </div>
    </DataCard>
  )
}

function ScenarioView({ row, onClose, onCopy, onEdit }: {
  row: CustomScenario
  onClose: () => void
  onCopy: () => void
  onEdit?: () => void
}) {
  const [tab, setTab] = useState<ViewTab>('prompt')
  return (
    <Modal size="lg" scroll="hidden" onClose={onClose} labelledBy="scenario-view-title" className="flex flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 id="scenario-view-title" className="truncate text-[17px] font-semibold text-ink">{row.name}</h2>
          {row.description && <p className="mt-0.5 text-[12px] leading-5 text-ink-muted">{row.description}</p>}
        </div>
        <Button size="sm" variant="text" onClick={onClose} aria-label="关闭场景查看弹窗">关闭</Button>
      </div>
      <div role="tablist" aria-label="场景内容" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-3 sm:px-5">
        {viewTabs.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)}
            className={`shrink-0 border-b-2 px-3 py-3 text-[13px] ${tab === item.key ? 'border-primary font-semibold text-primary' : 'border-transparent text-ink-secondary hover:text-ink'}`}>
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
        {tab === 'prompt' && <p className="whitespace-pre-wrap break-words rounded-[8px] bg-surface-muted p-4 text-[13px] leading-6 text-ink">{row.system_prompt || '未设置'}</p>}
        {tab === 'judge' && <QuestionSetView raw={row.judge_questions} />}
        {tab === 'persona' && <QuestionSetView raw={row.persona_questions} />}
      </div>
      <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-5">
        <Button size="sm" onClick={onCopy}>复制</Button>
        {onEdit && <Button size="sm" variant="primary" onClick={onEdit}>编辑</Button>}
      </div>
    </Modal>
  )
}
