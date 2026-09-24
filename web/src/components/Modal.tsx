import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  children: ReactNode
  onClose: () => void
  size?: 'sm' | 'md' | 'lg' | 'full'
  surface?: 'card' | 'media'
  scroll?: 'auto' | 'hidden' | 'visible'
  role?: 'dialog' | 'alertdialog'
  labelledBy?: string
  describedBy?: string
  ariaLabel?: string
  initialFocusSelector?: string
  overlayClassName?: string
  className?: string
  busy?: boolean
  closeOnBackdrop?: boolean
}

/** 全站弹窗外壳：遮罩、焦点约束、Esc、返回焦点和滚动锁定统一处理。 */
export default function Modal({
  children,
  onClose,
  size = 'md',
  surface = 'card',
  scroll = 'auto',
  role = 'dialog',
  labelledBy,
  describedBy,
  ariaLabel,
  initialFocusSelector,
  overlayClassName = 'bg-[#152844]/45 backdrop-blur-[2px]',
  className = '',
  busy = false,
  closeOnBackdrop = true,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const initial = initialFocusSelector
      ? contentRef.current?.querySelector<HTMLElement>(initialFocusSelector)
      : null
    const focusTarget = initial ?? contentRef.current
    focusTarget?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [initialFocusSelector])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!busy) onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(contentRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => element.getClientRects().length > 0)
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && (document.activeElement === first || document.activeElement === contentRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === contentRef.current)) {
      event.preventDefault()
      first.focus()
    }
  }

  const sizes = {
    sm: 'max-w-[440px]',
    md: 'max-w-[560px]',
    lg: 'max-w-4xl',
    full: 'max-w-full',
  }
  const surfaces = {
    card: 'rounded-[20px] border border-[#dce8f5] bg-white shadow-[0_24px_70px_rgba(14,42,78,0.24)]',
    media: 'relative bg-transparent',
  }
  const scrolls = {
    auto: 'overflow-y-auto',
    hidden: 'overflow-hidden',
    visible: 'overflow-visible',
  }

  return createPortal(
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center px-2 py-2 sm:px-4 sm:py-6 ${overlayClassName}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && closeOnBackdrop && !busy) onClose()
      }}
    >
      <div
        ref={contentRef}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`max-h-[calc(100dvh-1rem)] sm:max-h-[90vh] outline-none ${surface === 'media' ? 'w-auto' : 'w-full'} ${sizes[size]} ${surfaces[surface]} ${scrolls[scroll]} ${className}`}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
