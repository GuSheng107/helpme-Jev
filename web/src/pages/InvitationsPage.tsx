import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { createInvitation, listInvitations, revokeInvitation, type Invitation } from '../api/admin'
import Button from '../components/Button'
import Field from '../components/Field'
import { toast } from '../components/toast'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

const STATUS: Record<Invitation['status'], string> = {
  active: '可用',
  revoked: '已作废',
  expired: '已过期',
  exhausted: '已用完',
}

/** 邀请码明文保存，可以反复复制。 */
export default function InvitationsPage() {
  const [rows, setRows] = useState<Invitation[]>([])
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try {
      setRows(await listInvitations())
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
      await createInvitation({ note, max_uses: Math.max(1, Number(maxUses) || 1) })
      setNote('')
      setMaxUses('1')
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  async function copy(row: Invitation) {
    try {
      await navigator.clipboard.writeText(row.code)
      toast('邀请码已复制')
    } catch {
      setError('复制失败，请手动选择邀请码')
    }
  }

  async function revoke(row: Invitation) {
    if (!window.confirm(`作废 ${row.code}？已发出去的链接将不能再注册。`)) return
    try {
      await revokeInvitation(row.id)
      await reload()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '作废失败')
    }
  }

  return (
    <PageShell>
      <PageBody>
        <PageHeader title="邀请码" description="邀请码以 JEV- 开头，生成后可以反复复制。" />
        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
        <div className="mb-4">
          <DataCard title="生成">
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
              <Field label="备注" value={note} onChange={(event) => setNote(event.target.value)} placeholder="发给谁，可不填" />
              <Field label="可用次数" type="number" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
              <Button type="submit" variant="primary" loading={busy}>生成</Button>
            </form>
          </DataCard>
        </div>
        <DataCard title="已生成">
          {rows.length === 0 ? (
            <EmptyState title="还没有邀请码" description="生成一个，复制给对方注册。" />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="mono text-[15px] font-medium text-ink">{row.code}</span>
                      <StatusTag tone={row.status === 'active' ? 'success' : 'info'}>{STATUS[row.status]}</StatusTag>
                    </div>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      已用 {row.used_count}/{row.max_uses}
                      {row.note ? ` · ${row.note}` : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void copy(row)}><CopyIcon />复制</Button>
                    {row.status === 'active' && (
                      <Button size="sm" variant="danger" onClick={() => void revoke(row)}>作废</Button>
                    )}
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

function CopyIcon() {
  return (
    <svg viewBox="0 0 20 20" className="mr-1 inline-block h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="6" y="6" width="10" height="11" rx="2" />
      <path d="M13 6V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" />
    </svg>
  )
}
