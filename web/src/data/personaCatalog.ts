import type { PersonaContext } from '../api/personas'

export type { PersonaContext }

/**
 * 人设维度库 —— 全站唯一的人设题目来源。
 *
 * 为什么要这座库：
 * 人设必须建立在**有依据、可解释**的维度上（大五人格、依恋类型、爱的语言、
 * 冲突风格、DISC）。过去自定义场景让语言模型现编题目，结果题面模板腔、
 * 维度混乱，还会与判断链路用的题目对不上。现在题目一律由本库确定性拼装，
 * 场景只能在库里**挑选**维度，不再自由生成。
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
  /** 英文判别说明（喂给 JEV 决策模型） */
  instruction: string
  options?: DimOption[]
  /** 该框架的科学证据有限，展示时需注明 */
  weakScience?: boolean
  group: DimensionGroup
}

export type DimensionGroup = 'core' | 'relation' | 'interaction' | 'work'

export const DIMENSION_GROUPS: { key: DimensionGroup; label: string; hint: string }[] = [
  { key: 'core', label: '核心特质', hint: '性格底色，决定沟通的温度与节奏' },
  { key: 'relation', label: '关系模式', hint: '亲密关系中的需求与敏感点' },
  { key: 'interaction', label: '互动方式', hint: '出现分歧时的处理倾向' },
  { key: 'work', label: '工作风格', hint: '职场协作中的行事倾向' },
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
    hint: '哪种方式最能让 TA 感到被爱',
    type: 'choice',
    instruction: `Which way of receiving care matters most to the other person? ${INFER_SUFFIX}`,
    weakScience: true,
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
    question: '职场协作中的行事倾向',
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

/** 两档人设各自使用的维度（顺序与后端内置题集一致）。 */
export const CONTEXT_DIMENSIONS: Record<PersonaContext, string[]> = {
  romance: [
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
  workplace: [
    'openness',
    'conscientiousness',
    'extraversion',
    'agreeableness',
    'emotional_stability',
    'disc',
    'conflict_style',
  ],
}

export const CONTEXT_LABELS: Record<PersonaContext, string> = {
  romance: '恋爱',
  workplace: '职场',
}

export function dimensionByKey(key: string): Dimension | undefined {
  return DIMENSIONS.find((item) => item.key === key)
}

export function dimensionsFor(context: PersonaContext): Dimension[] {
  return CONTEXT_DIMENSIONS[context]
    .map((key) => dimensionByKey(key))
    .filter((item): item is Dimension => Boolean(item))
}

const EVIDENCE_QUESTION = {
  type: 'noul',
  title: '证据是否充足',
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

/** 由维度库确定性拼装一套标准人设题集（JSON 字符串），供场景保存 / 预览使用。 */
export function buildPersonaQuestions(context: PersonaContext): string {
  const result: Record<string, unknown> = {}
  for (const dim of dimensionsFor(context)) {
    result[dim.key] = questionOf(dim)
  }
  result.evidence_sufficient = EVIDENCE_QUESTION
  return JSON.stringify(result)
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
