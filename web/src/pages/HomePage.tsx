import { logout, type UserSummary } from '../api/auth'

interface Props {
  user: UserSummary
  onLogout: () => void
}

/** P0 阶段的落地页：确认登录链路与权限展示可用。
 *  聊天副驾 / 决策工作台 / 设置等页面在后续阶段接入。 */
export default function HomePage({ user, onLogout }: Props) {
  return (
    <div className="app-shell min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-slate-900">HelpMe JEV</span>
            <span className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 sm:inline">
              P0 基座
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">{user.display_name || user.username}</span>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-50"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">登录成功</h1>
          <p className="mt-1 text-sm text-slate-500">
            基座已就绪。以下为当前账号的权限清单，可用于核对隔离与授权是否按预期生效。
          </p>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <Info label="用户名" value={user.username} />
            <Info label="角色" value={user.role === 'admin' ? '管理员' : '普通用户'} />
            <Info label="强制改密" value={user.must_change_password ? '是' : '否'} />
            <Info label="邮箱" value={user.email || '—'} />
          </dl>

          <div className="mt-6">
            <h2 className="text-sm font-medium text-slate-700">能力清单</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {user.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-700"
                >
                  {cap}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-400">
              注意：清单中不包含"查看他人日志"类能力 —— admin 亦不可查看用户日志。
            </p>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-white/60 p-6">
          <h2 className="text-sm font-medium text-slate-700">后续阶段</h2>
          <ul className="mt-3 space-y-2 text-sm text-slate-500">
            <li>· 提供方配置与连通性测试（P1）</li>
            <li>· 上下文装配与记忆治理（P2）</li>
            <li>· JEV 判断与翻译桥（P3 / P4）</li>
            <li>· 人设建模、方案链路、通用决策工作台（P5–P7）</li>
          </ul>
        </section>
      </main>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  )
}
