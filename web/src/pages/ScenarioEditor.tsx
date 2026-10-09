import { useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  createScenario,
  generateScenarioPrompt,
  generateScenarioQuestions,
  updateScenario,
  type CustomScenario,
} from '../api/scenarios'
import Button from '../components/Button'
import ContextPicker from '../components/ContextPicker'
import { Notice } from '../components/layout'
import Modal from '../components/Modal'
import StageLoader, { type LoaderStep } from '../components/StageLoader'
import TabNav from '../components/TabNav'
import {
  buildPersonaQuestions,
  contextOfPersonaQuestions,
  CUSTOM_CONTEXT_DEFAULT_DIMENSIONS,
  dimensionKeysOf,
  personaKeysOf,
} from '../data/personaCatalog'
import ScenarioQuestionEditor from './ScenarioQuestionEditor'
import { parseQuestionSet, serializeQuestionSet, type QuestionItem } from './ScenarioQuestions'

type Mode = 'new' | 'copy' | 'edit'
type EditorTab = 'basic' | 'judge' | 'prompt'
type GenerateTarget = 'prompt' | 'judge'

const fieldClass =
  'w-full rounded-[8px] border border-border bg-surface px-3 py-2 text-[14px] text-ink shadow-xs ' +
  'transition-colors duration-150 placeholder:text-ink-faint hover:border-border-strong ' +
  'focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 disabled:bg-surface-muted'

const TABS: { key: EditorTab; label: string }[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'judge', label: '判断题集' },
  { key: 'prompt', label: '回复语气' },
]

// 完成态只停留一瞬间（与决策页一致），随即收起并回填结果。
const DONE_HOLD_MS = 280

const GEN_LABELS: Record<GenerateTarget, { running: string; done: string; notice: string }> = {
  prompt: { running: '正在起草回复语气', done: '回复语气起草完成', notice: '回复语气已起草，请检查后保存' },
  judge: { running: '正在生成判断题集', done: '判断题集生成完成', notice: '判断题已生成，请检查后保存' },
}

const GEN_DIALOG: Record<GenerateTarget, { title: string; hint: string; placeholder: string }> = {
  prompt: {
    title: '起草回复语气',
    hint: '用你配置的模型，按场景名称与描述起草一段语气规则。',
    placeholder: '例如：语气专业克制，先共情再给行动建议，不做出未确定的承诺',
  },
  judge: {
    title: '生成判断题集',
    hint: '用你配置的模型，按场景信息生成判断题集。',
    placeholder: '例如：重点判断事实、风险和下一步动作',
  },
}

interface Props {
  mode: Mode
  source?: CustomScenario
  onCancel: () => void
  onSaved: (message: string) => void
}

function initialQuestions(raw?: string): QuestionItem[] {
  try {
    return parseQuestionSet(raw ?? '{}')
  } catch {
    return []
  }
}

async function readQuestionFile(file: File): Promise<QuestionItem[]> {
  if (file.size > 1_000_000) throw new Error('JSON 文件不能超过 1 MB')
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('文件不是合法的 JSON')
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const data = parsed as Record<string, unknown>
    if ('judge_questions' in data) parsed = data.judge_questions
  }
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      throw new Error('题集内容不是合法的 JSON')
    }
  }
  const items = parseQuestionSet(JSON.stringify(parsed))
  serializeQuestionSet(items, 'judge')
  return items
}

function holdDone(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, DONE_HOLD_MS)
  })
}

