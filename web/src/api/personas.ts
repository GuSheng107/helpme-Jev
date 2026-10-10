import { api } from './client'
import type { Conversation } from './chat'

export interface Trait {
  key: string
  title: string
  text: string
  weak_science: boolean
}

export interface ChatPreview {
  count: number
  skipped: number
  messages: { role: string; content: string; label: string }[]
}

/** 人设档位标识：内置档位是固定 slug，自定义档位由前端生成 cx_xxxxxx 形式。 */
export type PersonaContext = string

// ------------------------------------------------------------------ 人设库
export interface PersonaProfileView {
  id: number
  key: string
  nickname: string
  avatar_base64: string
  context: PersonaContext
  context_label?: string
  traits: Trait[]
  summary: string
  confidence: number
  version: number
}

export function listProfiles() {
  return api.get<PersonaProfileView[]>('/api/personas/profiles')
}

export function createProfile(body: {
  nickname: string
  avatar_base64?: string
  context: PersonaContext
  context_label?: string
  dimension_keys?: string[]
  answers: Record<string, string | number>
}) {
  return api.post<PersonaProfileView>('/api/personas/profiles', body)
}

export function updateProfile(
  id: number,
  body: { nickname?: string; avatar_base64?: string },
) {
  return api.patch<PersonaProfileView>(`/api/personas/profiles/${id}`, body)
}

export function deleteProfile(id: number) {
  return api.delete<void>(`/api/personas/profiles/${id}`)
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
