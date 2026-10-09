export interface LoaderStep {
  key: string
  /** 进行中的文案 */
  running: string
  /** 完成后的文案 */
  done: string
  state: 'pending' | 'running' | 'done'
}

/** 分阶段 loading：同一次只展示当前这一步，完成后换成下一句。 */
export default function StageLoader({ steps }: { steps: LoaderStep[] }) {
  const current =
    steps.find((step) => step.state === 'running') ??
    [...steps].reverse().find((step) => step.state === 'done')
  if (!current) return null
  const done = current.state === 'done'
  return (
    <p
      key={current.key + current.state}
      role="status"
      className="flex animate-fade-in items-center gap-2.5 whitespace-nowrap text-[14px]"
    >
      {done ? <DoneMark /> : <Spinner />}
      <span className="font-medium text-ink">{done ? current.done : current.running}</span>
    </p>
  )
}

function Spinner() {
  return (
    <span className="relative h-4 w-4 shrink-0" aria-hidden>
      <span className="absolute inset-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      <span className="absolute inset-[3px] animate-ping rounded-full bg-primary/40" />
    </span>
  )
}

function DoneMark() {
  return (
    <span className="grid h-4 w-4 shrink-0 animate-pop place-items-center rounded-full bg-success-soft" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-3 w-3 text-success" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  )
}
