import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../api/client'
import { IconCheck, IconClose, IconInfo, IconWarning } from './icons'

type Tone = 'success' | 'warning' | 'error'

interface ToastItem {
  id: number
  message: string
  tone: Tone
}

/** 全站统一提示入口，页面无需自己维护 Toast 状态。 */
export function toast(message: string, tone: Tone = 'success') {
  window.dispatchEvent(new CustomEvent('hmj-toast', { detail: { message, tone } }))
}

export function toastError(err: unknown, fallback: string) {
  toast(err instanceof ApiError ? err.message : fallback, 'error')
}

const TONE_META: Record<Tone, { bar: string; icon: string; title: string; label: string }> = {
  success: { bar: 'bg-success', icon: 'bg-success-soft text-success', title: 'text-success', label: '操作成功' },
  warning: { bar: 'bg-warning', icon: 'bg-warning-soft text-warning', title: 'text-warning', label: '请注意' },
  error: { bar: 'bg-danger', icon: 'bg-danger-soft text-danger', title: 'text-danger', label: '操作失败' },
}

/** Toast 的统一展示组件。 */
export function Toast({ message, tone, onClose }: { message: string; tone: Tone; onClose: () => void }) {
  const meta = TONE_META[tone]
  const Glyph = tone === 'error' ? IconWarning : tone === 'warning' ? IconInfo : IconCheck
  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className="relative flex w-full animate-slide-down items-start gap-3 overflow-hidden rounded-[12px] border border-border bg-surface px-4 py-3.5 shadow-lg"
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${meta.bar}`} aria-hidden />
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${meta.icon}`} aria-hidden>
        <Glyph className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-semibold ${meta.title}`}>{meta.label}</p>
        <p className="mt-0.5 break-words text-[13px] leading-5 text-ink-secondary">{message}</p>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-ink-faint transition-colors hover:bg-surface-muted hover:text-ink-secondary"
        aria-label="关闭提示"
      >
        <IconClose className="h-4 w-4" />
      </button>
    </div>
  )
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timers = useRef(new Map<number, number>())
  const nextId = useRef(0)

  useEffect(() => {
    function show(event: Event) {
      const detail = (event as CustomEvent<{ message?: string; tone?: Tone }>).detail
      const item: ToastItem = {
        id: ++nextId.current,
        message: detail.message || '',
        tone: detail.tone || 'success',
      }
      setItems((current) => [...current, item].slice(-3))
      const timer = window.setTimeout(() => {
        setItems((current) => current.filter((entry) => entry.id !== item.id))
        timers.current.delete(item.id)
      }, 4000)
      timers.current.set(item.id, timer)
    }
    window.addEventListener('hmj-toast', show)
    return () => {
      window.removeEventListener('hmj-toast', show)
      timers.current.forEach((timer) => window.clearTimeout(timer))
      timers.current.clear()
    }
  }, [])

  function close(id: number) {
    window.clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setItems((current) => current.filter((item) => item.id !== id))
  }

  if (items.length === 0) return null
  return createPortal(
    <div className="fixed left-4 right-4 top-4 z-[80] flex flex-col gap-2.5 sm:left-auto sm:w-[364px]">
      {items.map((item) => (
        <Toast key={item.id} message={item.message} tone={item.tone} onClose={() => close(item.id)} />
      ))}
    </div>,
    document.body,
  )
}
