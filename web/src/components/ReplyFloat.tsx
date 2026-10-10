import type { Candidate } from '../api/chat'
import type { ReplyScoreItem } from '../api/chat'
import StageLoader, { type LoaderStep } from './StageLoader'
import { IconInfo, IconRefresh, IconSparkle, IconWarning, IconClose } from './icons'

/**
 * 一条「帮我回复」管线在浮层里的状态：随阶段逐步填充（内存级，刷新页面即清）。
 * 每个会话同时只保留最新一条，新来话会顶掉上一份。
 */
export interface ReplyCard {
  id: number
  conversationId: number
  /** 群聊里要回复的成员 key；单聊为空 */
  targetMember: string
  /** 群聊里要回复的成员显示名（建卡时解析好，列表改名也能跟上） */
  targetName: string
  /** 触发本次管线的来话消息 id */
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
}

const STEP_LABELS: Record<string, { running: string; done: string }> = {
  translate: { running: '正在解读来话', done: '解读完成' },
  score: { running: '正在评分', done: '评分完成' },
  draft: { running: '正在按人设起草', done: '起草完成' },
  rank: { running: '正在排序', done: '排序完成' },
}

/**
 * 浮在回复框上方的「帮我回复」候选层。
 *
 * 管线跑完出现三个候选：点选一条即填入输入框并收起；
 * 高危只给拦截提示；失败可重试。都有关闭按钮，不打断手动输入。
 */
export default function ReplyFloat({
  card,
  onPick,
  onRetry,
  onClose,
}: {
  card: ReplyCard
  onPick: (text: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const loaderSteps: LoaderStep[] = card.plan.map((key, index) => ({
    key,
    running: STEP_LABELS[key]?.running ?? key,
    done: STEP_LABELS[key]?.done ?? key,
    state: index < card.progress ? 'done' : index === card.progress ? 'running' : 'pending',
  }))

  return (
    <div className="animate-rise absolute inset-x-0 bottom-full z-10 mb-2 px-0.5">
      <div className="overflow-hidden rounded-[14px] border border-border bg-surface shadow-lg">
        <div className="flex items-center gap-2 border-b border-border-subtle px-3.5 py-2">
          <IconSparkle className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-secondary">
            帮我回复{card.targetName ? ` · 回复 ${card.targetName}` : ''}
          </span>
          {!card.running && card.error && (
            <button
              type="button"
              className="flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium text-danger transition-colors duration-150 hover:bg-danger/10"
              onClick={onRetry}
            >
              <IconRefresh className="h-3.5 w-3.5" />
              重试
            </button>
          )}
          <button
            type="button"
            aria-label="关闭回复建议"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-ink-faint transition-colors duration-150 hover:bg-surface-hover hover:text-ink"
            onClick={onClose}
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="space-y-2 px-3.5 py-2.5">
          {card.running && <StageLoader steps={loaderSteps} />}

          {!card.running && card.error && (
            <div className="flex items-start gap-2 rounded-[8px] bg-danger-soft px-2.5 py-2">
              <IconWarning className="mt-px h-3.5 w-3.5 shrink-0 text-danger" />
              <p className="min-w-0 flex-1 text-[13px] leading-5 text-danger">{card.error}</p>
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

          {!card.running && !card.error && !card.blocked && card.candidates.length > 0 && (
            <>
              {!card.ranked && (
                <p className="flex items-center gap-1.5 text-[12px] text-ink-muted">
                  <IconInfo className="h-3.5 w-3.5" />
                  排序没完成，以下按起草顺序展示
                </p>
              )}
              <div className="space-y-1.5">
                {card.candidates.map((item, index) => (
                  <button
                    key={index}
                    type="button"
                    className="group/cand block w-full rounded-[10px] border border-border bg-surface px-3 py-2 text-left transition-all duration-200 hover:border-primary-border hover:bg-primary-soft/40 hover:shadow-xs active:translate-y-px"
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
                          <span className="mt-1 inline-flex items-baseline gap-1 text-[11px] text-ink-faint">
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
              <p className="text-[11px] text-ink-faint">点一条填入输入框，可以直接改再保存</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
