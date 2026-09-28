import { useRef, useState } from 'react'
import { ApiError } from '../api/client'
import {
  createScenario, generateScenarioPrompt, generateScenarioQuestions, updateScenario,
  type CustomScenario, type QuestionKind,
} from '../api/scenarios'
import Button from '../components/Button'
import { Notice } from '../components/layout'
import Modal from '../components/Modal'
import StageLoader, { type LoaderStep } from '../components/StageLoader'
import ScenarioQuestionEditor from './ScenarioQuestionEditor'
import { parseQuestionSet, serializeQuestionSet, type QuestionItem } from './ScenarioQuestions'

type Mode = 'new' | 'copy' | 'edit'
type EditorTab = 'basic' | 'prompt' | 'judge' | 'persona'
type GenerateTarget = 'prompt' | 'judge' | 'persona'
const tabs: { key: EditorTab; label: string }[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'prompt', label: '回复提示词' },
  { key: 'judge', label: '判断题集' },
  { key: 'persona', label: '人设题集' },
]
const fieldClass = 'mt-1.5 w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-[14px] text-ink'
// 收尾状态停留一下再收起，否则"已完成"一闪而过看不见（与决策页一致）
const DONE_HOLD_MS = 600
const GEN_LABELS: Record<GenerateTarget, { running: string; done: string; notice: string }> = {
  prompt: { running: '正在生成回复提示词', done: '回复提示词生成完成', notice: '回复提示词已生成，请检查后保存' },
  judge: { running: '正在生成判断题集', done: '判断题集生成完成', notice: '判断题已生成，请检查后保存' },
  persona: { running: '正在生成人设题集', done: '人设题集生成完成', notice: '人设题已生成，请检查后保存' },
}
const GEN_DIALOG: Record<GenerateTarget, { title: string; hint: string; placeholder: string }> = {
  prompt: {
    title: '自动生成回复提示词',
    hint: '将用当前账号已启用的表达模型，根据场景名称与描述起草回复提示词。',
    placeholder: '例如：语气专业克制，先共情再给行动建议，不做出未确定的承诺',
  },
  judge: {
    title: '自动生成判断题集',
    hint: '将用当前账号已启用的表达模型，根据场景信息生成判断题集。',
    placeholder: '例如：重点判断事实、风险和下一步动作',
  },
  persona: {
    title: '自动生成人设题集',
    hint: '将用当前账号已启用的表达模型，根据场景信息生成人设题集。',
    placeholder: '例如：侧重沟通风格与情绪需求',
  },
}

interface Props {
  mode: Mode
  source?: CustomScenario
  onCancel: () => void
  onSaved: (message: string) => void
}

function initialQuestions(raw?: string): QuestionItem[] {
  try { return parseQuestionSet(raw ?? '{}') } catch { return [] }
}

async function readQuestionFile(file: File, kind: QuestionKind): Promise<QuestionItem[]> {
  if (file.size > 1_000_000) throw new Error('JSON 文件不能超过 1 MB')
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('文件不是合法的 JSON') }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const data = parsed as Record<string, unknown>
    const field = kind === 'judge' ? 'judge_questions' : 'persona_questions'
    if ('judge_questions' in data || 'persona_questions' in data) {
      if (!(field in data)) throw new Error(`文件里没有${field}`)
      parsed = data[field]
    }
  }
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { throw new Error('题集内容不是合法的 JSON') }
  }
  const items = parseQuestionSet(JSON.stringify(parsed))
  serializeQuestionSet(items, kind)
  return items
}

function holdDone(): Promise<void> {
  return new Promise((resolve) => { window.setTimeout(resolve, DONE_HOLD_MS) })
}

