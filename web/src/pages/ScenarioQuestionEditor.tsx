import type { QuestionKind } from '../api/scenarios'
import Button from '../components/Button'
import {
  defaultOptions, newQuestion, typeNames,
  type QuestionItem, type QuestionOption, type QuestionType,
} from './ScenarioQuestions'

const fieldClass = 'w-full rounded-[6px] border border-border bg-surface px-3 py-2 text-[13px] text-ink'

export default function ScenarioQuestionEditor({ kind, items, onChange, disabled }: {
  kind: QuestionKind
  items: QuestionItem[]
  onChange: (items: QuestionItem[]) => void
  disabled: boolean
}) {
  const updateQuestion = (id: number, update: Partial<QuestionItem>) => {
    onChange(items.map((item) => item.id === id ? { ...item, ...update } : item))
  }
  const updateOption = (item: QuestionItem, index: number, update: Partial<QuestionOption>) => {
    updateQuestion(item.id, {
      options: item.options.map((option, optionIndex) => optionIndex === index ? { ...option, ...update } : option),
    })
  }
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="rounded-[6px] bg-surface-muted p-3 text-[13px] text-ink-muted">还没有题目</p>}
      {items.map((item, index) => (
        <details key={item.id} open={index === items.length - 1} className="rounded-[8px] border border-border bg-surface">
          <summary className="cursor-pointer px-3 py-3 text-[13px] font-medium text-ink">
            {index + 1}. {item.title || item.key || '新题目'} <span className="ml-2 font-normal text-ink-muted">{typeNames[item.type]}</span>
          </summary>
          <div className="space-y-3 border-t border-border-subtle p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] text-ink-secondary">题目名称
                <input className={`mt-1 ${fieldClass}`} maxLength={100} value={item.title} disabled={disabled} onChange={(event) => updateQuestion(item.id, { title: event.target.value })} />
              </label>
              <label className="text-[12px] text-ink-secondary">题目编号
                <input className={`mt-1 ${fieldClass}`} value={item.key} disabled={disabled} onChange={(event) => updateQuestion(item.id, { key: event.target.value })} />
              </label>
            </div>
            <label className="block text-[12px] text-ink-secondary">题型
              <select className={`mt-1 ${fieldClass}`} value={item.type} disabled={disabled} onChange={(event) => {
                const type = event.target.value as QuestionType
                updateQuestion(item.id, { type, options: defaultOptions(type) })
              }}>
                <option value="noul">是非题</option>
                <option value="choice">选项题</option>
                <option value="score">评分题</option>
              </select>
            </label>
            <label className="block text-[12px] text-ink-secondary">判断说明
              <textarea className={`mt-1 min-h-20 ${fieldClass}`} value={item.instructions} disabled={disabled} onChange={(event) => updateQuestion(item.id, { instructions: event.target.value })} placeholder="填写发给判断模型的判别要求" />
            </label>
            <div className="space-y-2">
              <p className="text-[12px] text-ink-secondary">{item.type === 'score' ? '评分档位' : '选项'}</p>
              {item.options.map((option, optionIndex) => (
                <div key={optionIndex} className="grid gap-2 rounded-[6px] border border-border-subtle bg-surface-muted p-2 sm:grid-cols-[minmax(100px,1fr)_minmax(120px,1fr)_minmax(180px,2fr)_auto]">
                  {item.type === 'choice'
                    ? <input aria-label={`选项 ${optionIndex + 1} 编号`} className={fieldClass} value={option.key} disabled={disabled} onChange={(event) => updateOption(item, optionIndex, { key: event.target.value })} placeholder="选项编号" />
                    : <span className="self-center px-1 text-[12px] text-ink-muted">{item.type === 'noul' ? option.key === 'true' ? '是' : '否' : `档位 ${optionIndex + 1}`}</span>}
                  <input aria-label={`选项 ${optionIndex + 1} 名称`} className={fieldClass} value={option.label} disabled={disabled} onChange={(event) => updateOption(item, optionIndex, { label: event.target.value })} placeholder="显示名称（可选）" />
                  <textarea aria-label={`选项 ${optionIndex + 1} 说明`} className={`min-h-10 ${fieldClass}`} value={option.description} disabled={disabled} onChange={(event) => updateOption(item, optionIndex, { description: event.target.value })} placeholder="判别标准" />
                  {item.type !== 'noul'
                    ? <Button size="sm" type="button" disabled={disabled || item.options.length <= 2} onClick={() => updateQuestion(item.id, { options: item.options.filter((_, optionIndexToKeep) => optionIndexToKeep !== optionIndex) })}>移除</Button>
                    : <span />}
                </div>
              ))}
              {item.type !== 'noul' && (
                <Button size="sm" type="button" disabled={disabled || item.options.length >= (item.type === 'score' ? 10 : 255)} onClick={() => updateQuestion(item.id, {
                  options: [...item.options, { key: item.type === 'score' ? String(item.options.length) : `option_${item.options.length + 1}`, label: '', description: '' }],
                })}>添加{item.type === 'score' ? '档位' : '选项'}</Button>
              )}
            </div>
            <div className="flex justify-end border-t border-border-subtle pt-3">
              <Button size="sm" type="button" variant="text" disabled={disabled} onClick={() => onChange(items.filter((row) => row.id !== item.id))}>删除题目</Button>
            </div>
          </div>
        </details>
      ))}
      <Button size="sm" type="button" disabled={disabled || items.length >= 20} onClick={() => onChange([...items, newQuestion(items, kind)])}>添加题目</Button>
      {kind === 'persona' && <p className="text-[12px] text-ink-muted">人设题集需要“证据是否充足”是非题，以及至少一道选项题或评分题。</p>}
    </div>
  )
}
