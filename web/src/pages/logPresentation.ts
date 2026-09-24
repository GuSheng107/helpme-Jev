export const PHASE_LABELS: Record<string, string> = {
  translate: '翻译',
  analyze: '判断',
  describe: '读图',
  decide: '决策',
  connect: '连通测试',
  vision: '看图测试',
  reflect: '记忆整理',
  summarize: '摘要',
  polish: '润色',
}

export const KIND_LABELS = { jev: 'JEV', llm: 'LLM' } as const

type LevelTone = 'success' | 'primary' | 'warning' | 'danger' | 'info'

/** 级别文案：warn 是「流程没断但结果被降级」，不是失败。 */
export const LEVEL_LABELS: Record<string, string> = {
  info: '信息',
  warn: '警告',
  error: '错误',
}

/** 级别配色：文字 + 颜色双表达，未知级别按「信息」兜底。 */
export const LEVEL_TONES: Record<string, LevelTone> = {
  info: 'info',
  warn: 'warning',
  error: 'danger',
}

export function levelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level
}

export function levelTone(level: string): LevelTone {
  return LEVEL_TONES[level] ?? 'info'
}

export function prettyLogValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
