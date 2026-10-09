import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  setUserActive,
  type ManagedUser,
} from '../api/admin'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import Field from '../components/Field'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'
import { IconPlus } from '../components/icons'
import { toast } from '../components/toast'
import { formatLocalMinute } from '../utils/datetime'

/** 管理员的用户页：只管账号，不看任何人的聊天、人设和日志。 */
export default function UsersPage() {
  const [rows, setRows] = useState<ManagedUser[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [temporary, setTemporary] = useState<{ name: string; password: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setRows(await listUsers())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createUser({ username, display_name: displayName, password })
      setCreating(false)
      setUsername('')
      setDisplayName('')
      setPassword('')
      setNotice('账号已创建，对方首次登录需要修改密码。')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败')
    } finally {
      setBusy(false)
    }
  }

  async function toggle(row: ManagedUser) {
    setError(null)
    try {
      await setUserActive(row.id, !row.is_active)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失败')
    }
  }

  async function reset(row: ManagedUser) {
    if (!await confirmAction({
      title: '重置密码',
      message: `重置「${row.username}」的密码？对方当前登录会失效。`,
      confirmText: '确认重置',
      tone: 'danger',
    })) return
    setError(null)
    try {
      const result = await resetUserPassword(row.id)
      setTemporary({ name: row.username, password: result.temporary_password })
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重置失败')
    }
  }

  async function remove(row: ManagedUser) {
    if (!await confirmAction({
      title: '删除账号',
      message: `删除「${row.username}」？该账号的全部数据一并删除，不可恢复。`,
      confirmText: '确认删除',
      tone: 'danger',
    })) return
    setError(null)
    try {
      await deleteUser(row.id)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function copyTemporary() {
    if (!temporary) return
    try {
      await navigator.clipboard.writeText(temporary.password)
      toast('临时密码已复制')
    } catch {
      setError('复制失败，请手动选择密码')
    }
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="用户"
          description="停用、启用、重置密码或删除账号。看不到对方的聊天内容。"
          actions={
            <Button variant="primary" onClick={() => { setCreating((value) => !value); setNotice(null) }}>
              <IconPlus className="h-4 w-4" />
              新建账号
            </Button>
          }
        />

        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
        {notice && !temporary && <div className="mb-4"><Notice tone="success">{notice}</Notice></div>}

        {temporary && (
          <div className="mb-4 rounded-[12px] border border-warning/25 bg-warning-soft px-4 py-3.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-warning">
                  {temporary.name} 的临时密码
                </p>
                <p className="mono mt-1 select-all text-[16px] font-semibold leading-6 text-ink">
                  {temporary.password}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button size="sm" onClick={() => void copyTemporary()}>复制</Button>
                <Button size="sm" variant="ghost" onClick={() => setTemporary(null)}>知道了</Button>
              </div>
            </div>
            <p className="mt-1.5 text-[12px] text-warning">
              只显示这一次，刷新后无法再看到。
            </p>
          </div>
        )}

        {creating && (
          <div className="mb-4">
            <DataCard
              title="新建普通用户"
              description="管理员账号只能从这里创建，新建后对方首次登录必须改密码。"
            >
              <form onSubmit={add} className="grid gap-3.5 sm:grid-cols-3">
                <Field label="账号" value={username} onChange={(event) => setUsername(event.target.value)} required placeholder="字母、数字" autoComplete="off" />
                <Field label="昵称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required autoComplete="off" />
                <Field label="初始密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required hint="至少 10 位，含字母、数字和符号" autoComplete="new-password" />
                <div className="flex gap-2 sm:col-span-3">
                  <Button type="submit" variant="primary" loading={busy}>创建账号</Button>
                  <Button type="button" variant="ghost" onClick={() => setCreating(false)}>取消</Button>
                </div>
              </form>
            </DataCard>
          </div>
        )}

        <DataCard
          title="全部账号"
          description={rows.length > 0 ? `共 ${rows.length} 个账号` : undefined}
          bodyClassName="p-0"
        >
          {rows.length === 0 ? (
            <EmptyState title="还没有账号" description="新建一个普通用户，或让对方用邀请码注册。" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-hover"
                >
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-[13px] font-semibold ${
                      row.role === 'admin' ? 'bg-primary-soft text-primary' : 'bg-surface-sunken text-ink-secondary'
                    }`}
                    aria-hidden
                  >
                    {(row.display_name || row.username).slice(0, 1)}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-[14px] font-medium text-ink">
                        {row.display_name || row.username}
                      </span>
                      <StatusTag tone={row.role === 'admin' ? 'primary' : 'info'}>
                        {row.role === 'admin' ? '管理员' : '用户'}
                      </StatusTag>
                      <StatusTag tone={row.is_active ? 'success' : 'danger'}>
                        {row.is_active ? '正常' : '已停用'}
                      </StatusTag>
                    </div>
                    <p className="mt-1 truncate text-[13px] text-ink-muted">
                      <span className="mono">{row.username}</span>
                      {row.last_login_at
                        ? <> · 最近登录 <span className="tnum">{formatLocalMinute(row.last_login_at)}</span></>
                        : ' · 还没登录过'}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" onClick={() => void toggle(row)}>
                      {row.is_active ? '停用' : '启用'}
                    </Button>
                    <Button size="sm" onClick={() => void reset(row)}>重置密码</Button>
                    <Button size="sm" variant="danger" onClick={() => void remove(row)}>删除</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DataCard>
      </PageBody>
    </PageShell>
  )
}
