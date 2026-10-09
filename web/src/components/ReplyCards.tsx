import type { Candidate, ReplyScoreItem } from '../api/chat'
import StageLoader, { type LoaderStep } from './StageLoader'
import { IconChevronDown, IconInfo, IconRefresh, IconSparkle, IconWarning } from './icons'

/** 一张自动回复卡片的本地状态：随管线阶段逐步填充（内存级，刷新页面即清） */
export interface ReplyCard {
  id: number
  conversationId: number
  /** 群聊里要回复的成员 key；单聊为空 */
  targetMember: string
  /** 群聊里要回复的成员显示名（建卡时解析好，列表改名也能跟上） */
  targetName: string
  /** 锚定的来话消息 id；手动触发且找不到来话时为 null（卡片落到流末尾） */
  messageId: number | null
  hint: string
  running: boolean
  plan: string[]
  progress: number
  scores: ReplyScoreItem[] | null
  candidates: Candidate[]
  /** 高危拦截的引导文案；非空时候选不生成 */
  blocked: string | null
  /** 排序是否成功；失败时候选按起草顺序展示、不显示匹配度 */
  ranked: boolean
  error: string | null
  expanded: boolean
}

const STEP_LABELS: Record<string, { running: string; done: string }> = {
  translate: { running: '正在解读来话', done: '解读完成' },
  score: { running: '正在评分', done: '评分完成' },
  draft: { running: '正在按人设起草', done: '起草完成' },
  rank: { running: '正在排序', done: '排序完成' },
}

const TONE_TEXT: Partial<Record<NonNullable<ReplyScoreItem['tone']>, string>> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

interface Props {
  card: ReplyCard
  onToggle: (id: number, expanded: boolean) => void
  onPick: (text: string) => void
  onRetry: (id: number) => void
}

/** 锚在来话消息后面的自动回复卡：评分 + 候选，可收起，失败可重试。 */
export default function ReplyCards({ card, onToggle, onPick, onRetry }: Props) {
  const loaderSteps: LoaderStep[] = card.plan.map((key, index) => ({
    key,
    running: STEP_LABELS[key]?.running ?? key,
    done: STEP_LABELS[key]?.done ?? key,
    state: index < card.progress ? 'done' : index === card.progress ? 'running' : 'pending',
  }))
  const hasBody = card.candidates.length > 0 || (card.scores?.length ?? 0) > 0 || card.blocked !== null

  return (
    <div className="w-full max-w-[92%] overflow-hidden rounded-[12px] border border-border bg-surface shadow-xs transition-shadow duration-200 hover:shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <IconSparkle className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-[12px] font-medium text-ink-secondary">
            回复建议{card.targetName ? ` · 回复 ${card.targetName}` : ''}
          </span>
        </span>

        {!card.running && hasBody && (
          <button
            type="button"
            aria-expanded={card.expanded}
            className="ml-auto flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] text-ink-muted transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
            onClick={() => onToggle(card.id, !card.expanded)}
          >
            {card.expanded ? '收起' : '展开'}
            <IconChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 ${
                card.expanded ? 'rotate-180' : ''
              }`}
            />
          </button>
        )}
      </div>

      <div className="space-y-2 px-3 pb-3">
        {card.running && <StageLoader steps={loaderSteps} />}

        {card.error && (
          <div className="flex items-start gap-2 rounded-[8px] bg-danger-soft px-2.5 py-2">
            <IconWarning className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
            <p className="min-w-0 flex-1 text-[13px] leading-5 text-danger">{card.error}</p>
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium text-danger transition-colors duration-150 hover:bg-danger/10"
              onClick={() => onRetry(card.id)}
            >
              <IconRefresh className="h-3.5 w-3.5" />
              重试
            </button>
          </div>
        )}

        {card.blocked && (
          <div className="flex items-start gap-2 rounded-[8px] bg-warning-soft px-2.5 py-2">
            <IconInfo className="mt-px h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="min-w-0 flex-1 text-[13px] leading-5 text-ink-secondary">
              {card.blocked}
            </p>
          </div>
        )}

        {!card.running && card.expanded && card.candidates.length > 0 && (
          <div className="space-y-1.5">
            {!card.ranked && (
              <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                <IconInfo className="h-3.5 w-3.5" />
                排序没完成，以下按起草顺序展示
              </p>
            )}
            {card.candidates.map((item, index) => (
              <button
                key={index}
                type="button"
                className="group/cand block w-full rounded-[10px] border border-border bg-surface px-2.5 py-2 text-left transition-all duration-200 hover:border-primary-border hover:bg-primary-soft/40 hover:shadow-xs active:translate-y-px"
                onClick={() => onPick(item.text)}
              >
                <span className="flex items-start gap-2.5">
                  <span className="tnum mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold text-ink-muted transition-colors duration-200 group-hover/cand:bg-primary group-hover/cand:text-white">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block whitespace-pre-wrap break-words text-[14px] leading-[22px] text-ink">
                      {item.text}
                    </span>
                    {card.ranked && (
                      <span className="mt-1.5 inline-flex items-baseline gap-1 text-[11px] text-ink-faint">
                        匹配度
                        <span className="tnum font-medium text-ink-secondary">
                          {item.percent}%
                        </span>
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {!card.running && card.expanded && !card.error && (card.scores?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {card.scores!.map((item) => (
              <span
                key={item.key}
                className={`rounded-[6px] bg-surface-sunken px-1.5 py-0.5 text-[11px] ${
                  TONE_TEXT[item.tone ?? 'info'] ?? 'text-ink-secondary'
                }`}
              >
                {item.title} {item.text}
              </span>
            ))}
          </div>
        )}

        {!card.running && !card.expanded && !card.error && hasBody && (
          <p className="text-[12px] text-ink-muted">
            {card.candidates.length > 0
              ? `已生成 ${card.candidates.length} 条候选${card.ranked ? '' : '（排序未完成）'}`
              : '已给出建议'}
          </p>
        )}
      </div>
    </div>
  )
}
