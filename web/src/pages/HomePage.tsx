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
    <main className="relative min-h-full overflow-hidden bg-[#f6f9fd]">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-96 w-96 rounded-full bg-[#dcecff]/60 blur-3xl" />
      <div className="relative mx-auto max-w-[1320px] px-4 py-5 sm:px-7 sm:py-8 lg:px-10 lg:py-10">
        <header className="relative isolate grid gap-7 overflow-hidden rounded-[26px] border border-[#dce9fa] bg-gradient-to-br from-white via-[#f9fcff] to-[#e8f3ff] px-5 py-7 shadow-[0_16px_45px_-30px_rgba(43,99,170,0.4)] sm:px-8 sm:py-8 lg:grid-cols-[minmax(0,1fr)_230px] lg:items-center lg:gap-10 lg:px-10">
          <div aria-hidden className="pointer-events-none absolute -right-14 -top-28 -z-10 h-72 w-72 rounded-full border-[36px] border-white/60" />
          <div className="min-w-0">
            <p className="inline-flex items-center gap-2 rounded-full border border-[#d7e8fb] bg-white/85 px-3 py-1 text-[12px] font-semibold tracking-wide text-[#2873bb]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#409eff]" />
              你的工作台
            </p>
            <h1 className="mt-5 text-[30px] font-semibold leading-tight tracking-[-0.025em] text-[#142b49] sm:text-[36px]">
              {greeting()}，{name}
            </h1>
            <p className="mt-2 text-[16px] font-medium text-[#315778]">今天想先处理什么？</p>
            <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[#647b96] sm:text-[14px]">
              把需要想清楚的事放进来，Jev 帮你整理信息、给出判断，最后由你决定。
            </p>
            <div className="mt-5 flex flex-wrap gap-2.5">
              <button type="button" onClick={() => onNavigate('chat')} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#318deb] px-4 text-[13px] font-semibold text-white shadow-[0_8px_18px_-10px_rgba(49,141,235,0.8)] transition hover:bg-[#267bd2]">
                <Icon name="chat" /> 开始聊天 <Icon name="arrow" />
              </button>
              <button type="button" onClick={() => onNavigate('decide')} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d6e5f6] bg-white/90 px-4 text-[13px] font-semibold text-[#35618d] transition hover:border-[#aacdf0] hover:bg-white">
                打开通用决策
              </button>
            </div>
          </div>
          <div className="relative flex min-h-32 items-center justify-between gap-4 overflow-hidden rounded-[18px] border border-white/90 bg-white/75 px-5 py-4 shadow-[0_12px_30px_-24px_rgba(31,84,148,0.55)] backdrop-blur-sm lg:block lg:min-h-44 lg:px-6 lg:py-5">
            <div aria-hidden className="absolute -bottom-12 -right-12 h-32 w-32 rounded-full bg-[#dceeff]" />
            <div className="relative">
              <p className="text-[12px] font-semibold tracking-[0.1em] text-[#5885b6]">陪伴时间</p>
              <p className="mt-2 text-[38px] font-semibold leading-none tracking-tight text-[#173c66]">
                {days === null ? '—' : days}<span className="ml-1 text-[15px] font-medium text-[#6385a6]">天</span>
              </p>
              <p className="mt-3 max-w-[145px] text-[12px] leading-5 text-[#7188a0]">从注册那天起，Jev 一直在这里。</p>
            </div>
            <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#e8f3ff] text-[#318deb] lg:mt-2">
              <Icon name="spark" />
            </span>
          </div>
        </header>

        <aside aria-label="免责声明" className="mt-4 flex items-start gap-3 rounded-xl border border-[#f4e4c8] bg-[#fffaf1] px-4 py-3.5 text-[#755b30] sm:px-5">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[#fff0d4] text-[#ae7727]"><Icon name="info" /></span>
          <div className="text-[13px] leading-5">
            <p className="font-semibold">免责声明：AI 生成的回答可能会有错，请小心甄别。</p>
            <p className="mt-0.5 text-[#9a8056]">涉及重要决定时，请核实关键信息并自行判断。</p>
          </div>
        </aside>

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(285px,0.85fr)]">
          <div className="min-w-0">
            <SectionHeading title="继续工作" action={activeChats.length > 0 ? '查看全部' : undefined} onAction={() => onNavigate('chat')} />
            <div className="mt-3 min-h-[246px] overflow-hidden rounded-[18px] border border-[#e0eaf5] bg-white shadow-[0_12px_32px_-28px_rgba(26,68,121,0.55)]">
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
            <div className="mt-3 grid gap-2.5">
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

        <section className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.65fr)_minmax(285px,0.85fr)]">
          <div>
            <SectionHeading title="使用概览" />
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Metric label="全部会话" value={chats.length} detail="已建立的对象" />
              <Metric label="判断次数" value={judged} detail="已完成的聊天分析与通用决策" />
              <Metric label="采用的回复" value={adopted} detail="你确认发出的候选" />
            </div>
          </div>
          <div>
            <SectionHeading title="判断与措辞分工" />
            <div className="mt-3 flex min-h-[128px] items-center rounded-[18px] border border-[#d9e8f8] bg-gradient-to-br from-[#f2f8ff] to-white px-5 py-5 shadow-[0_12px_32px_-28px_rgba(26,68,121,0.55)]">
              <div className="flex gap-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#318deb] shadow-sm">
                  <Icon name="decision" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-[#1f426b]">Jev 负责判断，语言模型负责措辞</p>
                  <p className="mt-1 text-[12px] leading-5 text-[#6f89a4]">判断由结构化决策模型给出，措辞由语言模型处理，两边的结果都摊开给你看。</p>
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
      <h2 className="text-[17px] font-semibold tracking-tight text-[#1b3658]">{title}</h2>
      {action && onAction && (
        <button type="button" className="inline-flex items-center gap-1 text-[13px] font-medium text-[#318deb] hover:underline" onClick={onAction}>
          {action} <Icon name="arrow" />
        </button>
      )}
    </div>
  )
}

