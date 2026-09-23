import { logout, type UserSummary } from '../api/auth'
import Button from '../components/Button'
import { DataCard, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

interface Props {
  user: UserSummary
  onLogout: () => void
  onOpenSettings: () => void
}

/** P0/P1 阶段的落地页：用于核对登录链路与权限是否按预期生效。
 *  聊天副驾 / 决策工作台等页面自 P2 起陆续接入。 */
export default function HomePage({ user, onLogout, onOpenSettings }: Props) {
  return (
    <PageShell>
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-[52px] max-w-5xl items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <span className="text-[16px] font-semibold leading-6 text-ink">HelpMe JEV</span>
            <StatusTag tone="info">P1 配置</StatusTag>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[13px] text-ink-secondary sm:inline">
              {user.display_name || user.username}
            </span>
            <Button size="sm" onClick={onOpenSettings}>
              设置
            </Button>
            <Button size="sm" onClick={onLogout}>
              退出
            </Button>
          </div>
        </div>
      </header>

      <PageBody>
        <PageHeader
          title="登录成功"
          description="基座已就绪。以下为当前账号的权限清单，可用于核对隔离与授权是否按预期生效。"
        />

        <DataCard title="账号信息">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Info label="用户名" value={user.username} mono />
            <Info label="角色" value={user.role === 'admin' ? '管理员' : '普通用户'} />
            <Info label="强制改密" value={user.must_change_password ? '是' : '否'} />
            <Info label="邮箱" value={user.email || '—'} />
          </dl>
        </DataCard>

        <div className="mt-4">
          <DataCard title="能力清单">
            <div className="flex flex-wrap gap-2">
              {user.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="mono rounded-[4px] border border-[#d9ecff] bg-primary-soft px-2 py-0.5 text-[13px] leading-5 text-primary-hover"
                >
                  {cap}
                </span>
              ))}
            </div>
            <p className="mt-3 text-[13px] leading-5 text-ink-muted">
              注意：清单中不含「查看他人日志」类能力 —— 管理员亦不可查看用户日志。
            </p>
          </DataCard>
        </div>

        <div className="mt-4">
          <DataCard title="后续阶段">
            <ul className="space-y-2 text-[13px] leading-5 text-ink-secondary">
              <li>· 提供方配置与连通性 / 冒烟测试（P1）</li>
              <li>· 上下文装配与记忆治理（P2）</li>
              <li>· JEV 判断与翻译桥（P3 / P4）</li>
              <li>· 人设建模、方案链路、通用决策工作台（P5–P7）</li>
            </ul>
          </DataCard>
        </div>
      </PageBody>
    </PageShell>
  )
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[6px] bg-surface-muted px-3 py-2">
      <dt className="text-[13px] leading-5 text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 text-[14px] leading-[22px] text-ink ${mono ? 'mono' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
