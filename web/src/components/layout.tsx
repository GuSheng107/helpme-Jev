import type { ReactNode } from 'react'

/**
 * 页面外壳：浅灰背景 + 内边距 20px（对齐 human-llm-gateway 规范）。
 * 不用巨大留白模拟营销站。
 */
export function PageShell({ children }: { children: ReactNode }) {
  return <div className="app-shell min-h-screen bg-page">{children}</div>
}

/** 主内容区：最大宽度不强制锁死，默认内边距 20px。 */
export function PageBody({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-5xl px-5 py-6">{children}</main>
}

/** 页面标题区：标题 20/28 600；说明 13/20；右侧放主要操作。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[20px] font-semibold leading-7 text-ink">{title}</h1>
        {description && <p className="mt-1 text-[13px] leading-5 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

/** 数据卡片：白色表面 + 细边框 + 8px 圆角 + 极轻阴影。 */
export function DataCard({
  title,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={'rounded-[8px] border border-border bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.06)] ' + className}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          {title && <h2 className="text-[16px] font-semibold leading-6 text-ink">{title}</h2>}
          {actions}
        </header>
      )}
      <div className={"p-4 " + bodyClassName}>{children}</div>
    </section>
  )
}

type StatusTone = 'success' | 'primary' | 'warning' | 'danger' | 'info'

/**
 * 状态标签：**文字 + 颜色双表达**（禁止只靠颜色传递状态）。
 */
export function StatusTag({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const tones: Record<StatusTone, string> = {
    success: 'bg-primary-soft text-success border-primary-soft',
    primary: 'bg-primary-soft text-primary-hover border-primary-soft',
    warning: 'bg-[#fbf3e4] text-warning border-[#f3e4c4]',
    danger: 'bg-[#fbeceb] text-danger border-[#f3d4d0]',
    info: 'bg-surface-muted text-info border-border',
  }
  return (
    <span
      className={`inline-flex items-center rounded-[4px] border px-2 py-0.5 text-[13px] leading-5 ${tones[tone]}`}
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
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <p className="text-[14px] font-medium text-ink-secondary">{title}</p>
      <p className="mt-1 max-w-md text-[13px] leading-5 text-ink-muted">{description}</p>
      {action && <div className="mt-3">{action}</div>}
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
    success: 'bg-[#f0f9eb] text-success',
    primary: 'bg-primary-soft text-primary-hover',
    warning: 'bg-[#fdf6ec] text-warning',
    danger: 'bg-[#fef0f0] text-danger',
    info: 'bg-surface-muted text-ink-secondary',
  }
  return (
    <div className={`rounded-[6px] px-3 py-2 text-[13px] leading-5 ${tones[tone]}`}>{children}</div>
  )
}
