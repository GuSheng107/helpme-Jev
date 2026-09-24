import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import Modal from './Modal'

type ConfirmTone = 'primary' | 'danger'

interface ConfirmOptions {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  tone?: ConfirmTone
}

interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (confirmed: boolean) => void
}

let nextId = 0

/** 与 toast 一样由全局 Host 接管；取消、Esc 和关闭弹窗均返回 false。 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const request: ConfirmRequest = { ...options, id: ++nextId, resolve }
    window.dispatchEvent(new CustomEvent('hmj-confirm', { detail: request }))
  })
}

export function ConfirmHost() {
  const activeRef = useRef<ConfirmRequest | null>(null)
  const queueRef = useRef<ConfirmRequest[]>([])
  const [active, setActive] = useState<ConfirmRequest | null>(null)

  useEffect(() => {
    function enqueue(event: Event) {
      const request = (event as CustomEvent<ConfirmRequest>).detail
      if (activeRef.current) {
        queueRef.current.push(request)
      } else {
        activeRef.current = request
        setActive(request)
      }
    }
    window.addEventListener('hmj-confirm', enqueue)
    return () => {
      window.removeEventListener('hmj-confirm', enqueue)
      activeRef.current?.resolve(false)
      queueRef.current.forEach((request) => request.resolve(false))
      activeRef.current = null
      queueRef.current = []
    }
  }, [])

  function settle(confirmed: boolean) {
    const current = activeRef.current
    if (!current) return
    current.resolve(confirmed)
    const next = queueRef.current.shift() ?? null
    activeRef.current = next
    setActive(next)
  }

  if (!active) return null
  return (
    <ConfirmDialog
      key={active.id}
      title={active.title}
      message={active.message}
      confirmText={active.confirmText}
      cancelText={active.cancelText}
      tone={active.tone}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  )
}

interface ConfirmDialogProps extends ConfirmOptions {
  onConfirm: () => void
  onCancel: () => void
  children?: ReactNode
  busy?: boolean
  confirmDisabled?: boolean
}

/** 也可用于需要附加输入框的确认操作。 */
export function ConfirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  tone = 'primary',
  onConfirm,
  onCancel,
  children,
  busy = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()

  return (
    <Modal
      size="sm"
      role="alertdialog"
      labelledBy={titleId}
      describedBy={messageId}
      initialFocusSelector="[data-modal-initial-focus]"
      onClose={onCancel}
      busy={busy}
    >
      <form
        onSubmit={(event) => { event.preventDefault(); if (!busy && !confirmDisabled) onConfirm() }}
        className="p-5 sm:p-6"
      >
        <span className={`grid h-11 w-11 place-items-center rounded-[14px] ${tone === 'danger' ? 'bg-[#fff0ee] text-[#c0392b]' : 'bg-[#eaf4ff] text-[#318deb]'}`} aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M12 8v5m0 4h.01M10.2 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.8 3.7a2 2 0 0 0-3.6 0Z" />
          </svg>
        </span>
        <h2 id={titleId} className="mt-4 text-[18px] font-semibold text-[#1b3658]">{title}</h2>
        <p id={messageId} className="mt-2 text-[13px] leading-6 text-[#61758d]">{message}</p>
        {children && <div className="mt-4">{children}</div>}
        <div className="mt-6 flex flex-wrap justify-end gap-2.5">
          <button data-modal-initial-focus type="button" disabled={busy} onClick={onCancel} className="min-h-9 rounded-lg border border-[#dce7f4] bg-white px-4 text-[13px] font-medium text-[#4b6380] transition hover:bg-[#f5f9fd] disabled:opacity-60">
            {cancelText}
          </button>
          <button type="submit" disabled={busy || confirmDisabled} className={`min-h-9 rounded-lg px-4 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${tone === 'danger' ? 'bg-[#c0392b] hover:bg-[#a62e22]' : 'bg-[#318deb] hover:bg-[#267bd2]'}`}>
            {busy ? '处理中…' : confirmText}
          </button>
        </div>
      </form>
    </Modal>
  )
}
