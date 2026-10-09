import type { ReactNode } from 'react'

/**
 * 页面外壳：画布背景，内容区靠 PageBody 控制宽度与留白。
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="app-shell flex h-full min-h-0 flex-col bg-canvas">{children}</div>
}

/** 主内容区：居中、最大宽度 1152px、桌面 32px 留白。 */
export function PageBody({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-6xl px-5 py-6 sm:px-8 sm:py-8 ${className}`}>{children}</main>
}

/** 页面标题区：标题 21/28 600；说明 13/20；右侧放主要操作。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold leading-7 tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/** 数据卡片：白色表面 + 细边框 + 14px 圆角 + 极轻阴影。 */
export function DataCard({
  title,
  description,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={
        'overflow-hidden rounded-[14px] border border-border bg-surface shadow-card ' + className
      }
    >
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h2 className="text-[16px] font-semibold leading-6 tracking-tight text-ink">{title}</h2>
            )}
            {description && <p className="mt-1 text-[13px] leading-5 text-ink-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={'p-5 ' + bodyClassName}>{children}</div>
    </section>
  )
}

type StatusTone = 'success' | 'primary' | 'warning' | 'danger' | 'info'

/**
 * 状态标签：**文字 + 颜色双表达**（禁止只靠颜色传递状态）。
 */
export function StatusTag({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const tones: Record<StatusTone, string> = {
    success: 'bg-success-soft text-success',
    primary: 'bg-primary-soft text-primary',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[13px] font-medium leading-5 ${tones[tone]}`}
    >
      {children}
    </span>
  )
}

/**
 * 空状态：必须解释「为什么为空」和「下一步做什么」，
 * 不能只显示「暂无数据」。
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      <span className="relative mb-4 grid h-14 w-14 place-items-center rounded-[16px] border border-border bg-surface text-ink-faint shadow-xs" aria-hidden>
        <span className="absolute inset-0 grid-veil rounded-[16px] opacity-70" />
        <svg viewBox="0 0 24 24" className="relative h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
          <path d="M8.5 9.5h7M8.5 13h4" />
        </svg>
      </span>
      <p className="text-[14px] font-medium text-ink">{title}</p>
      <p className="mt-1.5 max-w-md text-[13px] leading-5 text-ink-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** 顶部提示条：用于状态与风险说明。 */
export function Notice({
  tone = 'info',
  children,
}: {
  tone?: StatusTone
  children: ReactNode
}) {
  const tones: Record<StatusTone, string> = {
    success: 'bg-success-soft text-success',
    primary: 'bg-primary-soft text-primary',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-ink-secondary',
  }
  return (
    <div className={`rounded-[10px] px-3.5 py-2.5 text-[13px] leading-5 ${tones[tone]}`}>{children}</div>
  )
}
