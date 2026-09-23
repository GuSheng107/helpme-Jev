import { api } from './client'

export interface ChatMessage {
  id: number
  seq: number
  role: 'me' | 'other'
  content: string
  created_at: string
}

export interface Conversation {
  id: number
  title: string
  counterpart_name: string
  counterpart_key: string
  relationship: string
  scenario_id: number | null
  message_count: number
}

export interface ProbBar {
  key: string
  label: string
  value: number
}

export interface JudgeItem {
  key: string
  title: string
  kind: 'choice' | 'noul' | 'score' | 'missing'
  text: string
  value?: string | number
  confidence?: number | null
  probability?: number | null
  score?: number | null
  scale_max?: number
  tone?: 'success' | 'warning' | 'danger' | 'info'
  bars?: ProbBar[]
}

export interface AnalyzeResult {
  panel: JudgeItem[]
  more: JudgeItem[]
  high_danger: boolean
  context_sufficient: boolean
  trace_id: string
  model: string
  latency_ms: number
  message_count: number
}

export function listConversations() {
  return api.get<Conversation[]>('/api/conversations')
}

export function createConversation(body: {
  title: string
  counterpart_name: string
  relationship: string
}) {
  return api.post<Conversation>('/api/conversations', body)
}

export function listMessages(conversationId: number) {
  return api.get<ChatMessage[]>(`/api/conversations/${conversationId}/messages`)
}

export function appendMessage(conversationId: number, role: 'me' | 'other', content: string) {
  return api.post<ChatMessage>(`/api/conversations/${conversationId}/messages`, { role, content })
}

export function analyze(conversationId: number) {
  return api.post<AnalyzeResult>('/api/chat/analyze', { conversation_id: conversationId })
}
