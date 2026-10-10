import type { PersonaContext } from '../api/personas'

export type { PersonaContext }

/**
 * 人设维度库 —— 全站唯一的人设题目来源。
 *
 * 人设建立在有公开定义的维度上（大五人格、依恋类型、爱的语言、冲突风格、DISC），
 * 题目由本库按所选维度拼装，场景与档位只能从库里取，不另生成题面。
 */

/** 9 档评分，与后端 OCEAN_LEVELS 逐档对齐（0–8）。 */
export const SCORE_LEVELS = ['很低', '低', '略低', '中下', '一般', '中上', '略高', '高', '很高']

const OCEAN_LEVELS_EN = [
  'Very low.',
  'Low.',
  'Somewhat low.',
  'Slightly below average.',
  'Average.',
  'Slightly above average.',
  'Somewhat high.',
  'High.',
  'Very high.',
]

const INFER_SUFFIX = 'Infer only from the conversation. Cite a concrete message when possible.'

export interface DimOption {
  value: string
  label: string
  note: string
}

export interface Dimension {
  key: string
  /** 维度名（档案展示用） */
  title: string
  /** 建档题面（自然表述） */
  question: string
  /** 一句话对照说明 */
  hint: string
  type: 'score' | 'choice'
  /** 英文判别说明（喂给判定模型） */
  instruction: string
  options?: DimOption[]
  group: DimensionGroup
}

export type DimensionGroup = 'core' | 'relation' | 'interaction' | 'work'

export const DIMENSION_GROUPS: { key: DimensionGroup; label: string; hint: string }[] = [
  { key: 'core', label: '核心特质', hint: '性格底色' },
  { key: 'relation', label: '关系模式', hint: '亲密关系中的需求与敏感点' },
  { key: 'interaction', label: '互动方式', hint: '出现分歧时的处理倾向' },
  { key: 'work', label: '工作风格', hint: '协作中的行事倾向' },
]

export const DIMENSIONS: Dimension[] = [
  {
    key: 'openness',
    title: '开放性',
    question: '对新想法、新体验的开放程度',
    hint: '爱尝新 ↔ 偏好熟悉',
    type: 'score',
    instruction: `How open to new ideas and experiences is the other person? ${INFER_SUFFIX}`,
    group: 'core',
  },
  {
    key: 'conscientiousness',
    title: '尽责性',
    question: '做事是否有计划、可靠',
    hint: '有计划 ↔ 随性',
    type: 'score',
    instruction: `How organized, reliable, and duty-bound is the other person? ${INFER_SUFFIX}`,
    group: 'core',
  },
  {
    key: 'extraversion',
    title: '外向性',
    question: '在人群中的能量来源',
    hint: '人来疯 ↔ 独处充电',
    type: 'score',
    instruction: `How outgoing and energized by people is the other person? ${INFER_SUFFIX}`,
    group: 'core',
  },
  {
    key: 'agreeableness',
    title: '宜人性',
    question: '与人相处的合作与体谅',
    hint: '随和 ↔ 直接',
    type: 'score',
    instruction: `How warm, cooperative, and considerate is the other person? ${INFER_SUFFIX}`,
    group: 'core',
  },
  {
    key: 'emotional_stability',
    title: '情绪稳定',
    question: '压力下的稳定程度',
    hint: '稳得住 ↔ 易起伏',
    type: 'score',
    instruction: `How steady is the other person under stress, as opposed to easily upset? ${INFER_SUFFIX}`,
    group: 'core',
  },
  {
    key: 'sensitivity',
    title: '情绪敏感',
    question: '情绪与批评对 TA 的影响强度',
    hint: '钝感 ↔ 敏感',
    type: 'score',
    instruction: `How strongly does ordinary emotion or criticism affect the other person? ${INFER_SUFFIX}`,
    group: 'relation',
  },
  {
    key: 'attachment',
    title: '依恋倾向',
    question: '亲密关系里的靠近与抽离',
    hint: '被冷落或被逼近时的本能反应',
    type: 'choice',
    instruction: `Which attachment pattern best fits the other person in this relationship? ${INFER_SUFFIX}`,
    group: 'relation',
    options: [
      { value: 'secure', label: '安全型', note: '既能亲近也能独立，冲突后能修复' },
      { value: 'anxious', label: '焦虑型', note: '常要确认对方还在意' },
      { value: 'avoidant', label: '回避型', note: '太近了会想退开' },
      { value: 'disorganized', label: '混乱型', note: '时近时远，说不清' },
    ],
  },
  {
    key: 'love_language',
    title: '爱的语言',
    question: '最在意哪种被在乎的方式',
    hint: '哪种方式最能让 TA 感到被在乎',
    type: 'choice',
    instruction: `Which way of receiving care matters most to the other person? ${INFER_SUFFIX}`,
    group: 'relation',
    options: [
      { value: 'words', label: '肯定的言辞', note: '被肯定、被鼓励' },
      { value: 'time', label: '精心的时刻', note: '专注、不被打扰的陪伴' },
      { value: 'gifts', label: '接受礼物', note: '有心意的物件' },
      { value: 'service', label: '服务的行动', note: '帮 TA 分担事务' },
      { value: 'touch', label: '身体的接触', note: '拥抱等肢体亲近' },
    ],
  },
  {
    key: 'conflict_style',
    title: '冲突风格',
    question: '出现分歧时通常怎么处理',
    hint: '吵起来时的第一反应',
    type: 'choice',
    instruction: `How does the other person usually handle disagreement? ${INFER_SUFFIX}`,
    group: 'interaction',
    options: [
      { value: 'competing', label: '竞争', note: '坚持自己的立场' },
      { value: 'collaborating', label: '协作', note: '一起找两边都接受的办法' },
      { value: 'compromising', label: '妥协', note: '各退一步' },
      { value: 'avoiding', label: '回避', note: '先放着，缓一缓' },
      { value: 'accommodating', label: '迁就', note: '让步，息事宁人' },
    ],
  },
  {
    key: 'disc',
    title: 'DISC 工作风格',
    question: '协作中的行事倾向',
    hint: '推进事情时的节奏与关注点',
    type: 'choice',
    instruction: `Which DISC profile best fits the other person's work style? ${INFER_SUFFIX}`,
    group: 'work',
    options: [
      { value: 'dominance', label: '支配型 D', note: '直接，先冲结果' },
      { value: 'influence', label: '影响型 I', note: '热情，靠说服和关系' },
      { value: 'steadiness', label: '稳健型 S', note: '耐心，求稳求节奏' },
      { value: 'conscientiousness', label: '严谨型 C', note: '严谨，细节要核对' },
    ],
  },
]

