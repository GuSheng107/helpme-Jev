import { api, request } from './client'
import { formatLocalMinute } from '../utils/datetime'

export function getLogStats(): Promise<{ judgment_count: number }> {
  return api.get('/api/logs/stats')
}

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogItem {
  id: number
  trace_id: string
  kind: 'jev' | 'llm'
  level: LogLevel
  phase: string
  model: string
  status_code: number | null
  latency_ms: number
  error: string
  truncated: boolean
  created_at: string
  request: unknown
  response: unknown
}

export interface LogLine {
  seq: string
  original: string
  annotated: string
}

export function listLogs(params: {
  limit?: number
  offset?: number
  level?: LogLevel | ''
  kind?: 'jev' | 'llm' | ''
  phase?: string
  trace_id?: string
  start_time?: string
  end_time?: string
} = {}) {
  const search = new URLSearchParams()
  if (params.limit) search.set('limit', String(params.limit))
  if (params.offset) search.set('offset', String(params.offset))
  if (params.level) search.set('level', params.level)
  if (params.kind) search.set('kind', params.kind)
  if (params.phase) search.set('phase', params.phase)
  if (params.start_time) search.set('start_time', params.start_time)
  if (params.end_time) search.set('end_time', params.end_time)
  if (params.trace_id) search.set('trace_id', params.trace_id)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return api.get<{ total: number; items: LogItem[] }>(`/api/logs${suffix}`)
}

interface ExportPayload {
  exported_at: string
  user: { username: string; display_name: string; created_at: string }
  conversations: Array<{
    title: string
    counterpart_name: string
    relationship: string
    created_at: string
    messages: Array<{ role: string; content: string; created_at: string }>
  }>
  memories: Array<{ subject: string; category: string; content: string; created_at: string }>
  personas: Array<{
    counterpart_key: string
    subject: string
    context: string
    traits: Record<string, unknown>
    confidence: number
    version: number
  }>
  qa_pairs: Array<{ question: string; answer: string }>
  call_logs: Array<{
    kind: string
    phase: string
    model: string
    status_code: number | null
    latency_ms: number
    created_at: string
  }>
}

function toMarkdown(data: ExportPayload): string {
  const lines: string[] = [
    '# HelpMe Jev 数据导出',
    '',
    `导出时间：${formatLocalMinute(data.exported_at)}`,
    '',
    '这份文档是你在 HelpMe Jev 里的个人数据，包含账号、会话、记忆、人设和调用记录。不含模型密钥。',
    '',
    '## 账号',
    '',
    `- 用户名：${data.user.username}`,
    `- 昵称：${data.user.display_name}`,
    `- 注册时间：${formatLocalMinute(data.user.created_at)}`,
    '',
    '## 会话',
    '',
  ]
  if (data.conversations.length === 0) lines.push('还没有会话。', '')
  for (const chat of data.conversations) {
    lines.push(`### ${chat.counterpart_name || chat.title}`, '')
    lines.push(`关系：${chat.relationship || '未填写'}　创建于 ${formatLocalMinute(chat.created_at)}`, '')
    if (chat.messages.length === 0) lines.push('这条会话还没有消息。', '')
    for (const message of chat.messages) {
      lines.push(`**${message.role === 'me' ? '我' : '对方'}** ${formatLocalMinute(message.created_at)}`, '', message.content || '（无文字）', '')
    }
  }
  lines.push('## 记忆', '')
  if (data.memories.length === 0) lines.push('还没有记忆。', '')
  for (const memory of data.memories) {
    lines.push(`- ${memory.subject} / ${memory.category}：${memory.content}`)
  }
  lines.push('', '## 人设', '')
  if (data.personas.length === 0) lines.push('还没有人设。', '')
  for (const persona of data.personas) {
    const traits = Object.entries(persona.traits)
      .map(([key, value]) => `${key}：${String(value)}`)
      .join('；')
    lines.push(
      `### ${persona.counterpart_key || '未命名'}（${persona.subject} · ${persona.context}）`,
      '',
      `版本 ${persona.version}，置信度 ${persona.confidence}`,
      '',
      traits || '没有特质记录。',
      '',
    )
  }
  lines.push('## 问答', '')
  if (data.qa_pairs.length === 0) lines.push('还没有导入的问答。', '')
  for (const pair of data.qa_pairs) {
    lines.push(`- **问** ${pair.question}`, `  **答** ${pair.answer}`)
  }
  lines.push('', '## 调用记录', '')
  if (data.call_logs.length === 0) lines.push('还没有调用记录。', '')
  for (const log of data.call_logs) {
    lines.push(`- ${formatLocalMinute(log.created_at)}　${log.kind} / ${log.phase}　${log.model}　${log.status_code ?? '—'}　${log.latency_ms} ms`)
  }
  lines.push('')
  return lines.join('\n')
}

/** 下载个人数据的 Markdown 文件。 */
export async function exportAccountData(): Promise<Blob> {
  const payload = await api.get<ExportPayload>('/api/account/export')
  return new Blob([toMarkdown(payload)], { type: 'text/markdown;charset=utf-8' })
}

/** 注销账号：密码确认，删除后 204。 */
export function deleteAccount(password: string) {
  return request<void>('/api/account', { method: 'DELETE', body: { password } })
}