function ConversationRow({ chat, onOpen }: { chat: Conversation; onOpen: () => void }) {
  const name = chat.counterpart_name || chat.title || '未命名会话'
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-[#f7fbff]">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eaf4ff] text-[16px] font-semibold text-[#318deb]">
        {name.slice(0, 1)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-[#243e5e]">{name}</span>
          {chat.relationship && <span className="shrink-0 text-[12px] text-[#8ba0b8]">{chat.relationship}</span>}
        </span>
        <span className="mt-1 block text-[12px] text-[#8298af]">
          {chat.scenario_kind === 'workplace' ? '职场场景' : chat.scenario_kind === 'custom' ? '自定义场景' : '恋爱场景'} · {chat.message_count} 条记录
        </span>
      </span>
      <Icon name="arrow" className="text-[#a8bfd7]" />
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
    <button type="button" onClick={onClick} className="group flex min-h-[72px] w-full items-center gap-3 rounded-[16px] border border-[#e0eaf5] bg-white px-4 py-3 text-left shadow-[0_12px_32px_-28px_rgba(26,68,121,0.55)] transition hover:-translate-y-0.5 hover:border-[#b9d8f7] hover:shadow-[0_16px_30px_-23px_rgba(32,112,192,0.38)]">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#eaf4ff] text-[#318deb] transition group-hover:bg-[#deeeff]">
        <Icon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold text-[#243e5e]">{title}</span>
        <span className="mt-0.5 block text-[12px] text-[#8298af]">{description}</span>
      </span>
      <Icon name="arrow" className="text-[#a8bfd7] transition group-hover:translate-x-0.5 group-hover:text-[#318deb]" />
    </button>
  )
}

function Metric({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="min-h-[128px] rounded-[18px] border border-[#e0eaf5] bg-white px-5 py-4 shadow-[0_12px_32px_-28px_rgba(26,68,121,0.55)]">
      <span className="mb-3 block h-1 w-8 rounded-full bg-[#99cafa]" aria-hidden />
      <p className="text-[12px] font-medium text-[#7890aa]">{label}</p>
      <p className="mt-1 text-[27px] font-semibold leading-none text-[#183f69]">{value === null ? '—' : value}</p>
      <p className="mt-2 text-[12px] leading-5 text-[#8ba0b8]">{detail}</p>
    </div>
  )
}

function EmptyWork({ onOpenChat }: { onOpenChat: () => void }) {
  return (
    <div className="flex min-h-[246px] flex-col items-center justify-center px-5 py-7 text-center">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#eaf4ff] text-[#318deb]">
        <Icon name="chat" />
      </span>
      <p className="mt-3 text-[15px] font-semibold text-[#294766]">还没有进行中的会话</p>
      <p className="mt-1 text-[13px] text-[#8ba0b8]">新建一位对象，开始记录对话。</p>
      <button type="button" onClick={onOpenChat} className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-[#318deb] hover:underline">
        去聊天 <Icon name="arrow" />
      </button>
    </div>
  )
}

function LoadingRows() {
  return (
    <div className="space-y-4 px-5 py-6">
      {[1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-[#f1f6fc]" />)}
    </div>
  )
}

function Icon({ name, className = '' }: { name: 'plus' | 'arrow' | 'chat' | 'decision' | 'persona' | 'spark' | 'info'; className?: string }) {
  const paths: Record<typeof name, ReactNode> = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    arrow: <><path d="M5 12h13M13 7l5 5-5 5" /></>,
    chat: <><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3v-3h-1A2.5 2.5 0 0 1 3 12.5v-6Z" /></>,
    decision: <><path d="M12 3v18M5 7h14M7 7l-3 5h6L7 7ZM17 7l-3 5h6l-3-5ZM5 17h14" /></>,
    persona: <><circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
    spark: <><path d="m12 3 1.4 5.6L19 10l-5.6 1.4L12 17l-1.4-5.6L5 10l5.6-1.4L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${className}`} aria-hidden>
      {paths[name]}
    </svg>
  )
}
