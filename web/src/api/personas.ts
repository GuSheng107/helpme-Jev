import { api } from './client'
import type { Conversation } from './chat'

export interface Trait {
  key: string
  title: string
  text: string
  weak_science: boolean
}

export interface PersonaView {
  counterpart_key: string
  subject: 'me' | 'other'
  context: 'romance' | 'workplace'
  traits: Trait[]
  confidence: number
  version: number
  kept?: boolean
  reason?: string
}

export interface ChatPreview {
  count: number
  skipped: number
  messages: { role: string; content: string; label: string }[]
}

export type PersonaContext = 'romance' | 'workplace'

export function getPersona(
  counterpartKey: string,
  subject: 'me' | 'other',
  context: PersonaContext = 'romance',
) {
  return api.get<PersonaView>(
    `/api/personas?counterpart_key=${encodeURIComponent(counterpartKey)}&subject=${subject}&context=${context}`,
  )
}

export function buildPersona(
  conversationId: number,
  subject: 'me' | 'other',
  selfReport: Record<string, string | number> = {},
  context?: PersonaContext,
  memberKey = '',
) {
  return api.post<PersonaView>('/api/personas/build', {
    conversation_id: conversationId,
    subject,
    self_report: selfReport,
    context,
    member_key: memberKey,
  })
}

export interface PersonaBatchParticipant {
  key: string
  name: string
  subject: 'me' | 'other'
  persona: PersonaView
}

export interface PersonaBatch {
  conversation_id: number
  is_group: boolean
  context: PersonaContext
  counterpart_key: string
  participants: PersonaBatchParticipant[]
  memories: { id: number; subject: string; category: string; content: string }[]
}

/** 批量获取一个会话里所有人的人设与上下文（群聊 = 每位成员 + 我）。 */
export function fetchPersonaBatch(conversationId: number, context?: PersonaContext) {
  const suffix = context ? `&context=${context}` : ''
  return api.get<PersonaBatch>(`/api/personas/batch?conversation_id=${conversationId}${suffix}`)
}

export function personaUsage() {
  return api.get<{ adopted: number; rewritten: number }>('/api/personas/usage')
}

export function previewChat(conversationId: number, text: string, otherLabels?: string[]) {
  return api.post<ChatPreview>('/api/import/chat/preview', {
    conversation_id: conversationId,
    text,
    other_labels: otherLabels,
  })
}

export function commitChat(conversationId: number, text: string, otherLabels?: string[]) {
  return api.post<{ imported: number; skipped: number }>('/api/import/chat', {
    conversation_id: conversationId,
    text,
    other_labels: otherLabels,
  })
}

export function importQa(raw: string, conversationId: number | null) {
  return api.post<{ imported: number }>('/api/import/qa', { raw, conversation_id: conversationId })
}

export type { Conversation }