export default function ScenarioEditor({ mode, source, onCancel, onSaved }: Props) {
  const [tab, setTab] = useState<EditorTab>('basic')
  const [name, setName] = useState(mode === 'copy' ? `${source?.name ?? ''}（副本）` : (source?.name ?? ''))
  const [description, setDescription] = useState(
    mode === 'copy' ? `复制自「${source?.name ?? ''}」` : (source?.description ?? ''),
  )
  const [context, setContext] = useState<string>(() =>
    contextOfPersonaQuestions(source?.persona_questions),
  )
  const [customLabel, setCustomLabel] = useState('')
  const [customKeys, setCustomKeys] = useState<string[]>(() => {
    const keys = personaKeysOf(source?.persona_questions)
    return keys.length > 0 ? keys : CUSTOM_CONTEXT_DEFAULT_DIMENSIONS
  })
  const [prompt, setPrompt] = useState(source?.system_prompt ?? '')
  const [judgeItems, setJudgeItems] = useState(() => initialQuestions(source?.judge_questions))
  const [judgeOpen, setJudgeOpen] = useState(false)
  const [requirements, setRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [genTarget, setGenTarget] = useState<GenerateTarget | null>(null)
  const [genDone, setGenDone] = useState(false)
  const [genDialog, setGenDialog] = useState<GenerateTarget | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const locked = busy || genTarget !== null

  const title =
    mode === 'edit' ? `编辑「${source?.name ?? ''}」` : mode === 'copy' ? `复制「${source?.name ?? ''}」` : '新建场景'
  const loaderSteps: LoaderStep[] = genTarget
    ? [{ key: genTarget, ...GEN_LABELS[genTarget], state: genDone ? 'done' : 'running' }]
    : []

  async function importFile(file: File) {
    setError('')
    setNotice('')
    try {
      setJudgeItems(await readQuestionFile(file))
      setNotice('判断题已导入，保存后生效')
    } catch (err) {
      setError(err instanceof Error ? `导入失败：${err.message}` : '导入失败')
    }
  }

  function askGenerate(target: GenerateTarget) {
    if (!name.trim()) {
      setTab('basic')
      setError('请先填写场景名称')
      return
    }
    setError('')
    setNotice('')
    setGenDialog(target)
  }

  async function runGenerate(target: GenerateTarget) {
    setGenDialog(null)
    setGenTarget(target)
    setGenDone(false)
    setError('')
    setNotice('')
    try {
      const common = { name: name.trim(), description: description.trim(), requirements: requirements.trim() }
      if (target === 'prompt') {
        setPrompt((await generateScenarioPrompt(common)).prompt)
      } else {
        const result = await generateScenarioQuestions({ kind: 'judge', ...common })
        const items = parseQuestionSet(result.questions)
        serializeQuestionSet(items, 'judge')
        setJudgeItems(items)
        setJudgeOpen(true)
      }
      setGenDone(true)
      await holdDone()
      setNotice(GEN_LABELS[target].notice)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : '生成失败')
    } finally {
      setGenTarget(null)
      setGenDone(false)
    }
  }

  async function save() {
    setError('')
    if (!name.trim()) {
      setTab('basic')
      setError('请填写场景名称')
      return
    }
    let judgeQuestions: string
    try {
      judgeQuestions = serializeQuestionSet(judgeItems, 'judge')
    } catch (err) {
      setTab('judge')
      setJudgeOpen(true)
      setError(err instanceof Error ? err.message : '请检查判断题')
      return
    }
    const body = {
      name: name.trim(),
      description: description.trim(),
      system_prompt: prompt.trim(),
      judge_questions: judgeQuestions,
      // 人设题按所选档位的维度拼装
      persona_questions: buildPersonaQuestions(dimensionKeysOf(context, customKeys)),
    }
    setBusy(true)
    try {
      if (mode === 'edit' && source) await updateScenario(source.id, body)
      else await createScenario({ ...body, base_scenario_id: mode === 'copy' ? source?.id : null })
      onSaved(mode === 'edit' ? '场景已保存' : '场景已创建')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      size="lg"
      scroll="hidden"
      busy={locked}
      onClose={onCancel}
      labelledBy="scenario-editor-title"
      className="relative flex flex-col"
    >
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id="scenario-editor-title" className="truncate text-[16px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            场景决定判断视角与回复语气；人设维度从标准库里取。
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={locked} aria-label="关闭场景编辑弹窗">
          关闭
        </Button>
      </div>

      <TabNav
        value={tab}
        ariaLabel="场景配置"
        className="px-4 sm:px-5"
        items={TABS.map((item) => ({
          key: item.key,
          label: item.label,
          badge: item.key === 'judge' && judgeItems.length > 0 ? judgeItems.length : undefined,
        }))}
        onChange={(key) => {
          setTab(key)
          setError('')
          setNotice('')
        }}
      />

      <div role="tabpanel" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}

        {tab === 'basic' && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-[13px] font-medium text-ink-secondary">
                名称
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={64}
                  disabled={locked}
                  className={`mt-1.5 ${fieldClass}`}
                  autoFocus
                />
              </label>
              <label className="block text-[13px] font-medium text-ink-secondary">
                描述
                <input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  disabled={locked}
                  placeholder="一句话说明这个场景用在什么关系里"
                  className={`mt-1.5 ${fieldClass}`}
                />
              </label>
            </div>

            <div>
              <p className="text-[13px] font-medium text-ink-secondary">人设档</p>
              <div className="mt-2">
                <ContextPicker
                  value={context}
                  label={customLabel}
                  keys={customKeys}
                  disabled={locked}
                  onChange={setContext}
                  onLabel={setCustomLabel}
                  onKeys={setCustomKeys}
                />
              </div>
            </div>
          </div>
        )}

        {tab === 'judge' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">判断题集</p>
                <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                  判断这次对话的意图、风险与最佳动作。最多 20 道，题型为是非 / 选项 / 评分。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" type="button" disabled={locked} onClick={() => askGenerate('judge')}>
                  自动生成
                </Button>
                <Button size="sm" type="button" disabled={locked} onClick={() => setJudgeOpen((value) => !value)}>
                  {judgeOpen ? '收起编辑' : '展开编辑'}
                </Button>
              </div>
            </div>
            {judgeItems.length === 0 ? (
              <p className="rounded-[10px] bg-surface-muted p-3.5 text-[13px] text-ink-muted">
                还没有题目。可以生成一版，或导入之前导出的 JSON。
              </p>
            ) : (
              <ul className="space-y-1.5">
                {judgeItems.map((item, index) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-surface-muted/60 px-3 py-2"
                  >
                    <span className="w-5 shrink-0 text-[12px] tabular-nums text-ink-faint">{index + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink">
                      {item.title || item.key}
                    </span>
                    <span className="shrink-0 rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted">
                      {{ noul: '是非', choice: '选项', score: '评分' }[item.type]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <JudgeFileRow disabled={locked} onImport={(file) => void importFile(file)} />
            {judgeOpen && (
              <div className="rounded-[10px] border border-border p-3.5">
                <ScenarioQuestionEditor kind="judge" items={judgeItems} onChange={setJudgeItems} disabled={locked} />
              </div>
            )}
          </div>
        )}

        {tab === 'prompt' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink">回复语气</p>
                <p className="mt-1 text-[12px] leading-5 text-ink-muted">
                  约定回复该用什么口吻。留空则用默认规则。
                </p>
              </div>
              <Button size="sm" type="button" disabled={locked} onClick={() => askGenerate('prompt')}>
                自动起草
              </Button>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={10000}
              disabled={locked}
              rows={12}
              placeholder="例如：语气温和直接，先接住情绪，再给一句可执行的话。"
              className={`${fieldClass} min-h-64 resize-y leading-6`}
            />
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-subtle bg-surface px-5 py-3.5">
        <Button size="sm" onClick={onCancel} disabled={locked}>
          取消
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={locked} onClick={() => void save()}>
          保存场景
        </Button>
      </div>

      {genTarget && (
        <div
          role="status"
          className="absolute inset-0 z-10 flex animate-fade-in items-center justify-center rounded-[18px] bg-surface/80 backdrop-blur-[2px]"
        >
          <div className="rounded-[12px] border border-border bg-surface px-5 py-4 shadow-lg">
            <StageLoader steps={loaderSteps} />
          </div>
        </div>
      )}

      {genDialog && (
        <GenerateDialog
          target={genDialog}
          requirements={requirements}
          onRequirements={setRequirements}
          onConfirm={() => genDialog && void runGenerate(genDialog)}
          onClose={() => setGenDialog(null)}
        />
      )}
    </Modal>
  )
}

function JudgeFileRow({ disabled, onImport }: { disabled: boolean; onImport: (file: File) => void }) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-center gap-2">
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onImport(file)
          event.target.value = ''
        }}
      />
      <Button size="sm" type="button" disabled={disabled} onClick={() => fileInput.current?.click()}>
        导入 JSON
      </Button>
      <span className="text-[12px] text-ink-muted">支持导出过的题集文件</span>
    </div>
  )
}

function GenerateDialog({
  target,
  requirements,
  onRequirements,
  onConfirm,
  onClose,
}: {
  target: GenerateTarget
  requirements: string
  onRequirements: (value: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const meta = GEN_DIALOG[target]
  return (
    <Modal size="sm" onClose={onClose} labelledBy="generate-dialog-title" initialFocusSelector="#generate-requirements">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          onConfirm()
        }}
        className="flex flex-col"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <h2 id="generate-dialog-title" className="text-[16px] font-semibold tracking-tight text-ink">
            {meta.title}
          </h2>
          <Button size="sm" variant="ghost" type="button" onClick={onClose} aria-label="关闭生成弹窗">
            关闭
          </Button>
        </div>
        <div className="px-5 py-4">
          <p className="text-[13px] leading-5 text-ink-muted">{meta.hint}</p>
          <label className="mt-3 block text-[13px] font-medium text-ink-secondary">
            补充要求（可选）
            <textarea
              id="generate-requirements"
              value={requirements}
              onChange={(event) => onRequirements(event.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={meta.placeholder}
              className={`mt-1.5 ${fieldClass} resize-y`}
            />
          </label>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
          <Button size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button size="sm" variant="primary" type="submit">
            生成
          </Button>
        </div>
      </form>
    </Modal>
  )
}
