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
  memory_count: number
  context_truncated: boolean
}

export interface MemoryChange {
  op: string
  subject?: string
  category?: string
  content?: string
  skipped?: string
}

export interface Reflection {
  id: number
  changes: MemoryChange[]
  reverted_at: string | null
}

export interface MemoryItem {
  id: number
  subject: string
  category: string
  content: string
  counterpart_key: string
  created_at: string
}

export function listMemories() {
  return api.get<{ total: number; items: MemoryItem[] }>('/api/chat/memories')
}

export function forgetMemory(id: number) {
  return api.delete<void>(`/api/chat/memories/${id}`)
}

export function listReflections() {
  return api.get<Reflection[]>('/api/chat/reflections')
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

export interface Candidate {
  text: string
  percent: number
}

export function analyze(conversationId: number) {
  return api.post<AnalyzeResult>('/api/chat/analyze', { conversation_id: conversationId })
}

export function draftReplies(conversationId: number, decision: AnalyzeResult) {
  const picked = Object.fromEntries(
    [...decision.panel, ...decision.more].map((item) => [item.key, { text: item.text }]),
  )
  return api.post<{ candidates: Candidate[] }>('/api/chat/reply', {
    conversation_id: conversationId,
    decision: picked,
  })
}

export function evaluateReply(conversationId: number, text: string) {
  return api.post<{ percent: number; verdict: string }>('/api/chat/evaluate', {
    conversation_id: conversationId,
    text,
  })
}

export function clarify(conversationId: number) {
  return api.post<{ questions: string[] }>('/api/chat/clarify', { conversation_id: conversationId })
}

export function polish(text: string, kind: 'chat' | 'reply' | 'question') {
  return api.post<{ text: string }>('/api/chat/polish', { text, kind })
}

export function reflect(conversationId: number) {
  return api.post<Reflection>('/api/chat/reflect', { conversation_id: conversationId })
}

export function revertReflection(id: number) {
  return api.post<Reflection>(`/api/chat/reflect/${id}/revert`)
}
