/** 提供方配置接口与类型。 */

import { api } from './client'

export type ProviderKind = 'jev' | 'llm'
export type LlmProtocol = 'openai' | 'openai_responses' | 'anthropic'

export interface ProviderView {
  id: number
  kind: ProviderKind
  protocol: LlmProtocol
  name: string
  endpoint_url: string
  model: string
  supports_vision: boolean
  context_window_tokens: number
  is_default: boolean
  is_enabled: boolean
  last_test_ok: boolean | null
  last_tested_at: string
  /** 只回掩码，绝不回明文 */
  api_key_masked: string
  created_at: string
  updated_at: string
}

export interface SmokeCaseView {
  name: string
  passed: boolean
  expected: string
  actual: string
}

export interface SmokeReportView {
  total: number
  passed: number
  health: number
  outcomes: SmokeCaseView[]
}

export interface ConnectionTestResult {
  ok: boolean
  detail: string
  latency_ms: number
  error_code: string
  model_reported: string
  smoke: SmokeReportView | null
}

export interface ProviderCreatePayload {
  kind: ProviderKind
  protocol?: LlmProtocol
  name: string
  endpoint_url: string
  api_key: string
  model: string
  supports_vision?: boolean
  context_window_tokens?: number
  is_default?: boolean
  is_enabled?: boolean
}

export type ProviderUpdatePayload = Partial<Omit<ProviderCreatePayload, 'kind'>>

export const listProviders = (kind?: ProviderKind) =>
  api.get<ProviderView[]>(kind ? `/api/providers?kind=${kind}` : '/api/providers')

export const createProvider = (payload: ProviderCreatePayload) =>
  api.post<ProviderView>('/api/providers', payload)

/** 注意：不传 api_key 表示**保持原值**（空字符串不承担"清空"语义）。 */
export const updateProvider = (id: number, payload: ProviderUpdatePayload) =>
  api.patch<ProviderView>(`/api/providers/${id}`, payload)

export const deleteProvider = (id: number) => api.delete<void>(`/api/providers/${id}`)

export const testProvider = (id: number) =>
  api.post<ConnectionTestResult>(`/api/providers/${id}/test`)
