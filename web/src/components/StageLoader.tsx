export interface LoaderStep {
  key: string
  /** 进行中的文案 */
  running: string
  /** 完成后的文案 */
  done: string
  state: 'pending' | 'running' | 'done'
}

/** 分阶段 loading：逐步显示进行中 / 已完成，把上游的真实进度摊给用户看。 */
export default function StageLoader({ steps }: { steps: LoaderStep[] }) {
  return (
    <ul className="space-y-2">
      {steps.map((step) => (
        <li key={step.key} className="flex items-center gap-2 whitespace-nowrap text-[13px]">
          <StepMark state={step.state} />
          <span className={step.state === 'pending' ? 'text-ink-muted' : 'font-medium text-ink'}>
            {step.state === 'done' ? step.done : step.running}
          </span>
        </li>
      ))}
    </ul>
  )
}

function StepMark({ state }: { state: LoaderStep['state'] }) {
  if (state === 'done') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M20 6 9 17l-5-5" />
      </svg>
    )
  }
  if (state === 'running') {
    return <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
  }
  return <span className="h-4 w-4 shrink-0 rounded-full border-2 border-border" />
}
