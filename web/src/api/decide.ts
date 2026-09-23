import { api } from './client'

export type QuestionType = 'noul' | 'choice' | 'score'

export interface DecideBar {
  key: string
  label: string
  value: number
}

export interface DecideResult {
  kind: QuestionType
  probability?: number
  percent?: number
  text?: string
  bars?: DecideBar[]
  top?: string
  value?: number
  scale_max?: number
}

export interface DecideResponse {
  trace_id: string
  model: string
  latency_ms: number
  kind: QuestionType
  result: DecideResult
}

export function decide(body: {
  question: string
  question_type: QuestionType
  options?: string[]
  context?: string
}) {
  return api.post<DecideResponse>('/api/decide', body)
}
