import { useState } from 'react'
import { ApiError, setToken } from '../api/client'
import { login, register, type UserSummary } from '../api/auth'
import Button from '../components/Button'
import Field from '../components/Field'
import { Notice, PageShell } from '../components/layout'

interface Props {
  onAuthenticated: (user: UserSummary) => void
}

type Mode = 'login' | 'register'

export default function LoginPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRegister = mode === 'register'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (isRegister) {
        await register({
          invitation_code: invitationCode.trim(),
          username: username.trim(),
          display_name: displayName.trim() || username.trim(),
          password,
        })
        // 注册成功后切回登录（注册接口不返回 token）
        setMode('login')
        setPassword('')
      } else {
        const result = await login(username.trim(), password)
        setToken(result.access_token)
        onAuthenticated(result)
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
  }

  return (
    <PageShell>
      <div className="flex min-h-screen items-center justify-center px-5 py-8">
        <div className="w-full max-w-[380px]">
          <header className="mb-5 text-center">
            <p className="text-[13px] leading-5 text-ink-muted">帮帮我 Jev！</p>
            <h1 className="mt-1 text-[20px] font-semibold leading-7 text-ink">
              遇到不会回答的问题怎么办，马上召唤 Jev 来帮你
            </h1>
          </header>

          <div className="rounded-[8px] border border-border bg-surface p-4 shadow-[0_1px_3px_rgb(0_0_0/0.06)]">
            <div className="mb-4 flex border-b border-border-subtle">
              {(['login', 'register'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => switchMode(item)}
                  className={`-mb-px border-b-2 px-3 py-2 text-[14px] font-medium transition-colors ${
                    mode === item
                      ? 'border-primary text-primary'
                      : 'border-transparent text-ink-muted hover:text-ink-secondary'
                  }`}
                >
                  {item === 'login' ? '登录' : '邀请码注册'}
                </button>
              ))}
            </div>

            <form onSubmit={submit} className="space-y-3">
              {isRegister && (
                <Field
                  label="邀请码"
                  value={invitationCode}
                  onChange={(event) => setInvitationCode(event.target.value)}
                  placeholder="例如 A1B2-C3D4-E5F6-G7H8"
                  required
                  autoComplete="off"
                  hint="注册需要邀请码，未持有请联系管理员"
                />
              )}

              <Field
                label="用户名"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="字母、数字、下划线"
                required
                autoComplete="username"
              />

              {isRegister && (
                <Field
                  label="显示名称"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="留空则与用户名相同"
                  autoComplete="nickname"
                />
              )}

              <Field
                label="密码"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                placeholder={isRegister ? '至少 10 位，含字母、数字与符号' : ''}
                required
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />

              {error && <Notice tone="danger">{error}</Notice>}

              <div className="pt-1">
                <Button type="submit" variant="primary" loading={busy} className="w-full">
                  {isRegister ? '注册' : '登录'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
