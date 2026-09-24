import { useState } from 'react'
import { ApiError, setToken } from '../api/client'
import { login, register, type UserSummary } from '../api/auth'
import { Notice } from '../components/layout'

interface Props {
  onAuthenticated: (user: UserSummary) => void
}

type Mode = 'login' | 'register'

const PARTICLES = [
  { left: '6%', top: '18%', size: 6, delay: '0s', duration: '7s' },
  { left: '15%', top: '64%', size: 8, delay: '1.4s', duration: '9s' },
  { left: '28%', top: '30%', size: 5, delay: '2.2s', duration: '6s' },
  { left: '38%', top: '78%', size: 7, delay: '0.8s', duration: '8s' },
  { left: '52%', top: '20%', size: 6, delay: '3s', duration: '7.5s' },
  { left: '64%', top: '58%', size: 9, delay: '1.8s', duration: '10s' },
  { left: '74%', top: '34%', size: 5, delay: '0.4s', duration: '6.5s' },
  { left: '84%', top: '70%', size: 7, delay: '2.6s', duration: '8.5s' },
  { left: '92%', top: '24%', size: 6, delay: '1.1s', duration: '7s' },
]



export default function LoginPage({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
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
        try {
          const result = await login(username.trim(), password)
          setToken(result.access_token)
          onAuthenticated(result)
        } catch {
          setMode('login')
          setError('注册成功，请使用新账号登录。')
        }
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
    setShowPassword(false)
  }

  function onMove(event: React.MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    event.currentTarget.style.transform = `perspective(1000px) rotateX(${py * -8}deg) rotateY(${px * 10}deg)`
  }

  return (
    <main className="relative grid min-h-screen overflow-hidden bg-gradient-to-br from-[#ecf5ff] via-[#f5f7fa] to-white lg:grid-cols-[minmax(440px,44%)_1fr]">
      <style>{`
        @keyframes hmj-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-14px); } }
        @keyframes hmj-drift { 0%,100% { transform: translate3d(0,0,0); } 50% { transform: translate3d(18px,-24px,0); } }
        @keyframes hmj-up { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#409eff]/15 blur-3xl"
        style={{ animation: 'hmj-drift 14s ease-in-out infinite' }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-sky-200/50 blur-3xl"
        style={{ animation: 'hmj-drift 16s ease-in-out infinite', animationDelay: '-7s' }}
      />
      {PARTICLES.map((particle, index) => (
        <span
          key={index}
          aria-hidden
          className="pointer-events-none absolute rounded-full bg-[#409eff]/40"
          style={{
            left: particle.left,
            top: particle.top,
            width: particle.size,
            height: particle.size,
            animation: `hmj-float ${particle.duration} ease-in-out ${particle.delay} infinite`,
          }}
        />
      ))}

      <section className="relative hidden p-10 lg:flex">
        <div
          className="relative flex w-full flex-col justify-between overflow-hidden rounded-2xl border border-white/70 bg-gradient-to-br from-white/80 to-[#ecf5ff]/80 p-12 shadow-[0_12px_40px_rgb(64_158_255/0.12)] backdrop-blur-xl transition-transform duration-300"
          onMouseMove={onMove}
          onMouseLeave={(event) => {
            event.currentTarget.style.transform = ''
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-50"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(64,158,255,0.16) 1px, transparent 1px)',
              backgroundSize: '22px 22px',
            }}
          />
          <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-[#409eff]/20 blur-3xl" />

          <div className="relative">
            <Brand />
            <h1 className="mt-8 text-3xl font-semibold leading-tight text-slate-900">
              遇到问题，找 Jev
            </h1>
            <div className="mt-6 space-y-4">
              <Scene title="先看判断">
                <Line side="left" who="对方">没怎么。</Line>
                <Line side="right" who="Jev">
                  <span className="mb-1.5 inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-600">
                    危险度 4/9
                  </span>
                  <span className="block leading-6">想确认你在不在意。</span>
                  <span className="block leading-6 text-slate-500">对方需要被在意，先接住，别解释。</span>
                </Line>
                <Line side="right" who="你">你咋了，发生什么事了。</Line>
              </Scene>
              <div className="flex items-center gap-3 px-1">
                <span className="h-px flex-1 bg-slate-300/70" />
                <span className="text-xs text-slate-400">判断看完，你才决定要不要回复</span>
                <span className="h-px flex-1 bg-slate-300/70" />
              </div>
              <Scene title="再生成回复">
                <Line side="right" who="Jev">
                  <span className="mb-2 block text-xs text-slate-400">三条候选，按匹配度排</span>
                  <span className="block space-y-1.5">
                    {[
                      ['我听出来了，你不是没怎么。', '62%'],
                      ['怎么了，跟我说说。', '24%'],
                      ['那就先不说，我陪你待着。', '14%'],
                    ].map(([text, percent], index) => (
                      <span
                        key={text}
                        className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[13px] leading-5 ${
                          index === 0 ? 'bg-[#409eff]/10 font-medium text-[#337ecc]' : 'text-slate-500'
                        }`}
                      >
                        {text}
                        <span className="shrink-0 text-xs text-slate-400">{percent}</span>
                      </span>
                    ))}
                  </span>
                </Line>
                <Line side="right" who="你">我听出来了，你不是没怎么。</Line>
                <p className="mt-1 text-right text-xs text-slate-400">采用了匹配度最高的一条，系统没有发送。</p>
              </Scene>
            </div>
          </div>
          <div className="relative text-xs tracking-wide text-slate-400">判断给你看，发送你自己来。</div>
        </div>
      </section>

      <section className="relative flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]" style={{ animation: 'hmj-up .45s ease-out' }}>
          <div className="mb-8 lg:hidden">
            <Brand />
          </div>
          <div className="rounded-2xl border border-white/70 bg-white/80 p-8 shadow-[0_12px_40px_rgb(15_23_42/0.08)] backdrop-blur-xl">
            <h2 className="text-xl font-semibold text-slate-800">
              {isRegister ? '邀请码注册' : '登录'}
            </h2>
            <p className="mt-1.5 text-xs text-slate-400">
              {isRegister ? '持有邀请码即可创建账号' : '使用账号与密码进入 HelpMe Jev'}
            </p>
            <form onSubmit={submit} className="mt-7 space-y-4">
              {isRegister && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">
                    邀请码<span className="ml-0.5 text-[#f56c6c]">*</span>
                  </span>
                  <input
                    required
                    autoComplete="off"
                    value={invitationCode}
                    onChange={(event) => setInvitationCode(event.target.value)}
                    placeholder="例如 JEV-ABCD-EFGH-JKLM"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#409eff]"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">
                  账号<span className="ml-0.5 text-[#f56c6c]">*</span>
                </span>
                <input
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="字母、数字、下划线"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#409eff]"
                />
              </label>
              {isRegister && (
                <label className="block">
                  <span className="mb-1.5 block text-xs font-medium text-slate-600">显示名称</span>
                  <input
                    autoComplete="nickname"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="留空则与账号相同"
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-[#409eff]"
                  />
                </label>
              )}
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-slate-600">
                  密码<span className="ml-0.5 text-[#f56c6c]">*</span>
                </span>
                <span className="relative block">
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={isRegister ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={isRegister ? '至少 10 位，含字母、数字与符号' : '账号密码'}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 pr-14 text-sm text-slate-800 outline-none focus:border-[#409eff]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#409eff]"
                    onClick={() => setShowPassword((value) => !value)}
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                      <circle cx="12" cy="12" r="2.5" />
                      {showPassword && <path d="M4 20 20 4" />}
                    </svg>
                  </button>
                </span>
              </label>
              {error && <Notice tone="danger">{error}</Notice>}
              <button
                type="submit"
                disabled={busy}
                className="h-11 w-full rounded-lg bg-gradient-to-r from-[#409eff] to-[#79bbff] text-sm font-medium text-white hover:brightness-105 disabled:opacity-60"
              >
                {busy ? '处理中…' : isRegister ? '注册' : '登录'}
              </button>
            </form>
            <div className="mt-6 flex items-center justify-center gap-2 border-t border-slate-100 pt-5 text-xs text-slate-400">
              {isRegister ? '已有账号？' : '还没有账号？'}
              <button
                type="button"
                className="font-medium text-[#409eff] hover:underline"
                onClick={() => switchMode(isRegister ? 'login' : 'register')}
              >
                {isRegister ? '返回登录' : '使用邀请码注册'}
              </button>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <Mark className="h-10 w-10" />
      <div>
        <div className="text-base font-semibold text-slate-800">HelpMe Jev</div>
        <div className="text-xs text-slate-400">帮帮我 Jev</div>
      </div>
    </div>
  )
}

function Line({
  side,
  who,
  children,
}: {
  side: 'left' | 'right'
  who: string
  children: React.ReactNode
}) {
  const mine = side === 'right'
  return (
    <div className={`mb-2.5 flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      <Avatar who={who} />
      <div className={`max-w-[78%] ${mine ? 'text-right' : ''}`}>
        <span className="mb-1 block text-[11px] text-slate-400">{who}</span>
        <div
          className={`inline-block rounded-2xl px-3 py-2 text-left text-sm text-slate-700 shadow-sm ${
            mine && who !== 'Jev'
              ? 'rounded-br-md bg-[#95ec69]'
              : 'rounded-bl-md border border-white/80 bg-white/85'
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

function Avatar({ who }: { who: string }) {
  if (who === 'Jev') {
    return (
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#409eff" />
        <rect x="8" y="10" width="16" height="12" rx="4" fill="white" />
        <circle cx="13" cy="16" r="1.4" fill="#409eff" />
        <circle cx="19" cy="16" r="1.4" fill="#409eff" />
        <path d="M12.5 19.2h7" stroke="#409eff" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M13 10 V8.2M19 10 V8.2" stroke="white" strokeWidth="1.3" strokeLinecap="round" />
        <circle cx="13" cy="7.6" r="1" fill="white" />
        <circle cx="19" cy="7.6" r="1" fill="white" />
      </svg>
    )
  }
  const mine = who === '你'
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
      <circle cx="16" cy="16" r="16" fill={mine ? '#1f2430' : '#f3b6c4'} />
      <circle cx="16" cy="13" r="4.2" fill={mine ? '#f2d3b5' : '#f8d7c4'} />
      <path
        d={mine ? 'M8 26c1.4-4 4.2-6 8-6s6.6 2 8 6' : 'M8.5 26c1.2-4.2 4-6.2 7.5-6.2s6.3 2 7.5 6.2'}
        fill={mine ? '#3a4254' : '#e4789a'}
      />
      {mine ? (
        <path d="M11.6 11.4c.8-2.4 2.6-3.6 4.6-3.6 2.6 0 4.2 1.6 4.4 3.8-.6.3-1.6.2-2.4-.4-.9 1-2.2 1.2-3.4.6-1 .8-2.2.8-3.2-.4Z" fill="#2a3142" />
      ) : (
        <path d="M10.5 13.2c.4-4 3-6.4 6.2-6.2 3.4.2 5.6 2.6 5.6 5.6 0 .5-.8 1-1.8.6-1.6 1.6-3.6 1.8-5.2.4-1.2 1-2.6.8-3.6-.6-.6.3-1.2.2-1.2.2Z" fill="#3a2a24" />
      )}
    </svg>
  )
}

function Scene({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur">
      <p className="mb-3 text-xs font-medium tracking-wide text-[#409eff]">{title}</p>
      {children}
    </div>
  )
}

function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <rect width="40" height="40" rx="12" fill="#409eff" />
      <path
        d="M8.5 13.5h15a3 3 0 0 1 3 3v5.2a3 3 0 0 1-3 3H15l-3.6 2.8v-2.8h-.9a3 3 0 0 1-3-3v-5.2a3 3 0 0 1 3-3Z"
        fill="white"
      />
      <path
        d="M17 17.2h13.4a2.6 2.6 0 0 1 2.6 2.6v4.6a2.6 2.6 0 0 1-2.6 2.6h-1v2.4L26 27h-9a2.6 2.6 0 0 1-2.6-2.6v-4.6a2.6 2.6 0 0 1 2.6-2.6Z"
        fill="white"
        fillOpacity="0.92"
        stroke="#409eff"
        strokeWidth="1.4"
      />
      <circle cx="21.2" cy="22.1" r="1.05" fill="#409eff" />
      <circle cx="24.6" cy="22.1" r="1.05" fill="#409eff" />
      <circle cx="28" cy="22.1" r="1.05" fill="#409eff" />
    </svg>
  )
}
