import { useState } from 'react'
import { ApiError, setToken } from '../api/client'
import { login, register, type UserSummary } from '../api/auth'

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
        // 注册成功后自动切到登录
        setMode('login')
        setPassword('')
        setError(null)
      } else {
        const result = await login(username.trim(), password)
        setToken(result.access_token)
        onAuthenticated(result)
      }
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `${err.message}${err.code === 'INVALID_INVITATION' ? '（请确认邀请码是否正确）' : ''}`
          : '网络异常，请稍后再试'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-shell flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">HelpMe JEV</h1>
          <p className="mt-2 text-sm text-slate-500">
            JEV 出决策 · LLM 做表达 · 你拍板
          </p>
        </header>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login')
                setError(null)
              }}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                !isRegister ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register')
                setError(null)
              }}
              className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition ${
                isRegister ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
              }`}
            >
              邀请码注册
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4">
            {isRegister && (
              <Field
                label="邀请码"
                value={invitationCode}
                onChange={setInvitationCode}
                placeholder="例如 A1B2-C3D4-E5F6-G7H8"
                required
                autoComplete="off"
              />
            )}

            <Field
              label="用户名"
              value={username}
              onChange={setUsername}
              placeholder="字母、数字、下划线"
              required
              autoComplete="username"
            />

            {isRegister && (
              <Field
                label="显示名称"
                value={displayName}
                onChange={setDisplayName}
                placeholder="留空则与用户名相同"
                autoComplete="nickname"
              />
            )}

            <Field
              label="密码"
              value={password}
              onChange={setPassword}
              type="password"
              placeholder={isRegister ? '至少 10 位，含字母、数字与符号' : ''}
              required
              autoComplete={isRegister ? 'new-password' : 'current-password'}
            />

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
            >
              {busy ? '处理中…' : isRegister ? '注册' : '登录'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          注册需要邀请码；未持有邀请码请联系管理员
        </p>
      </div>
    </div>
  )
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  autoComplete?: string
}) {
  const { label, value, onChange, type = 'text', placeholder, required, autoComplete } = props
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <input
        type={type}
        value={value}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
    </label>
  )
}
