import { useEffect, useMemo, useState } from 'react'
import type { UserSummary } from '../api/auth'
import { listConversations, type Conversation } from '../api/chat'
import { getLogStats } from '../api/logs'
import { personaUsage } from '../api/personas'
import type { AppPage } from '../components/AppShell'
import Button from '../components/Button'
import { IconChat, IconChevronRight, IconDecide, IconPersona, IconWarning } from '../components/icons'
import { Notice } from '../components/layout'

interface Props {
  user: UserSummary
  onNavigate: (page: AppPage) => void
  onOpenConversation: (id: number) => void
}

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null
  const created = new Date(iso).getTime()
  if (Number.isNaN(created)) return null
  return Math.max(1, Math.floor((Date.now() - created) / 86_400_000) + 1)
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

const SCENE_LABEL: Record<string, string> = {
  romance: '恋爱场景',
  workplace: '职场场景',
  custom: '自定义场景',
}

/** 登录后的工作台：只呈现真实数据与下一步动作。 */
export default function HomePage({ user, onNavigate, onOpenConversation }: Props) {
  const [chats, setChats] = useState<Conversation[]>([])
  const [judged, setJudged] = useState<number | null>(null)
  const [adopted, setAdopted] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const days = daysSince(user.created_at)
  const name = user.display_name || user.username

  useEffect(() => {
    let alive = true
    Promise.allSettled([listConversations(), getLogStats(), personaUsage()]).then(
      ([conversationResult, logResult, usageResult]) => {
        if (!alive) return
        if (conversationResult.status === 'fulfilled') setChats(conversationResult.value)
        if (logResult.status === 'fulfilled') setJudged(logResult.value.judgment_count)
        if (usageResult.status === 'fulfilled') setAdopted(usageResult.value.adopted)
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [])

  const activeChats = useMemo(() => chats.filter((chat) => chat.message_count > 0), [chats])

  return (
    <main className="min-h-full bg-canvas">
      <div className="mx-auto w-full max-w-[1180px] px-5 py-6 sm:px-8 sm:py-8">
        {/* ------------------------------------------------ 问候 */}
        <header className="relative overflow-hidden rounded-[18px] border border-border bg-surface px-6 py-7 shadow-card sm:px-8 sm:py-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-primary/5 blur-3xl"
          />
          <div className="relative flex flex-wrap items-end justify-between gap-x-10 gap-y-7">
            <div className="min-w-0">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[12px] font-medium text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                工作台
              </p>
              <h1 className="mt-4 text-[24px] font-semibold leading-tight tracking-tight text-ink sm:text-[30px]">
                {greeting()}，{name}
              </h1>
              <p className="mt-2.5 max-w-xl text-[14px] leading-6 text-ink-secondary">
                把需要想清楚的事放进来。Jev 负责判断，语言模型负责措辞，最终由你决定。
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                <Button variant="primary" onClick={() => onNavigate('chat')}>
                  <IconChat className="h-4 w-4" />
                  开始聊天
                </Button>
                <Button onClick={() => onNavigate('decide')}>
                  <IconDecide className="h-4 w-4" />
                  通用决策
                </Button>
              </div>
            </div>

            <dl className="flex shrink-0 gap-7 sm:gap-9">
              <Stat label="使用天数" value={days} unit="天" />
              <Stat label="会话" value={loading ? null : chats.length} />
              <Stat label="判断" value={judged} />
              <Stat label="采用回复" value={adopted} />
            </dl>
          </div>
        </header>

        <div className="mt-4">
          <Notice tone="warning">
            <span className="inline-flex items-center gap-1.5">
              <IconWarning className="h-4 w-4 shrink-0" />
              判断可能不准，重要的事请自己核实。
            </span>
          </Notice>
        </div>

        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.9fr)]">
          <div className="min-w-0">
            <SectionHeading
              title="继续工作"
              action={activeChats.length > 0 ? '查看全部' : undefined}
              onAction={() => onNavigate('chat')}
            />
            <div className="mt-3 overflow-hidden rounded-[14px] border border-border bg-surface shadow-card">
              {loading ? (
                <LoadingRows />
              ) : activeChats.length === 0 ? (
                <EmptyWork onOpenChat={() => onNavigate('chat')} />
              ) : (
                <div className="divide-y divide-border-subtle">
                  {activeChats.slice(0, 5).map((chat) => (
                    <ConversationRow key={chat.id} chat={chat} onOpen={() => onOpenConversation(chat.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <SectionHeading title="今天可以做什么" />
            <div className="mt-3 grid gap-2.5">
              <QuickAction
                icon={<IconChat className="h-[18px] w-[18px]" />}
                title="开始一段聊天"
                description="记录对方说了什么"
                onClick={() => onNavigate('chat')}
              />
              <QuickAction
                icon={<IconDecide className="h-[18px] w-[18px]" />}
                title="打开通用决策"
                description="把临时问题单独想清楚"
                onClick={() => onNavigate('decide')}
              />
              <QuickAction
                icon={<IconPersona className="h-[18px] w-[18px]" />}
                title="维护人设档案"
                description="查看或重新建立档案"
                onClick={() => onNavigate('personas')}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ 子组件 */

function Stat({ label, value, unit }: { label: string; value: number | null; unit?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className="mt-1 text-[24px] font-semibold leading-none tracking-tight tabular-nums text-ink">
        {value === null ? '—' : value}
        {unit && value !== null && <span className="ml-1 text-[13px] font-medium text-ink-muted">{unit}</span>}
      </dd>
    </div>
  )
}

function SectionHeading({
  title,
  action,
  onAction,
}: {
  title: string
  action?: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[16px] font-semibold tracking-tight text-ink">{title}</h2>
      {action && onAction && (
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-[13px] font-medium text-primary transition-colors hover:text-primary-hover"
          onClick={onAction}
        >
          {action}
          <IconChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function ConversationRow({ chat, onOpen }: { chat: Conversation; onOpen: () => void }) {
  const name = chat.counterpart_name || chat.title || '未命名会话'
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3.5 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-surface-muted"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-primary-soft text-[16px] font-medium text-primary">
        {name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium text-ink">{name}</span>
          {chat.relationship && <span className="shrink-0 text-[12px] text-ink-muted">{chat.relationship}</span>}
        </span>
        <span className="mt-0.5 block text-[12px] text-ink-muted">
          {SCENE_LABEL[chat.scenario_kind] ?? '恋爱场景'} · {chat.message_count} 条记录
        </span>
      </span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
    </button>
  )
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3.5 rounded-[14px] border border-border bg-surface px-4 py-3.5 text-left shadow-card transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary-border hover:shadow-md"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-primary-soft text-primary transition-colors duration-200 group-hover:bg-primary group-hover:text-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-[12px] text-ink-muted">{description}</span>
      </span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  )
}

function EmptyWork({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-[14px] border border-border bg-surface-muted text-ink-faint">
        <IconChat className="h-6 w-6" />
      </span>
      <p className="mt-3.5 text-[14px] font-medium text-ink">还没有进行中的会话</p>
      <p className="mt-1 text-[13px] text-ink-muted">新建一位对象，开始记录对话。</p>
      <Button className="mt-4" size="sm" onClick={onOpenChat}>
        去聊天
      </Button>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-3 px-5 py-5">
      {[1, 2, 3].map((item) => (
        <div key={item} className="skeleton h-12 w-full" />
      ))}
    </div>
  )
}
