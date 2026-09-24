/**
 * 时间展示统一入口。
 *
 * 后端一律存 UTC、返回 `...Z` 结尾的 ISO，这里按**浏览器时区**换算后再展示。
 * 别再把 ISO 字符串直接截断当时间用 —— 那样显示的是 UTC 钟点，会差一个时区。
 */

function parse(iso: string): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 列表 / 详情：2026/9/25 01:22:08 */
export function formatLocalTime(iso: string): string {
  const date = parse(iso)
  return date ? date.toLocaleString('zh-CN', { hour12: false }) : iso || '—'
}

/** 紧凑场景：2026-09-25 01:22 */
export function formatLocalMinute(iso: string): string {
  const date = parse(iso)
  if (!date) return iso || '—'
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 文件名 / 日期标签：2026-09-25 */
export function formatLocalDate(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
