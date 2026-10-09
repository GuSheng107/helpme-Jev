import { IconChevronDown } from '../components/icons'

export type QuestionType = 'noul' | 'choice' | 'score'
export interface QuestionOption {
  key: string
  label: string
  description: string
}
export interface QuestionItem {
  id: number
  key: string
  title: string
  type: QuestionType
  instructions: string
  options: QuestionOption[]
  extra: Record<string, unknown>
}

let nextQuestionId = 1
export const typeNames: Record<QuestionType, string> = {
  noul: '是非题',
  choice: '选项题',
  score: '评分题',
}
const knownTitles: Record<string, string> = {
  evidence_sufficient: '信息是否足够',
  openness: '开放性',
  conscientiousness: '尽责性',
  extraversion: '外向性',
  agreeableness: '宜人性',
  emotional_stability: '情绪稳定',
  attachment: '依恋倾向',
  love_language: '爱的语言',
  conflict_style: '冲突风格',
  sensitivity: '情绪敏感',
  disc: 'DISC 倾向',
}
function displayTitle(item: QuestionItem): string {
  return item.title || knownTitles[item.key] || item.key
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function parseQuestionSet(raw: string): QuestionItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw || '{}')
  } catch {
    throw new Error('题集内容无法读取')
  }
  if (!isRecord(parsed)) throw new Error('题集内容应是题目对象')
  return Object.entries(parsed).map(([key, value]) => {
    if (!isRecord(value)) throw new Error(`题目「${key}」内容无法读取`)
    const type = value.type
    if (type !== 'noul' && type !== 'choice' && type !== 'score') {
      throw new Error(`题目「${key}」的题型无法识别`)
    }
    const criteria = value.criteria
    let options: QuestionOption[]
    if (type === 'score') {
      if (!Array.isArray(criteria)) throw new Error(`题目「${key}」的评分档位无法读取`)
      const labels = Array.isArray(value.level_labels) ? value.level_labels : []
      options = criteria.map((description, index) => ({
        key: String(index),
        label: asText(labels[index]),
        description: asText(description),
      }))
    } else {
      if (!isRecord(criteria)) throw new Error(`题目「${key}」的选项无法读取`)
      const labels = isRecord(value.labels) ? value.labels : {}
      options = Object.entries(criteria).map(([optionKey, description]) => ({
        key: optionKey,
        label: asText(labels[optionKey]),
        description: asText(description),
      }))
    }
    const { type: _type, instructions: _instructions, criteria: _criteria,
      title: _title, labels: _labels, level_labels: _levelLabels, ...extra } = value
    return {
      id: nextQuestionId++,
      key,
      title: asText(value.title),
      type,
      instructions: asText(value.instructions),
      options,
      extra,
    }
  })
}

export function serializeQuestionSet(items: QuestionItem[], kind: 'judge' | 'persona'): string {
  const setName = kind === 'judge' ? '判断题集' : '人设题集'
  if (!items.length) throw new Error(`请为${setName}添加题目`)
  if (items.length > 20) throw new Error(`${setName}最多 20 道题`)
  const keys = new Set<string>()
  const entries = items.map((item, index) => {
    const key = item.key.trim()
    const title = item.title.trim()
    const name = title || key || `第 ${index + 1} 题`
    if (!key) throw new Error(`${setName}的${name}缺少题目编号`)
    if (keys.has(key)) throw new Error(`${setName}存在重复的题目编号「${key}」`)
    keys.add(key)
    if (!item.instructions.trim()) throw new Error(`${setName}的「${name}」缺少判断说明`)
    const criteria: Record<string, string> | string[] = item.type === 'score' ? [] : Object.create(null)
    const labels: Record<string, string> = Object.create(null)
    if (item.type === 'noul' && (
      item.options.length !== 2 || item.options[0]?.key !== 'true' || item.options[1]?.key !== 'false'
    )) throw new Error(`「${name}」的“是”和“否”选项不完整`)
    if (item.type === 'choice' && (item.options.length < 2 || item.options.length > 255)) {
      throw new Error(`「${name}」需要 2 到 255 个选项`)
    }
    if (item.type === 'score' && (item.options.length < 2 || item.options.length > 10)) {
      throw new Error(`「${name}」需要 2 到 10 个评分档位`)
    }
    const optionKeys = new Set<string>()
    item.options.forEach((option, optionIndex) => {
      if (!option.description.trim()) throw new Error(`「${name}」的第 ${optionIndex + 1} 个选项缺少说明`)
      if (Array.isArray(criteria)) {
        criteria.push(option.description.trim())
      } else {
        const optionKey = option.key.trim()
        if (!optionKey) throw new Error(`「${name}」的第 ${optionIndex + 1} 个选项缺少编号`)
        if (optionKeys.has(optionKey)) throw new Error(`「${name}」存在重复的选项编号`)
        optionKeys.add(optionKey)
        criteria[optionKey] = option.description.trim()
        if (option.label.trim()) labels[optionKey] = option.label.trim()
      }
    })
    const question: Record<string, unknown> = {
      ...item.extra,
      type: item.type,
      instructions: item.instructions.trim(),
      criteria,
    }
    if (title) question.title = title
    if (Object.keys(labels).length) question.labels = labels
    if (item.type === 'score' && item.options.some((option) => option.label.trim())) {
      question.level_labels = item.options.map((option) => option.label.trim())
    }
    return [key, question] as const
  })
  if (kind === 'persona') {
    if (items.find((item) => item.key.trim() === 'evidence_sufficient')?.type !== 'noul') {
      throw new Error('人设题集缺少编号为 evidence_sufficient 的是非题')
    }
    if (!items.some((item) => item.key.trim() !== 'evidence_sufficient' && item.type !== 'noul')) {
      throw new Error('人设题集还需要至少一道选项题或评分题')
    }
  }
  return JSON.stringify(Object.fromEntries(entries))
}

