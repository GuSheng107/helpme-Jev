import { useState } from 'react'
import { ApiError } from '../api/client'
import { changePassword, type UserSummary } from '../api/auth'
import Button from '../components/Button'
import Field from '../components/Field'
import { Notice, PageShell } from '../components/layout'

interface Props {
  user: UserSummary
  forced: boolean
  onDone: (user: UserSummary) => void
}

/** 密码规则：≥10 位，且同时含字母、数字与符号（与后端一致，输入即校验） */
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
    <PageShell>
      <div className="flex min-h-screen items-center justify-center px-5 py-8">
        <div className="w-full max-w-[420px]">
          <header className="mb-4">
            <h1 className="text-[20px] font-semibold leading-7 text-ink">
              {forced ? '首次登录，请修改密码' : '修改密码'}
            </h1>
            <p className="mt-1 text-[13px] leading-5 text-ink-muted">账号：{user.username}</p>
          </header>

          <div className="rounded-[8px] border border-border bg-surface p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
            {forced && (
              <div className="mb-4">
                <Notice tone="warning">
                  当前账号使用初始密码，出于安全考虑必须先修改后才能继续使用。
                </Notice>
              </div>
            )}

            <form onSubmit={submit} className="space-y-3">
              <Field
                label="当前密码"
                type="password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
                required
                autoComplete="current-password"
              />

              <Field
                label="新密码"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                autoComplete="new-password"
                placeholder="至少 10 位，含字母、数字与符号"
                error={policyError}
              />

              <Field
                label="确认新密码"
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                required
                autoComplete="new-password"
                error={mismatch ? '两次输入不一致' : null}
              />

              {error && <Notice tone="danger">{error}</Notice>}

              <div className="pt-1">
                <Button
                  type="submit"
                  variant="primary"
                  loading={busy}
                  disabled={Boolean(policyError) || mismatch}
                  disabledReason={policyError ?? (mismatch ? '两次输入不一致' : undefined)}
                >
                  确认修改
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
