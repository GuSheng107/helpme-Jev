import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { UserSummary } from '../api/auth'
import { listConversations, type Conversation } from '../api/chat'
import { getLogStats } from '../api/logs'
import { personaUsage } from '../api/personas'
import type { AppPage } from '../components/AppShell'

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

/** 登录后的工作台：首页只呈现真实数据和下一步动作。 */
export default function HomePage({ user, onNavigate, onOpenConversation }: Props) {
  const [chats, setChats] = useState<Conversation[]>([])
  const [judged, setJudged] = useState<number | null>(null)
  const [adopted, setAdopted] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const days = daysSince(user.created_at)
  const name = user.display_name || user.username

  useEffect(() => {
    let alive = true
    Promise.allSettled([
      listConversations(),
      getLogStats(),
      personaUsage(),
    ]).then(([conversationResult, logResult, usageResult]) => {
      if (!alive) return
      if (conversationResult.status === 'fulfilled') setChats(conversationResult.value)
      if (logResult.status === 'fulfilled') setJudged(logResult.value.judgment_count)
      if (usageResult.status === 'fulfilled') setAdopted(usageResult.value.adopted)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [])

  const activeChats = useMemo(() => chats.filter((chat) => chat.message_count > 0), [chats])

  return (
    <main className="min-h-full bg-[#f6f9fd]">
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-9">
        <header className="grid gap-5 border-b border-[#dbe7f5] pb-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(270px,0.75fr)] lg:items-end">
          <div>
            <p className="text-[13px] font-medium text-[#409eff]">{greeting()}，{name}</p>
            <h1 className="mt-2 text-[27px] font-semibold tracking-[-0.01em] text-slate-900 sm:text-[30px]">今天想先处理什么？</h1>
            <p className="mt-2 max-w-xl text-[14px] leading-6 text-slate-500">把需要想清楚的事放进来，Jev 帮你整理信息、给出判断，最后由你决定。</p>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-[#cfe4fa] bg-[#eaf5ff] px-4 py-3.5 lg:block">
            <div>
              <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#409eff]">陪伴时间</p>
              <p className="mt-1 text-[26px] font-semibold leading-none text-[#1e293b]">
                {days === null ? '—' : days} <span className="text-[14px] font-medium text-slate-500">天</span>
              </p>
            </div>
            <p className="max-w-[170px] text-right text-[12px] leading-5 text-slate-500 lg:mt-2 lg:max-w-none lg:text-left">
              从注册那天起，Jev 一直在这里。
            </p>
          </div>
        </header>

        <section className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(270px,0.75fr)]">
          <div className="min-w-0">
            <SectionHeading title="继续工作" action={activeChats.length > 0 ? '查看全部' : undefined} onAction={() => onNavigate('chat')} />
            <div className="mt-3 overflow-hidden rounded-xl border border-[#dbe7f5] bg-white">
              {loading ? (
                <LoadingRows />
              ) : activeChats.length === 0 ? (
                <EmptyWork onOpenChat={() => onNavigate('chat')} />
              ) : (
                <div className="divide-y divide-[#edf3fa]">
                  {activeChats.slice(0, 5).map((chat) => (
                    <ConversationRow key={chat.id} chat={chat} onOpen={() => onOpenConversation(chat.id)} />
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <SectionHeading title="今天可以做什么" />
            <div className="mt-3 divide-y divide-[#edf3fa] overflow-hidden rounded-xl border border-[#dbe7f5] bg-white">
              <QuickAction
                icon="chat"
                title="开始一段聊天"
                description="记录对方说了什么"
                onClick={() => onNavigate('chat')}
              />
              <QuickAction
                icon="decision"
                title="打开通用决策"
                description="把临时问题单独想清楚"
                onClick={() => onNavigate('decide')}
              />
              <QuickAction
                icon="persona"
                title="维护人设档案"
                description="查看或重新建立档案"
                onClick={() => onNavigate('personas')}
              />
            </div>
          </div>
        </section>

        <section className="mt-7 grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(270px,0.75fr)]">
          <div>
            <SectionHeading title="使用概览" />
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Metric label="全部会话" value={chats.length} detail="已建立的对象" />
              <Metric label="判断次数" value={judged} detail="已完成的聊天分析与通用决策" />
              <Metric label="采用的回复" value={adopted} detail="你确认发出的候选" />
            </div>
          </div>
          <div>
            <SectionHeading title="使用原则" />
            <div className="mt-3 rounded-xl border border-[#dbe7f5] bg-white px-4 py-4">
              <div className="flex gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#ecf5ff] text-[#409eff]">
                  <Icon name="spark" />
                </span>
                <div>
                  <p className="text-[14px] font-medium text-slate-800">Jev 只帮你理清楚</p>
                  <p className="mt-1 text-[12px] leading-5 text-slate-400">判断和候选都由你确认，系统不会替你发送。</p>
                </div>
              </div>
            </div>
          </div>
        </section>

      </div>
    </main>
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
      <h2 className="text-[15px] font-semibold text-slate-800">{title}</h2>
      {action && onAction && (
        <button type="button" className="text-[13px] text-[#409eff] hover:underline" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}

function ConversationRow({ chat, onOpen }: { chat: Conversation; onOpen: () => void }) {
  const name = chat.counterpart_name || chat.title || '未命名会话'
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#f8fbff]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e8f3ff] text-[15px] font-semibold text-[#409eff]">
        {name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-medium text-slate-800">{name}</span>
          {chat.relationship && <span className="shrink-0 text-[12px] text-slate-400">{chat.relationship}</span>}
        </span>
        <span className="mt-1 block text-[12px] text-slate-400">
          {chat.scenario_kind === 'workplace' ? '职场场景' : '恋爱场景'} · {chat.message_count} 条记录
        </span>
      </span>
      <Icon name="arrow" className="text-slate-300" />
    </button>
  )
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
}: {
  icon: 'chat' | 'decision' | 'persona'
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-[#f8fbff]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#ecf5ff] text-[#409eff]">
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium text-slate-800">{title}</span>
        <span className="mt-0.5 block text-[12px] text-slate-400">{description}</span>
      </span>
      <Icon name="arrow" className="text-slate-300" />
    </button>
  )
}

function Metric({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="rounded-xl border border-[#dbe7f5] bg-white px-4 py-4">
      <p className="text-[12px] text-slate-400">{label}</p>
      <p className="mt-2 text-[26px] font-semibold leading-none text-slate-800">{value === null ? '—' : value}</p>
      <p className="mt-2 text-[12px] text-slate-400">{detail}</p>
    </div>
  )
}

function EmptyWork({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <div className="flex items-center gap-4 px-5 py-8">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#ecf5ff] text-[#409eff]">
        <Icon name="chat" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium text-slate-800">还没有进行中的会话</p>
        <p className="mt-1 text-[13px] text-slate-400">新建一位对象，开始记录对话。</p>
      </div>
      <button type="button" onClick={onOpenChat} className="shrink-0 text-[13px] font-medium text-[#409eff] hover:underline">
        去聊天
      </button>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-4 px-4 py-5">
      {[1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded-lg bg-[#f4f8fd]" />)}
    </div>
  )
}

function Icon({ name, className = '' }: { name: 'plus' | 'arrow' | 'chat' | 'decision' | 'persona' | 'spark'; className?: string }) {
  const paths: Record<typeof name, ReactNode> = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h13M13 7l5 5-5 5" /></>,
    chat: <><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3h-1A2.5 2.5 0 0 1 3 12.5v-6Z" /></>,
    decision: <><path d="M12 3v18M5 7h14M7 7l-3 5h6L7 7ZM17 7l-3 5h6l-3-5ZM5 17h14" /></>,
    persona: <><circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    spark: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`} aria-hidden>
      {paths[name]}
    </svg>
  )
}