/* ------------------------------------------------------------------ 档位 */

export interface ContextPreset {
  key: string
  label: string
  /** 一行说明：这个档位用在什么关系里 */
  hint: string
  dimensions: string[]
}

/**
 * 内置档位：键名固定，与后端 CONTEXT_PRESETS 一一对应。
 * 档位跟随场景：内置场景只有恋爱 / 职场，其余关系用自定义档位。
 */
export const CONTEXT_PRESETS: ContextPreset[] = [
  {
    key: 'romance',
    label: '恋爱',
    hint: '亲密关系',
    dimensions: [
      'openness',
      'conscientiousness',
      'extraversion',
      'agreeableness',
      'emotional_stability',
      'attachment',
      'love_language',
      'conflict_style',
      'sensitivity',
    ],
  },
  {
    key: 'workplace',
    label: '职场',
    hint: '同事与上下级',
    dimensions: [
      'openness',
      'conscientiousness',
      'extraversion',
      'agreeableness',
      'emotional_stability',
      'disc',
      'conflict_style',
    ],
  },
]

/** 自定义档位的标识：走这个 slug 落库，档位名另存 context_label。 */
export const CUSTOM_CONTEXT = 'custom'
/** 自定义档位默认取用的维度（大五 + 冲突风格，与后端 GENERAL_DIMENSIONS 一致）。 */
export const CUSTOM_CONTEXT_DEFAULT_DIMENSIONS = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'emotional_stability',
  'conflict_style',
]

export const DEFAULT_CONTEXT = 'romance'

/** 一个档位最多勾选的维度数（就是维度库本身的上限）。 */
export const MAX_DIMENSIONS = DIMENSIONS.length

export function isPresetContext(context: string): boolean {
  return CONTEXT_PRESETS.some((item) => item.key === context)
}

export function presetOf(context: string): ContextPreset | undefined {
  return CONTEXT_PRESETS.find((item) => item.key === context)
}

