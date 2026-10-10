import { ApiError, api, fetchBlob, postForm, postStream, type ApiErrorBody } from './client'

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
  /** 群聊里 role=other 时的发言成员 key；单人会话为空 */
  speaker: string
  created_at: string
}

export interface GroupMember {
  key: string
  name: string
}

export interface Conversation {
  id: number
  title: string
  counterpart_name: string
  counterpart_key: string
  relationship: string
  scenario_id: number | null
  scenario_kind: string
  is_group: boolean
  members: GroupMember[]
  message_count: number
}

export interface Scenario {
  id: number
  slug: string
  name: string
  kind: string
  description: string
  is_builtin: boolean
  is_system: boolean
  /** 场景自带的人设题集：人设档位跟随场景时按它取维度 */
  persona_questions?: string
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

export function updateMemory(id: number, body: { content: string; category: string }) {
  return api.patch<MemoryItem>(`/api/chat/memories/${id}`, body)
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
  counterpart_name?: string
  /** 不传时后端按人设档位推导（恋爱 → 恋人、职场 → 同事） */
  relationship?: string
  scenario_id?: number | null
  /** 群聊成员名列表；非空即按群聊建立 */
  members?: string[]
  /** 单聊从人设库选用：昵称 / key / 头像随档案带入 */
  profile_id?: number | null
  /** 群聊从人设库选成员：与手输名字合并去重 */
  member_profile_ids?: number[]
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
  speaker = '',
) {
  return api.post<ChatMessage>(`/api/conversations/${conversationId}/messages`, {
    role,
    content,
    source,
    attachment_ids: attachmentIds,
    speaker,
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


/** 自动回复卡片的评分项：面板上的一维判定（标题 + 中文结论） */
export interface ReplyScoreItem {
  key: string
  title: string
  kind: 'choice' | 'noul' | 'score' | 'missing'
  text: string
  tone?: 'success' | 'warning' | 'danger' | 'info'
}

/** 自动回复管线的最终结果：评分、候选、高危拦截与排序是否成功 */
export interface ReplyStreamResult {
  scores: ReplyScoreItem[] | null
  candidates: Candidate[]
  blocked: string | null
  ranked: boolean
}

export type ReplyStreamStep = 'translate' | 'score' | 'draft' | 'rank'

/** 流式回复的阶段事件：plan 先交代这次走几步，之后每完成一步推一条。 */
export interface ReplyStreamEvent {
  stage: 'plan' | 'translate_done' | 'score_done' | 'draft_done' | 'done' | 'error'
  steps?: ReplyStreamStep[]
  scores?: ReplyScoreItem[] | null
  payload?: ReplyStreamResult
  error?: ApiErrorBody
}

/** 解读对面来话 → 评分 → 按人设起草 → JEV 排序。 */
export function replyStream(
  body: { conversation_id: number; target_member?: string },
  onEvent?: (event: ReplyStreamEvent) => void,
): Promise<ReplyStreamResult> {
  let answer: ReplyStreamResult | null = null
  let failure: ApiErrorBody | null = null
  return postStream('/api/chat/reply/stream', body, (raw) => {
    const event = raw as ReplyStreamEvent
    if (event.stage === 'done') {
      answer = event.payload ?? null
      onEvent?.(event)
      return
    }
    if (event.stage === 'error') {
      failure = event.error ?? { code: 'UNKNOWN', message: '回复未生成，请重试' }
      return
    }
    onEvent?.(event)
  }).then(() => {
    if (failure) throw new ApiError(502, failure)
    if (!answer) throw new ApiError(0, { code: 'UNKNOWN', message: '回复未生成，请重试' })
    return answer
  })
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
