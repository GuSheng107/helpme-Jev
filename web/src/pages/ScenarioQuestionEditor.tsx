import type { QuestionKind } from '../api/scenarios'
import Button from '../components/Button'
import { controlClass } from '../components/Field'
import { IconChevronDown, IconPlus } from '../components/icons'
import {
  defaultOptions, newQuestion, typeNames,
  type QuestionItem, type QuestionOption, type QuestionType,
} from './ScenarioQuestions'

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
    <div className="space-y-2.5">
      {items.length === 0 && (
        <p className="rounded-[10px] border border-dashed border-border bg-surface-muted/60 px-3.5 py-4 text-center text-[13px] text-ink-muted">
          还没有题目，点下面的「添加题目」开始。
        </p>
      )}

      {items.map((item, index) => (
        <details
          key={item.id}
          open={index === items.length - 1}
          className="group/q overflow-hidden rounded-[12px] border border-border bg-surface transition-colors duration-200 hover:border-border-strong open:border-border-strong"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
            <span className="tnum grid h-5 w-5 shrink-0 place-items-center rounded-[6px] bg-surface-muted text-[11px] font-semibold text-ink-muted transition-colors duration-200 group-open/q:bg-primary-soft group-open/q:text-primary">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
              {item.title || item.key || '新题目'}
            </span>
            <span className="shrink-0 rounded-[6px] bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-secondary">
              {typeNames[item.type]}
            </span>
            <IconChevronDown className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 group-open/q:rotate-180" />
          </summary>

          <div className="space-y-3.5 border-t border-border-subtle bg-surface-muted/40 p-3.5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">题目名称</span>
                <input className={controlClass} maxLength={100} value={item.title} disabled={disabled}
                  placeholder="给人看的名字"
                  onChange={(event) => updateQuestion(item.id, { title: event.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">题目编号</span>
                <input className={controlClass + ' mono'} value={item.key} disabled={disabled}
                  placeholder="judge_1"
                  onChange={(event) => updateQuestion(item.id, { key: event.target.value })} />
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">题型</span>
              <select className={controlClass + ' cursor-pointer'} value={item.type} disabled={disabled}
                onChange={(event) => {
                  const type = event.target.value as QuestionType
                  updateQuestion(item.id, { type, options: defaultOptions(type) })
                }}>
                <option value="noul">是非题</option>
                <option value="choice">选项题</option>
                <option value="score">评分题</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-secondary">判断说明</span>
              <textarea className={controlClass + ' h-auto min-h-24 resize-y py-2 leading-[22px]'}
                value={item.instructions} disabled={disabled}
                placeholder="填写发给判断模型的判别要求，越具体越稳"
                onChange={(event) => updateQuestion(item.id, { instructions: event.target.value })} />
            </label>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-medium text-ink-secondary">
                  {item.type === 'score' ? '评分档位' : '选项'}
                  <span className="tnum ml-1.5 font-normal text-ink-faint">{item.options.length}</span>
                </p>
                {item.type !== 'noul' && (
                  <button
                    type="button"
                    disabled={disabled || item.options.length >= (item.type === 'score' ? 10 : 255)}
                    className="inline-flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 text-[12px] font-medium text-primary transition-colors duration-150 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => updateQuestion(item.id, {
                      options: [...item.options, {
                        key: item.type === 'score' ? String(item.options.length) : `option_${item.options.length + 1}`,
                        label: '',
                        description: '',
                      }],
                    })}
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    添加{item.type === 'score' ? '档位' : '选项'}
                  </button>
                )}
              </div>

              {item.options.map((option, optionIndex) => (
                <div
                  key={optionIndex}
                  className="grid gap-2 rounded-[9px] border border-border-subtle bg-surface p-2.5 sm:grid-cols-[minmax(96px,0.8fr)_minmax(120px,1fr)_minmax(180px,2fr)_auto]"
                >
                  {item.type === 'choice' ? (
                    <input
                      aria-label={`选项 ${optionIndex + 1} 编号`}
                      className={controlClass + ' mono'}
                      value={option.key}
                      disabled={disabled}
                      placeholder="option_a"
                      onChange={(event) => updateOption(item, optionIndex, { key: event.target.value })}
                    />
                  ) : (
                    <span className="tnum flex items-center px-1 text-[13px] text-ink-muted">
                      {item.type === 'noul' ? (option.key === 'true' ? '是' : '否') : `档位 ${optionIndex + 1}`}
                    </span>
                  )}
                  <input
                    aria-label={`选项 ${optionIndex + 1} 名称`}
                    className={controlClass}
                    value={option.label}
                    disabled={disabled}
                    placeholder="显示名称（可选）"
                    onChange={(event) => updateOption(item, optionIndex, { label: event.target.value })}
                  />
                  <textarea
                    aria-label={`选项 ${optionIndex + 1} 说明`}
                    className={controlClass + ' h-auto min-h-9 resize-y py-2 leading-[20px]'}
                    value={option.description}
                    disabled={disabled}
                    placeholder="判别标准"
                    onChange={(event) => updateOption(item, optionIndex, { description: event.target.value })}
                  />
                  {item.type !== 'noul' ? (
                    <Button
                      size="sm"
                      variant="ghost-danger"
                      type="button"
                      disabled={disabled || item.options.length <= 2}
                      disabledReason="至少要保留两个"
                      onClick={() => updateQuestion(item.id, { options: item.options.filter((_, keep) => keep !== optionIndex) })}
                    >
                      移除
                    </Button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end border-t border-border-subtle pt-3">
              <Button size="sm" type="button" variant="ghost-danger" disabled={disabled}
                onClick={() => onChange(items.filter((row) => row.id !== item.id))}>
                删除题目
              </Button>
            </div>
          </div>
        </details>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          type="button"
          disabled={disabled || items.length >= 20}
          disabledReason="最多 20 道题"
          onClick={() => onChange([...items, newQuestion(items, kind)])}
        >
          <IconPlus className="h-4 w-4" />
          添加题目
        </Button>
        <span className="tnum text-[12px] text-ink-faint">{items.length} / 20</span>
      </div>

      {kind === 'persona' && (
        <p className="text-[12px] leading-5 text-ink-muted">
          人设题集至少需要一道选项题或评分题。
        </p>
      )}
    </div>
  )
}
