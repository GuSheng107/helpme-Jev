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
  display_value?: number
  display_max?: number
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

export interface DecisionHistoryItem {
  id: number
  question: string
  question_type: QuestionType | 'unknown'
  options: string[]
  context: string
  status: 'success' | 'error'
  result: DecideResult | null
  error: string
  model: string
  latency_ms: number
  created_at: string
}

export interface DecisionHistoryPage {
  total: number
  items: DecisionHistoryItem[]
  retention_days: number
}

export function listDecisionHistory(limit = 10, offset = 0) {
  return api.get<DecisionHistoryPage>(`/api/decide/history?limit=${limit}&offset=${offset}`)
}


export interface DecisionPolishInput {
  question: string
  question_type: QuestionType
  options: string[]
  context: string
}

export interface DecisionPolishResult {
  question: string
  options: string[]
  context: string
}

export function polishDecision(body: DecisionPolishInput) {
  return api.post<DecisionPolishResult>('/api/decide/polish', body)
}
