import { useState } from 'react'
import { ApiError } from '../api/client'
import { changePassword, type UserSummary } from '../api/auth'
import { Mark } from '../components/AppShell'
import Button from '../components/Button'
import Field from '../components/Field'
import { Notice, PageShell } from '../components/layout'
import { IconCheck } from '../components/icons'

interface Props {
  user: UserSummary
  forced: boolean
  onDone: (user: UserSummary) => void
}

/** 密码规则：≥10 位，且同时含字母、数字与符号（与后端一致，输入即校验） */
const RULES: { label: string; test: (value: string) => boolean }[] = [
  { label: '至少 10 位', test: (value) => value.length >= 10 },
  { label: '含字母', test: (value) => /[A-Za-z]/.test(value) },
  { label: '含数字', test: (value) => /\d/.test(value) },
  { label: '含符号', test: (value) => /[^A-Za-z0-9]/.test(value) },
]

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
      // 首次登录就是用初始密码进来的，不必再验一遍原密码
      const updated = await changePassword(forced ? null : oldPassword, newPassword)
      onDone(updated)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageShell>
      <div className="flex min-h-screen items-center justify-center px-5 py-10">
        <div className="w-full max-w-[424px]">
          <header className="mb-5">
            <Mark className="h-9 w-9" />
            <h1 className="mt-3.5 text-[20px] font-semibold leading-7 tracking-tight text-ink">
              {forced ? '首次登录，请修改密码' : '修改密码'}
            </h1>
            <p className="mt-1.5 text-[13px] leading-5 text-ink-muted">
              {forced
                ? '换成只有你自己知道的密码，之后用新密码登录。'
                : <>当前账号 <span className="mono text-ink-secondary">{user.username}</span></>}
            </p>
          </header>

          <div className="rounded-[18px] border border-border bg-surface p-6 shadow-lg">
            {forced && (
              <div className="mb-4">
                <Notice tone="warning">
                  当前账号使用初始密码，出于安全考虑必须先修改后才能继续使用。
                </Notice>
              </div>
            )}

            <form onSubmit={submit} className="space-y-4">
              {!forced && (
                <Field
                  label="当前密码"
                  type="password"
                  value={oldPassword}
                  onChange={(event) => setOldPassword(event.target.value)}
                  required
                  autoComplete="current-password"
                />
              )}

              <div>
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
                {newPassword.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {RULES.map((rule) => {
                      const passed = rule.test(newPassword)
                      return (
                        <li
                          key={rule.label}
                          className={`inline-flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[12px] transition-colors duration-200 ${
                            passed ? 'bg-success-soft text-success' : 'bg-surface-muted text-ink-muted'
                          }`}
                        >
                          <span
                            className={`grid h-3 w-3 place-items-center rounded-full transition-colors duration-200 ${
                              passed ? 'bg-success/15' : 'bg-border-strong/50'
                            }`}
                          >
                            {passed && <IconCheck className="h-2.5 w-2.5" strokeWidth={3} />}
                          </span>
                          {rule.label}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>

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
                  className="w-full"
                  loading={busy}
                  disabled={Boolean(policyError) || mismatch || newPassword.length === 0 || (!forced && oldPassword.length === 0)}
                  disabledReason={policyError ?? (mismatch ? '两次输入不一致' : '请先填写完整')}
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
