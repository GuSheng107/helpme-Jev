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

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="用户"
          description="停用、启用、重置密码或删除账号。看不到对方的聊天内容。"
          actions={<Button variant="primary" onClick={() => setCreating((value) => !value)}>新建账号</Button>}
        />
        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
        {notice && <div className="mb-4"><Notice tone="info">{notice}</Notice></div>}
        {temporary && (
          <div className="mb-4">
            <Notice tone="warning">
              {temporary.name} 的临时密码：<span className="mono">{temporary.password}</span>。只显示这一次，请立刻复制给对方。
            </Notice>
          </div>
        )}
        {creating && (
          <div className="mb-4">
            <DataCard title="新建普通用户">
              <form onSubmit={add} className="grid gap-3 sm:grid-cols-3">
                <Field label="账号" value={username} onChange={(event) => setUsername(event.target.value)} required placeholder="字母、数字" />
                <Field label="昵称" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
                <Field label="初始密码" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required hint="至少 10 位，含字母、数字和符号" />
                <div className="flex gap-2 sm:col-span-3">
                  <Button type="submit" variant="primary" loading={busy}>创建</Button>
                  <Button type="button" onClick={() => setCreating(false)}>取消</Button>
                </div>
              </form>
            </DataCard>
          </div>
        )}
        <DataCard title="全部账号">
          {rows.length === 0 ? (
            <EmptyState title="还没有账号" description="新建一个普通用户，或让对方用邀请码注册。" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium text-ink">{row.display_name || row.username}</span>
                      <StatusTag tone={row.role === 'admin' ? 'primary' : 'info'}>{row.role === 'admin' ? '管理员' : '用户'}</StatusTag>
                      <StatusTag tone={row.is_active ? 'success' : 'danger'}>{row.is_active ? '正常' : '已停用'}</StatusTag>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      {row.username}
                      {row.last_login_at ? ` · 最近登录 ${formatLocalMinute(row.last_login_at)}` : ' · 还没登录过'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void toggle(row)}>{row.is_active ? '停用' : '启用'}</Button>
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