export function defaultOptions(type: QuestionType): QuestionOption[] {
  if (type === 'noul') return [
    { key: 'true', label: '是', description: '' },
    { key: 'false', label: '否', description: '' },
  ]
  if (type === 'score') return [
    { key: '0', label: '', description: '' },
    { key: '1', label: '', description: '' },
  ]
  return [
    { key: 'option_a', label: '', description: '' },
    { key: 'option_b', label: '', description: '' },
  ]
}

export function newQuestion(items: QuestionItem[], kind: 'judge' | 'persona'): QuestionItem {
  const evidence = kind === 'persona' && !items.some((item) => item.key === 'evidence_sufficient')
  const type: QuestionType = evidence ? 'noul' : 'choice'
  const keyBase = kind === 'persona' ? 'trait' : 'question'
  let number = items.length + 1
  while (items.some((item) => item.key === `${keyBase}_${number}`)) number += 1
  return {
    id: nextQuestionId++,
    key: evidence ? 'evidence_sufficient' : `${keyBase}_${number}`,
    title: evidence ? '信息是否足够' : '',
    type,
    instructions: '',
    options: defaultOptions(type),
    extra: {},
  }
}

export function questionCount(raw: string): number {
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? Object.keys(parsed).length : 0
  } catch { return 0 }
}

export function QuestionSetView({ raw }: { raw: string }) {
  let items: QuestionItem[]
  try { items = parseQuestionSet(raw) } catch {
    return <p className="text-[13px] text-ink-muted">题集内容无法显示</p>
  }
  // 「信息是否足够」是判定链路内部的兜底题，不对外展示
  const visible = items.filter((item) => item.key !== 'evidence_sufficient')
  if (!visible.length) return <p className="text-[13px] text-ink-muted">暂无题目</p>
  return (
    <div className="space-y-2.5">
      {visible.map((item, index) => (
        <details
          key={item.id}
          open={index === 0}
          className="group/q overflow-hidden rounded-[12px] border border-border bg-surface transition-colors duration-200 hover:border-border-strong open:border-border-strong"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
            <span className="tnum grid h-5 w-5 shrink-0 place-items-center rounded-[6px] bg-surface-muted text-[11px] font-semibold text-ink-muted transition-colors duration-200 group-open/q:bg-primary-soft group-open/q:text-primary">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-ink">{displayTitle(item)}</span>
              {displayTitle(item) !== item.key && (
                <span className="mono mt-0.5 block truncate text-[11px] text-ink-faint">{item.key}</span>
              )}
            </span>
            <span className="shrink-0 rounded-[6px] bg-surface-muted px-1.5 py-0.5 text-[11px] text-ink-secondary">
              {typeNames[item.type]}
            </span>
            <IconChevronDown className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 group-open/q:rotate-180" />
          </summary>

          <div className="space-y-3.5 border-t border-border-subtle bg-surface-muted/40 px-3.5 py-3.5">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-faint">判断说明</p>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-[22px] text-ink">
                {item.instructions || '未填写'}
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold tracking-[0.12em] text-ink-faint">
                {item.type === 'score' ? '评分档位' : '选项'}
                <span className="tnum ml-1.5 font-normal tracking-normal text-ink-muted">{item.options.length}</span>
              </p>
              {item.options.map((option, optionIndex) => (
                <div
                  key={`${option.key}-${optionIndex}`}
                  className="grid gap-x-3 gap-y-0.5 rounded-[9px] border border-border-subtle bg-surface px-3 py-2 sm:grid-cols-[minmax(120px,1fr)_minmax(0,3fr)]"
                >
                  <span className="break-all text-[13px] font-medium text-ink-secondary">
                    {option.label || (item.type === 'noul' ? (option.key === 'true' ? '是' : '否') : item.type === 'score' ? `档位 ${optionIndex + 1}` : option.key)}
                  </span>
                  <span className="whitespace-pre-wrap break-words text-[13px] leading-5 text-ink">{option.description}</span>
                </div>
              ))}
            </div>
          </div>
        </details>
      ))}
    </div>
  )
}
