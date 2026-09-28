import type { LogCategory } from '../api/logs'

export const CATEGORY_LABELS: Record<LogCategory, string> = {
  auth: '登录与认证',
  chat: '聊天',
  decision: '决策',
  persona: '人设与导入',
  scenario: '场景',
  admin: '管理',
  settings: '设置',
  model: '模型',
}

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
