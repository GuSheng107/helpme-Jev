import { api, ApiError, postStream, type ApiErrorBody } from './client'

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

export type DecideStepKey = 'translate' | 'decide'

/** 流式判断的阶段事件：plan 先交代这次要走几步，之后每完成一步推一条。 */
export interface DecideStreamEvent {
  stage: 'plan' | 'translate_done' | 'done' | 'error'
  steps?: DecideStepKey[]
  payload?: DecideResponse
  error?: ApiErrorBody
}

export function decide(
  body: {
    question: string
    question_type: QuestionType
    options?: string[]
    context?: string
  },
  onEvent?: (event: DecideStreamEvent) => void,
): Promise<DecideResponse> {
  let answer: DecideResponse | null = null
  let failure: ApiErrorBody | null = null
  return postStream('/api/decide/stream', body, (raw) => {
    const event = raw as DecideStreamEvent
    if (event.stage === 'done') {
      answer = event.payload ?? null
      onEvent?.(event)
      return
    }
    if (event.stage === 'error') {
      failure = event.error ?? { code: 'UNKNOWN', message: '判断未完成，请重试' }
      return
    }
    onEvent?.(event)
  }).then(() => {
    if (failure) throw new ApiError(502, failure)
    if (!answer) throw new ApiError(0, { code: 'UNKNOWN', message: '判断未完成，请重试' })
    return answer
  })
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
