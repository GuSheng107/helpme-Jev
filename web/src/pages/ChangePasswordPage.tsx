import { useState } from 'react'
import { ApiError } from '../api/client'
import { changePassword, type UserSummary } from '../api/auth'

interface Props {
  user: UserSummary
  forced: boolean
  onDone: (user: UserSummary) => void
}

/** 密码规则：≥10 位，且同时含字母、数字与符号（与后端一致） */
function validate(password: string): string | null {
  if (password.length < 10) return '密码至少 10 位'
  if (!/[A-Za-z]/.test(password)) return '需包含至少一个字母'
  if (!/\d/.test(password)) return '需包含至少一个数字'
  if (!/[^A-Za-z0-9]/.test(password)) return '需包含至少一个符号'
  return null
}

export default function ChangePasswordPage({ user, forced, onDone }: Props) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const policyError = newPassword ? validate(newPassword) : null
  const mismatch = confirm.length > 0 && confirm !== newPassword

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (policyError || mismatch) return
    setBusy(true)
    setError(null)
    try {
      const updated = await changePassword(oldPassword, newPassword)
      onDone(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">
          {forced ? '首次登录，请修改密码' : '修改密码'}
        </h1>
        {forced && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            当前账号使用初始密码，出于安全考虑必须先修改后才能继续使用。
          </p>
        )}
        <p className="mt-2 text-sm text-slate-500">账号：{user.username}</p>

        <form onSubmit={submit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">当前密码</span>
            <input
              type="password"
              value={oldPassword}
              required
              autoComplete="current-password"
              onChange={(event) => setOldPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">新密码</span>
            <input
              type="password"
              value={newPassword}
              required
              autoComplete="new-password"
              placeholder="至少 10 位，含字母、数字与符号"
              onChange={(event) => setNewPassword(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {policyError && <span className="mt-1 block text-xs text-red-600">{policyError}</span>}
          </label>

          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-slate-700">确认新密码</span>
            <input
              type="password"
              value={confirm}
              required
              autoComplete="new-password"
              onChange={(event) => setConfirm(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            {mismatch && <span className="mt-1 block text-xs text-red-600">两次输入不一致</span>}
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || Boolean(policyError) || mismatch}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? '提交中…' : '确认修改'}
          </button>
        </form>
      </div>
    </div>
  )
}
