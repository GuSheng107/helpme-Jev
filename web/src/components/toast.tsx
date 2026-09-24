import { useEffect, useState } from 'react'
import { ApiError } from '../api/client'

type Tone = 'success' | 'danger'

/** 全站统一提示：操作成功、接口报错都走这里，右上角两秒后消失。 */
export function toast(message: string, tone: Tone = 'success') {
  window.dispatchEvent(new CustomEvent('hmj-toast', { detail: { message, tone } }))
}

export function toastError(err: unknown, fallback: string) {
  toast(err instanceof ApiError ? err.message : fallback, 'danger')
}

export function ToastHost() {
  const [current, setCurrent] = useState<{ message: string; tone: Tone } | null>(null)

  useEffect(() => {
    let timer = 0
    function show(event: Event) {
      const detail = (event as CustomEvent).detail as { message?: string; tone?: Tone }
      setCurrent({ message: detail.message || '', tone: detail.tone || 'success' })
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setCurrent(null), 2000)
    }
    window.addEventListener('hmj-toast', show)
    return () => {
      window.removeEventListener('hmj-toast', show)
      window.clearTimeout(timer)
    }
  }, [])

  if (!current) return null
  const toneClass =
    current.tone === 'danger'
      ? 'border-[#f3d4d0] bg-[#fef0f0] text-danger'
      : 'border-[#d9ecff] bg-[#f0f9ff] text-[#337ecc]'
  return (
    <div className={`fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-[8px] border px-4 py-2.5 text-[13px] shadow-[0_8px_24px_rgb(15_23_42/0.12)] ${toneClass}`}>
      {current.message}
    </div>
  )
}
