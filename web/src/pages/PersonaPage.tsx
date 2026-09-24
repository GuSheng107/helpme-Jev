import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { listConversations, type Conversation } from '../api/chat'
import {
  buildPersona,
  commitChat,
  getPersona,
  importQa,
  personaUsage,
  previewChat,
  type ChatPreview,
  type PersonaContext,
  type PersonaView,
} from '../api/personas'
import Button from '../components/Button'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell } from '../components/layout'

type SelfItem =
  | { key: string; kind: 'score'; statement: string }
  | { key: string; kind: 'choice'; statement: string; options: [string, string][] }

const SCORE_OPTIONS: [string, number][] = [
  ['符合', 7],
  ['一般', 4],
  ['不太符合', 1],
]

const ATTACHMENT_OPTIONS: [string, string][] = [
  ['既能亲近也能独立', 'secure'],
  ['常要确认对方还在意', 'anxious'],
  ['太近了会想退开', 'avoidant'],
  ['时近时远，说不清', 'disorganized'],
]

const LOVE_LANGUAGE_OPTIONS: [string, string][] = [
  ['听到肯定的话', 'words'],
  ['专属的陪伴时间', 'time'],
  ['收到用心的礼物', 'gifts'],
  ['对方为我做事', 'service'],
  ['肢体上的亲近', 'touch'],
]

const CONFLICT_OPTIONS: [string, string][] = [
  ['坚持我的立场', 'competing'],
  ['一起找两边都接受的办法', 'collaborating'],
  ['各退一步', 'compromising'],
  ['先放着，缓一缓', 'avoiding'],
  ['我让步，息事宁人', 'accommodating'],
]

const DISC_OPTIONS: [string, string][] = [
  ['直接，先冲结果', 'dominance'],
  ['热情，靠说服和关系', 'influence'],
  ['耐心，求稳求节奏', 'steadiness'],
  ['严谨，细节要核对', 'conscientiousness'],
]

const SELF_FORMS: Record<PersonaContext, SelfItem[]> = {
  romance: [
    { key: 'openness', kind: 'score', statement: '我喜欢尝试新的想法和做法' },
    { key: 'conscientiousness', kind: 'score', statement: '我做事有计划，答应的事会做完' },
    { key: 'extraversion', kind: 'score', statement: '和人相处让我更有精神' },
    { key: 'agreeableness', kind: 'score', statement: '我通常先考虑对方的感受' },
    { key: 'emotional_stability', kind: 'score', statement: '有压力时我大体稳得住' },
    { key: 'attachment', kind: 'choice', statement: '和亲近的人相处时，我最像哪种？', options: ATTACHMENT_OPTIONS },
    { key: 'love_language', kind: 'choice', statement: '被在乎的时候，我最在意哪种？', options: LOVE_LANGUAGE_OPTIONS },
    { key: 'conflict_style', kind: 'choice', statement: '有分歧时我通常怎么做？', options: CONFLICT_OPTIONS },
  ],
  workplace: [
    { key: 'openness', kind: 'score', statement: '我乐于接受新工具和新流程' },
    { key: 'conscientiousness', kind: 'score', statement: '我按计划交付，截止时间记得牢' },
    { key: 'extraversion', kind: 'score', statement: '群体场合让我更来劲' },
    { key: 'agreeableness', kind: 'score', statement: '我会先照顾协作方的感受' },
    { key: 'emotional_stability', kind: 'score', statement: '工作有压力时我大体稳得住' },
    { key: 'disc', kind: 'choice', statement: '我的工作风格最像哪种？', options: DISC_OPTIONS },
    { key: 'conflict_style', kind: 'choice', statement: '工作有分歧时我通常怎么做？', options: CONFLICT_OPTIONS },
  ],
}

const CONTEXT_LABELS: Record<PersonaContext, string> = { romance: '恋爱', workplace: '职场' }

