import { api, fetchBlob, postForm } from './client'

export interface ImageAttachment {
  type: 'image'
  id: number
  mime: string
}

export interface ChatMessage {
  id: number
  seq: number
  role: 'me' | 'other'
  content: string
  attachments: ImageAttachment[]
  /** 这条内容怎么来的：manual=自己写的 candidate=采用推荐 rewrite=改写推荐 import=导入 */
  source: 'manual' | 'candidate' | 'rewrite' | 'import'
  created_at: string
}

export interface Conversation {
  id: number
  title: string
  counterpart_name: string
  counterpart_key: string
  relationship: string
  scenario_id: number | null
  scenario_kind: string
  message_count: number
}

export interface Scenario {
  id: number
  slug: string
  name: string
  kind: string
  description: string
  is_builtin: boolean
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
  sufficiency_percent: number
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

export function listScenarios() {
  return api.get<Scenario[]>('/api/scenarios')
}

export function createConversation(body: {
  title: string
  counterpart_name: string
  relationship: string
  scenario_id?: number | null
}) {
  return api.post<Conversation>('/api/conversations', body)
}

export function listMessages(conversationId: number) {
  return api.get<ChatMessage[]>(`/api/conversations/${conversationId}/messages`)
}

export function appendMessage(
  conversationId: number,
  role: 'me' | 'other',
  content: string,
  source: 'manual' | 'candidate' | 'rewrite' | 'import' = 'manual',
  attachmentIds: number[] = [],
) {
  return api.post<ChatMessage>(`/api/conversations/${conversationId}/messages`, {
    role,
    content,
    source,
    attachment_ids: attachmentIds,
  })
}

export interface UploadedImage {
  id: number
  mime: string
  bytes: number
}

/** 上传一张会话图片（需默认 LLM 支持看图，后端会拦）。 */
export function uploadImage(conversationId: number, file: File) {
  const form = new FormData()
  form.append('file', file, file.name || 'image')
  return postForm<UploadedImage>(`/api/conversations/${conversationId}/images`, form)
}

/** 拉取图片原图（带鉴权），调用方负责 createObjectURL / revoke。 */
export function fetchMaterialFile(materialId: number) {
  return fetchBlob(`/api/materials/${materialId}/file`)
}

/** 当前默认 LLM 是否支持看图（用于贴图入口的门控）。 */
export function defaultLlmSupportsVision(): Promise<boolean> {
  return api
    .get<{ kind: string; supports_vision: boolean; is_default: boolean }[]>('/api/providers?kind=llm')
    .then((rows) => {
      if (rows.length === 0) return false
      const chosen = rows.find((row) => row.is_default) ?? rows[0]
      return Boolean(chosen.supports_vision)
    })
    .catch(() => false)
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
    [...decision.panel, ...decision.more].map((item) => [item.key, { text: item.text, value: item.value }]),
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

export function explainDecision(conversationId: number, decision: AnalyzeResult) {
  const picked = Object.fromEntries(
    [...decision.panel, ...decision.more].map((item) => [item.key, { text: item.text, value: item.value }]),
  )
  return api.post<{ reason: string }>('/api/chat/explain', {
    conversation_id: conversationId,
    decision: picked,
  })
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
