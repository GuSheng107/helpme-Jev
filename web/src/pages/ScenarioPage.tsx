import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { type UserSummary } from '../api/auth'
import { deleteScenario, listAllScenarios, type CustomScenario } from '../api/scenarios'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import { DataCard, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'
import Modal from '../components/Modal'
import TabNav from '../components/TabNav'
import { contextLabelOf, contextOfPersonaQuestions, traitCount } from '../data/personaCatalog'
import ScenarioEditor from './ScenarioEditor'
import { questionCount, QuestionSetView } from './ScenarioQuestions'

type EditorTarget = { mode: 'new' | 'copy' | 'edit'; source?: CustomScenario }
type ViewTab = 'judge' | 'persona' | 'prompt'
const VIEW_TABS: { key: ViewTab; label: string }[] = [
  { key: 'judge', label: '判断题集' },
  { key: 'persona', label: '人设维度' },
  { key: 'prompt', label: '回复语气' },
]

function contextOf(row: CustomScenario) {
  return contextOfPersonaQuestions(row.persona_questions)
}

export default function ScenarioPage({ user }: { user: UserSummary }) {
  const isAdmin = user.role === 'admin'
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

  useEffect(() => {
    void reload()
  }, [])

  async function remove(row: CustomScenario) {
    if (
      !(await confirmAction({
        title: '删除场景',
        message: `删除「${row.name}」？使用它的会话将回到默认场景。`,
        confirmText: '确认删除',
        tone: 'danger',
      }))
    )
      return
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

  const builtins = rows.filter((row) => row.is_builtin || row.is_system)
  const mine = rows.filter((row) => !row.is_builtin && !row.is_system)
  const openEditor = (target: EditorTarget) => {
    setEditor(target)
    setNotice('')
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="场景"
          description="场景决定判断视角与回复语气，人设维度固定取标准档。"
          actions={
            <>
              <Button
                size="sm"
                loading={loading}
                disabled={loading}
                disabledReason="正在载入"
                onClick={() => {
                  setLoading(true)
                  void reload()
                }}
              >
                刷新
              </Button>
              <Button size="sm" variant="primary" onClick={() => openEditor({ mode: 'new' })}>
                新建场景
              </Button>
            </>
          }
        />
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

        <div className="space-y-5">
          <ScenarioGroup
            title="系统内置"
            description="随产品提供，覆盖恋爱与职场两类场景"
            rows={builtins}
            loading={loading}
            empty="还没有内置场景"
            onView={setView}
            onCopy={(row) => openEditor({ mode: 'copy', source: row })}
            onEdit={isAdmin ? (row) => openEditor({ mode: 'edit', source: row }) : undefined}
            onDelete={isAdmin ? (row) => void remove(row) : undefined}
            deletingId={deletingId}
          />
          <ScenarioGroup
            title="我的场景"
            description="自建的判断视角与语气"
            rows={mine}
            loading={loading}
            empty="还没有自建场景，可从系统场景复制一份再改。"
            onView={setView}
            onCopy={(row) => openEditor({ mode: 'copy', source: row })}
            onEdit={(row) => openEditor({ mode: 'edit', source: row })}
            onDelete={(row) => void remove(row)}
            deletingId={deletingId}
          />
        </div>
      </PageBody>

      {view && (
        <ScenarioView
          key={view.id}
          row={view}
          onClose={() => setView(null)}
          onCopy={() => {
            setView(null)
            openEditor({ mode: 'copy', source: view })
          }}
          onEdit={
            isAdmin || !view.is_system
              ? () => {
                  setView(null)
                  openEditor({ mode: 'edit', source: view })
                }
              : undefined
          }
        />
      )}
      {editor && (
        <ScenarioEditor
          key={`${editor.mode}-${editor.source?.id ?? 'blank'}`}
          mode={editor.mode}
          source={editor.source}
          onCancel={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null)
            setNotice(message)
            void reload()
          }}
        />
      )}
    </PageShell>
  )
}

function ScenarioGroup({
  title,
  description,
  rows,
  loading,
  empty,
  onView,
  onCopy,
  onEdit,
  onDelete,
  deletingId,
}: {
  title: string
  description?: string
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
    <DataCard title={title} description={description} bodyClassName="p-0">
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-ink-muted">{loading ? '载入中…' : empty}</p>
      ) : (
        <div className="divide-y divide-border-subtle">
          {rows.map((row) => {
            const context = contextOf(row)
            return (
              <div
                key={row.id}
                className="flex flex-col gap-3 px-5 py-4 transition-colors duration-150 hover:bg-surface-muted/50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[14px] font-medium text-ink">{row.name}</h3>
                    <StatusTag tone={context === 'workplace' ? 'primary' : 'info'}>
                      {contextLabelOf(context)}
                    </StatusTag>
                  </div>
                  {row.description && (
                    <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-ink-muted">{row.description}</p>
                  )}
                  <p className="mt-1.5 text-[12px] text-ink-faint">
                    判断 {questionCount(row.judge_questions)} 题 · 人设维度 {traitCount(row.persona_questions)} 项
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" onClick={() => onView(row)}>
                    查看
                  </Button>
                  {onEdit && (
                    <Button size="sm" onClick={() => onEdit(row)}>
                      编辑
                    </Button>
                  )}
                  <Button size="sm" onClick={() => onCopy(row)}>
                    复制
                  </Button>
                  {onDelete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger hover:bg-danger-soft"
                      loading={deletingId === row.id}
                      disabled={deletingId !== null && deletingId !== row.id}
                      disabledReason="正在删除其他场景"
                      onClick={() => onDelete(row)}
                    >
                      删除
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </DataCard>
  )
}

function ScenarioView({
  row,
  onClose,
  onCopy,
  onEdit,
}: {
  row: CustomScenario
  onClose: () => void
  onCopy: () => void
  onEdit?: () => void
}) {
  const [tab, setTab] = useState<ViewTab>('judge')
  const context = contextOf(row)
  return (
    <Modal size="lg" scroll="hidden" onClose={onClose} labelledBy="scenario-view-title" className="flex flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="scenario-view-title" className="truncate text-[16px] font-semibold tracking-tight text-ink">
              {row.name}
            </h2>
            <StatusTag tone={context === 'workplace' ? 'primary' : 'info'}>
              {contextLabelOf(context)}档
            </StatusTag>
          </div>
          {row.description && (
            <p className="mt-1 text-[13px] leading-5 text-ink-muted">{row.description}</p>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="关闭场景查看弹窗">
          关闭
        </Button>
      </div>

      <TabNav
        value={tab}
        ariaLabel="场景内容"
        className="px-4 sm:px-5"
        items={VIEW_TABS}
        onChange={(key) => setTab(key)}
      />

      <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {tab === 'prompt' && (
          <p className="whitespace-pre-wrap break-words rounded-[10px] bg-surface-muted p-4 text-[13px] leading-6 text-ink">
            {row.system_prompt || '未设置，将使用默认规则'}
          </p>
        )}
        {tab === 'judge' && <QuestionSetView raw={row.judge_questions} />}
        {tab === 'persona' && (
          <>
            <p className="mb-3 text-[13px] leading-5 text-ink-muted">
              这些维度决定了建档时要问什么、判断时能看到什么。
            </p>
            <QuestionSetView raw={row.persona_questions} />
          </>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button size="sm" onClick={onCopy}>
          复制
        </Button>
        {onEdit && (
          <Button size="sm" variant="primary" onClick={onEdit}>
            编辑
          </Button>
        )}
      </div>
    </Modal>
  )
}