export default function PersonaPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentId, setCurrentId] = useState<number | null>(null)
  const [subject, setSubject] = useState<'me' | 'other'>('other')
  const [context, setContext] = useState<PersonaContext>('romance')
  const [persona, setPersona] = useState<PersonaView | null>(null)
  const [usage, setUsage] = useState({ adopted: 0, rewritten: 0 })
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<ChatPreview | null>(null)
  const [otherLabels, setOtherLabels] = useState('')
  const [qa, setQa] = useState('')
  const [selfAnswers, setSelfAnswers] = useState<Record<string, string | number>>({})
  const [notice, setNotice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const current = conversations.find((item) => item.id === currentId) ?? null

  useEffect(() => {
    listConversations()
      .then((rows) => {
        setConversations(rows)
        setCurrentId(rows[0]?.id ?? null)
        const kind = rows[0]?.scenario_kind
        if (kind === 'workplace') setContext('workplace')
      })
      .catch(() => setError('会话未能载入'))
    personaUsage().then(setUsage).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!current) return
    const kind = current.scenario_kind
    if (kind === 'romance' || kind === 'workplace') setContext(kind)
  }, [current])

  useEffect(() => {
    if (!current) return
    getPersona(current.counterpart_key, subject, context)
      .then(setPersona)
      .catch(() => setPersona(null))
  }, [current, subject, context])

  function pickConversation(id: number) {
    setCurrentId(id)
    setPersona(null)
  }

  async function build() {
    if (currentId === null) return
    if (subject === 'me' && Object.keys(selfAnswers).length === 0) {
      setError('请先作答，至少选一项')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const built = await buildPersona(
        currentId,
        subject,
        subject === 'me' ? selfAnswers : {},
        context,
      )
      setPersona(built)
      setNotice(built.kept ? built.reason || '已保留原档案' : '档案已更新')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '建模未完成')
    } finally {
      setBusy(false)
    }
  }

  function labels() {
    const custom = otherLabels
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean)
    return custom.length > 0 ? custom : undefined
  }

  async function previewImport() {
    if (currentId === null || !text.trim()) return
    setBusy(true)
    setError(null)
    try {
      setPreview(await previewChat(currentId, text, labels()))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '预览未完成')
    } finally {
      setBusy(false)
    }
  }

  async function confirmImport() {
    if (currentId === null || preview === null) return
    setBusy(true)
    try {
      const saved = await commitChat(currentId, text, labels())
      setNotice(`已导入 ${saved.imported} 条，跳过 ${saved.skipped} 条`)
      setPreview(null)
      setText('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '导入未完成')
    } finally {
      setBusy(false)
    }
  }

  async function saveQa() {
    setBusy(true)
    setError(null)
    try {
      const saved = await importQa(qa, currentId)
      setNotice(`已导入 ${saved.imported} 组问答`)
      setQa('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '问答未导入')
    } finally {
      setBusy(false)
    }
  }

  const selfItems = SELF_FORMS[context]

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="人设档案"
          description="按情境分档：恋爱与职场各一份，互不覆盖。这不是临床诊断。"
        />
        {error && <Notice tone="danger">{error}</Notice>}
        {notice && <div className="mb-3"><Notice tone="info">{notice}</Notice></div>}
        {conversations.length === 0 ? (
          <EmptyState title="还没有对象" description="先在聊天里新建一位对象，再回来建模。" />
        ) : (
          <div className="space-y-4">
            <DataCard title="档案">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <select
                  className="rounded-[6px] border border-border px-2 py-1 text-[14px]"
                  value={currentId ?? ''}
                  onChange={(event) => pickConversation(Number(event.target.value))}
                >
                  {conversations.map((item) => (
                    <option key={item.id} value={item.id}>{item.counterpart_name}</option>
                  ))}
                </select>
                <div className="flex rounded-[6px] border border-border p-0.5">
                  {(['romance', 'workplace'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`rounded-[4px] px-2 py-0.5 text-[13px] ${
                        context === item ? 'bg-primary text-white' : 'text-ink-secondary'
                      }`}
                      onClick={() => setContext(item)}
                    >
                      {CONTEXT_LABELS[item]}
                    </button>
                  ))}
                </div>
                <div className="flex rounded-[6px] border border-border p-0.5">
                  {(['other', 'me'] as const).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`rounded-[4px] px-2 py-0.5 text-[13px] ${
                        subject === item ? 'bg-primary text-white' : 'text-ink-secondary'
                      }`}
                      onClick={() => setSubject(item)}
                    >
                      {item === 'me' ? '我' : '对方'}
                    </button>
                  ))}
                </div>
                <Button size="sm" variant="primary" loading={busy} onClick={() => void build()}>
                  {subject === 'me' ? '提交自评' : '从对话推断'}
                </Button>
              </div>
              {subject === 'me' && (
                <ul className="mb-3 space-y-2">
                  {selfItems.map((item) => (
                    <li key={item.key} className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[13px] leading-5 text-ink-secondary">{item.statement}</span>
                      <select
                        className="rounded-[6px] border border-border px-2 py-1 text-[13px]"
                        value={String(selfAnswers[item.key] ?? '')}
                        onChange={(event) => {
                          const raw = event.target.value
                          setSelfAnswers((prev) => ({
                            ...prev,
                            [item.key]: item.kind === 'score' ? Number(raw) : raw,
                          }))
                        }}
                      >
                        <option value="">未作答</option>
                        {item.kind === 'score'
                          ? SCORE_OPTIONS.map(([label, value]) => (
                              <option key={value} value={value}>{label}</option>
                            ))
                          : item.options.map(([label, value]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                      </select>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[13px] text-ink-muted">
                {CONTEXT_LABELS[persona?.context ?? context]}情境　置信度 {persona?.confidence ?? 0}%　版本 {persona?.version ?? 0}
              </p>
              <ul className="mt-2 space-y-1">
                {(persona?.traits ?? []).map((trait) => (
                  <li key={trait.key} className="flex justify-between gap-2 text-[14px]">
                    <span className="text-ink-secondary">
                      {trait.title}
                      {trait.weak_science && (
                        <span className="ml-1 text-[11px] text-ink-muted">（该框架证据有限）</span>
                      )}
                    </span>
                    <span className="text-ink">{trait.text}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[13px] text-ink-muted">
                直接采用 {usage.adopted} 次，手动改写 {usage.rewritten} 次
              </p>
            </DataCard>
            <DataCard title="导入聊天记录">
              <textarea
                className="min-h-28 w-full rounded-[6px] border border-border p-2 text-[14px]"
                placeholder={'我: 在吗\nTA: 没怎么'}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
              <input
                className="mt-2 w-full rounded-[6px] border border-border px-2 py-1 text-[13px]"
                placeholder="对方标签（选填，逗号分隔，默认认 她 / 他 / TA，也可以是名字）"
                value={otherLabels}
                onChange={(event) => setOtherLabels(event.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <Button size="sm" loading={busy} onClick={() => void previewImport()}>预览</Button>
                <Button size="sm" variant="primary" loading={busy} disabled={preview === null} disabledReason="请先预览" onClick={() => void confirmImport()}>
                  确认导入
                </Button>
              </div>
              {preview && (
                <p className="mt-2 text-[13px] text-ink-secondary">
                  认出 {preview.count} 条，跳过 {preview.skipped} 条。确认后才会入库。
                </p>
              )}
            </DataCard>
            <DataCard title="导入问答">
              <textarea
                className="min-h-24 w-full rounded-[6px] border border-border p-2 text-[14px]"
                placeholder='[{"question":"雷区？","answer":"不要提前任"}]'
                value={qa}
                onChange={(event) => setQa(event.target.value)}
              />
              <Button className="mt-2" size="sm" loading={busy} disabled={!qa.trim()} disabledReason="请先粘贴问答" onClick={() => void saveQa()}>
                导入
              </Button>
            </DataCard>
          </div>
        )}
      </PageBody>
    </PageShell>
  )
}