export default function ScenarioEditor({ mode, source, onCancel, onSaved }: Props) {
  const [tab, setTab] = useState<EditorTab>('basic')
  const [name, setName] = useState(mode === 'copy' ? `${source?.name ?? ''}（副本）` : source?.name ?? '')
  const [description, setDescription] = useState(mode === 'copy' ? `复制自「${source?.name ?? ''}」` : source?.description ?? '')
  const [prompt, setPrompt] = useState(source?.system_prompt ?? '')
  const [judgeItems, setJudgeItems] = useState(() => initialQuestions(source?.judge_questions))
  const [personaItems, setPersonaItems] = useState(() => initialQuestions(source?.persona_questions))
  const [requirements, setRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [genTarget, setGenTarget] = useState<GenerateTarget | null>(null)
  const [genDone, setGenDone] = useState(false)
  const [genDialog, setGenDialog] = useState<GenerateTarget | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const locked = busy || genTarget !== null
  const title = mode === 'edit' ? `编辑「${source?.name ?? ''}」` : mode === 'copy' ? `复制「${source?.name ?? ''}」` : '新建场景'
  // 与决策页一致的分步 loading：生成中只有一步，完成态停留片刻再回填收起
  const loaderSteps: LoaderStep[] = genTarget
    ? [{ key: genTarget, ...GEN_LABELS[genTarget], state: genDone ? 'done' : 'running' }]
    : []

  function setQuestions(kind: QuestionKind, items: QuestionItem[]) {
    if (kind === 'judge') setJudgeItems(items)
    else setPersonaItems(items)
  }

  async function importFile(kind: QuestionKind, file: File) {
    setError('')
    setNotice('')
    try {
      setQuestions(kind, await readQuestionFile(file, kind))
      setNotice(`${kind === 'judge' ? '判断' : '人设'}题已导入，保存后生效`)
    } catch (err) {
      setError(err instanceof Error ? `导入失败：${err.message}` : '导入失败')
    }
  }

  function askGenerate(target: GenerateTarget) {
    if (!name.trim()) { setTab('basic'); setError('请先填写场景名称'); return }
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
      const common = {
        name: name.trim(), description: description.trim(), requirements: requirements.trim(),
      }
      if (target === 'prompt') {
        setPrompt((await generateScenarioPrompt(common)).prompt)
      } else {
        const result = await generateScenarioQuestions({ kind: target, ...common })
        const items = parseQuestionSet(result.questions)
        serializeQuestionSet(items, target)
        setQuestions(target, items)
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
    if (!name.trim()) { setTab('basic'); setError('请填写场景名称'); return }
    let judgeQuestions: string
    let personaQuestions: string
    try {
      judgeQuestions = serializeQuestionSet(judgeItems, 'judge')
    } catch (err) {
      setTab('judge')
      setError(err instanceof Error ? err.message : '请检查判断题')
      return
    }
    try {
      personaQuestions = serializeQuestionSet(personaItems, 'persona')
    } catch (err) {
      setTab('persona')
      setError(err instanceof Error ? err.message : '请检查人设题')
      return
    }
    const body = {
      name: name.trim(),
      description: description.trim(),
      system_prompt: prompt.trim(),
      judge_questions: judgeQuestions,
      persona_questions: personaQuestions,
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
    <Modal size="lg" scroll="hidden" busy={locked} onClose={onCancel} labelledBy="scenario-editor-title" className="relative flex flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
        <h2 id="scenario-editor-title" className="min-w-0 truncate text-[17px] font-semibold text-ink">{title}</h2>
        <Button size="sm" variant="text" onClick={onCancel} disabled={locked} aria-label="关闭场景编辑弹窗">关闭</Button>
      </div>
      <div role="tablist" aria-label="场景配置" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-3 sm:px-5">
        {tabs.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => { setTab(item.key); setError(''); setNotice('') }}
            className={`shrink-0 border-b-2 px-3 py-3 text-[13px] ${tab === item.key ? 'border-primary font-semibold text-primary' : 'border-transparent text-ink-secondary hover:text-ink'}`}>
            {item.label}{item.key === 'judge' ? ` (${judgeItems.length})` : item.key === 'persona' ? ` (${personaItems.length})` : ''}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <Notice tone="success">{notice}</Notice>}
        {tab === 'basic' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-[13px] font-medium text-ink-secondary">名称
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={64} disabled={locked} className={fieldClass} autoFocus />
            </label>
            <label className="text-[13px] font-medium text-ink-secondary">描述
              <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} disabled={locked} className={fieldClass} />
            </label>
          </div>
        )}
        {tab === 'prompt' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium text-ink-secondary">回复提示词（表达模型）</span>
              <Button size="sm" type="button" disabled={locked} onClick={() => askGenerate('prompt')}>自动生成</Button>
            </div>
            <label className="block text-[13px] font-medium text-ink-secondary">
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={10000} disabled={locked} rows={12} placeholder="填写此场景下回复的语气和规则" className={`${fieldClass} min-h-64 resize-y leading-6`} />
              <span className="mt-1 block font-normal text-ink-muted">留空时使用默认规则。</span>
            </label>
          </div>
        )}
        {(tab === 'judge' || tab === 'persona') && (
          <QuestionPanel key={tab} kind={tab} items={tab === 'judge' ? judgeItems : personaItems}
            onChange={(items) => setQuestions(tab, items)}
            onImport={(file) => void importFile(tab, file)}
            onGenerate={() => askGenerate(tab)}
            disabled={locked} />
        )}
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border-subtle bg-surface px-4 py-3 sm:px-5">
        <Button size="sm" onClick={onCancel} disabled={locked}>取消</Button>
        <Button size="sm" variant="primary" loading={busy} disabled={locked} onClick={() => void save()}>保存场景</Button>
      </div>
      {genTarget && (
        <div role="status" className="absolute inset-0 z-10 flex items-center justify-center rounded-[20px] bg-white/75 backdrop-blur-[1px]">
          <div className="rounded-[8px] border border-border bg-surface px-5 py-4 shadow-sm">
            <StageLoader steps={loaderSteps} />
          </div>
        </div>
      )}
      {genDialog && (
        <GenerateDialog target={genDialog} requirements={requirements} onRequirements={setRequirements}
          onConfirm={() => { if (genDialog) void runGenerate(genDialog) }}
          onClose={() => setGenDialog(null)} />
      )}
    </Modal>
  )
}

