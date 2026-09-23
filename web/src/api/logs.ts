import { api, request } from './client'

export interface LogItem {
  id: number
  trace_id: string
  kind: 'jev' | 'llm'
  phase: string
  model: string
  status_code: number | null
  latency_ms: number
  error: string
  truncated: boolean
  created_at: string
  request: unknown
  response: unknown
}

export interface LogLine {
  seq: string
  original: string
  annotated: string
}

export function listLogs(params: {
  limit?: number
  offset?: number
  kind?: 'jev' | 'llm' | ''
  trace_id?: string
} = {}) {
  const search = new URLSearchParams()
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  if (params.kind) search.set('kind', params.kind)
  if (params.trace_id) search.set('trace_id', params.trace_id)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return api.get<{ total: number; items: LogItem[] }>(`/api/logs${suffix}`)
}

/** 导出本人全部数据（JSON 下载）。 */
export async function exportAccountData(): Promise<Blob> {
  const payload = await api.get<Record<string, unknown>>('/api/account/export')
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
}

/** 注销账号：密码确认，删除后 204。 */
export function deleteAccount(password: string) {
  return request<void>('/api/account', { method: 'DELETE', body: { password } })
}
