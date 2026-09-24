import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError } from '../api/client'

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

/** Toast 的统一展示组件。 */
export function Toast({ message, tone, onClose }: { message: string; tone: Tone; onClose: () => void }) {
  const styles = {
    success: {
      border: 'border-[#d5e9dc]', bar: 'bg-[#32a779]', icon: 'bg-[#e9f8f0] text-[#23825b]',
      title: 'text-[#207653]', label: '操作成功',
    },
    warning: {
      border: 'border-[#f2e1b8]', bar: 'bg-[#d09a36]', icon: 'bg-[#fff7e7] text-[#ad771c]',
      title: 'text-[#966412]', label: '请注意',
    },
    error: {
      border: 'border-[#f1d4d0]', bar: 'bg-[#c0392b]', icon: 'bg-[#fff1ef] text-[#c0392b]',
      title: 'text-[#a63329]', label: '操作失败',
    },
  }[tone]
  return (
    <div
      role={tone === 'success' ? 'status' : 'alert'}
      className={`relative flex w-full items-start gap-3 overflow-hidden rounded-[14px] border bg-white px-4 py-3.5 shadow-[0_16px_42px_-16px_rgba(22,53,91,0.38)] ${styles.border}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${styles.bar}`} aria-hidden />
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] ${styles.icon}`} aria-hidden>
        {tone === 'error' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" className="h-4 w-4">
            <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
          </svg>
        ) : tone === 'warning' ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M10.2 3.7 2.6 17a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.8 3.7a2 2 0 0 0-3.6 0ZM12 9v4M12 17h.01" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-semibold ${styles.title}`}>{styles.label}</p>
        <p className="mt-0.5 break-words text-[13px] leading-5 text-[#425a73]">{message}</p>
      </div>
      <button type="button" onClick={onClose} className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#91a3b5] transition hover:bg-[#f3f7fb] hover:text-[#475f79]" aria-label="关闭提示">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-4 w-4" aria-hidden>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
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
    <div className="fixed left-4 right-4 top-4 z-[80] flex flex-col gap-2.5 sm:left-auto sm:w-[360px]">
      {items.map((item) => (
        <Toast key={item.id} message={item.message} tone={item.tone} onClose={() => close(item.id)} />
      ))}
    </div>,
    document.body,
  )
}