function QuestionPanel({ kind, items, onChange, onImport, onGenerate, disabled }: {
  kind: QuestionKind
  items: QuestionItem[]
  onChange: (items: QuestionItem[]) => void
  onImport: (file: File) => void
  onGenerate: () => void
  disabled: boolean
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">{kind === 'judge' ? '判断题集' : '人设题集'}</h3>
          <p className="mt-1 text-[12px] text-ink-muted">每题填写编号、判断说明和选项；最多 20 道。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onImport(file)
            event.target.value = ''
          }} />
          <Button size="sm" type="button" disabled={disabled} onClick={() => fileInput.current?.click()}>导入 JSON</Button>
          <Button size="sm" type="button" disabled={disabled} onClick={onGenerate}>自动生成</Button>
        </div>
      </div>
      <ScenarioQuestionEditor kind={kind} items={items} onChange={onChange} disabled={disabled} />
    </div>
  )
}

function GenerateDialog({ target, requirements, onRequirements, onConfirm, onClose }: {
  target: GenerateTarget
  requirements: string
  onRequirements: (value: string) => void
  onConfirm: () => void
  onClose: () => void
}) {
  const meta = GEN_DIALOG[target]
  return (
    <Modal size="sm" onClose={onClose} labelledBy="generate-dialog-title" initialFocusSelector="#generate-requirements">
      <form onSubmit={(event) => { event.preventDefault(); onConfirm() }} className="flex flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
          <h2 id="generate-dialog-title" className="text-[16px] font-semibold text-ink">{meta.title}</h2>
          <Button size="sm" variant="text" type="button" onClick={onClose} aria-label="关闭生成弹窗">关闭</Button>
        </div>
        <div className="px-4 py-4 sm:px-5">
          <p className="text-[12px] leading-5 text-ink-muted">{meta.hint}</p>
          <label className="mt-3 block text-[13px] font-medium text-ink-secondary">生成要求（可选）
            <textarea id="generate-requirements" value={requirements} onChange={(event) => onRequirements(event.target.value)}
              maxLength={2000} rows={4} placeholder={meta.placeholder} className={`${fieldClass} resize-y`} />
          </label>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-5">
          <Button size="sm" type="button" onClick={onClose}>取消</Button>
          <Button size="sm" variant="primary" type="submit">生成</Button>
        </div>
      </form>
    </Modal>
  )
}