/** 档位显示名：优先取档位自带的名字，其次内置档位名，最后给个中性兜底。 */
export function contextLabelOf(context: string, label = ''): string {
  const trimmed = (label || '').trim()
  if (trimmed) return trimmed
  return presetOf(context)?.label ?? '自定义'
}

export function dimensionByKey(key: string): Dimension | undefined {
  return DIMENSIONS.find((item) => item.key === key)
}

/** 把维度 key 列表解析成维度对象（库外的 key 忽略，顺序按库里定义）。 */
export function resolveDimensions(keys: string[]): Dimension[] {
  const wanted = new Set(keys)
  return DIMENSIONS.filter((item) => wanted.has(item.key))
}

/**
 * 某个档位取用的维度。
 *
 * 内置档位按预设取；自定义档位用调用方给的 keys，
 * 没给就回落到默认那套（大五 + 冲突风格）。
 */
export function dimensionsOf(context: string, keys?: string[]): Dimension[] {
  const preset = presetOf(context)
  if (preset) return resolveDimensions(preset.dimensions)
  const picked = keys && keys.length > 0 ? keys : CUSTOM_CONTEXT_DEFAULT_DIMENSIONS
  return resolveDimensions(picked)
}

/** 档位对应的维度 key 列表（拼装题集用）。 */
export function dimensionKeysOf(context: string, keys?: string[]): string[] {
  const preset = presetOf(context)
  if (preset) return [...preset.dimensions]
  return keys && keys.length > 0 ? [...keys] : [...CUSTOM_CONTEXT_DEFAULT_DIMENSIONS]
}

/* ------------------------------------------------------------------ 题集 */

const EVIDENCE_QUESTION = {
  type: 'noul',
  title: '信息是否足够',
  instructions: `Is there enough evidence to update the other person's persona without guessing? ${INFER_SUFFIX}`,
  criteria: {
    true: 'Several distinct signals support the same reading.',
    false: 'The record is too short, mixed, or only one ambiguous line.',
  },
}

function questionOf(dim: Dimension): Record<string, unknown> {
  if (dim.type === 'score') {
    return {
      type: 'score',
      title: dim.title,
      instructions: dim.instruction,
      criteria: OCEAN_LEVELS_EN,
      level_labels: SCORE_LEVELS,
    }
  }
  const criteria: Record<string, string> = {}
  const labels: Record<string, string> = {}
  for (const option of dim.options ?? []) {
    criteria[option.value] = option.note
    labels[option.value] = option.label
  }
  return { type: 'choice', title: dim.title, instructions: dim.instruction, criteria, labels }
}

/** 由维度库按所选维度拼装一套人设题集（JSON 字符串），供场景保存 / 预览使用。 */
export function buildPersonaQuestions(contextOrKeys: string | string[]): string {
  const keys = Array.isArray(contextOrKeys)
    ? contextOrKeys
    : dimensionKeysOf(contextOrKeys)
  const result: Record<string, unknown> = {}
  for (const dim of resolveDimensions(keys)) {
    result[dim.key] = questionOf(dim)
  }
  result.evidence_sufficient = EVIDENCE_QUESTION
  return JSON.stringify(result)
}

/** 从人设题集反推所用的维度 key（顺序按库里定义）。 */
export function personaKeysOf(raw?: string): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return []
    return resolveDimensions(Object.keys(parsed)).map((item) => item.key)
  } catch {
    return []
  }
}

/** 由人设题集反推档位：维度组合与某个内置档位一致就算那一档，否则算自定义。 */
export function contextOfPersonaQuestions(raw?: string): string {
  const keys = personaKeysOf(raw)
  if (keys.length === 0) return CUSTOM_CONTEXT
  const same = (a: string[]) => a.length === keys.length && a.every((key) => keys.includes(key))
  return CONTEXT_PRESETS.find((item) => same(item.dimensions))?.key ?? CUSTOM_CONTEXT
}

const GRADES = ['score', 'choice', 'noul'] as const

/** 校验一段题集 JSON 是否含至少一道可作答的特质题（供场景编辑器提示用）。 */
export function traitCount(raw: string): number {
  try {
    const parsed = JSON.parse(raw || '{}') as Record<string, { type?: string }>
    return Object.entries(parsed).filter(
      ([key, value]) => key !== 'evidence_sufficient' && GRADES.includes((value?.type ?? '') as never),
    ).length
  } catch {
    return 0
  }
}
