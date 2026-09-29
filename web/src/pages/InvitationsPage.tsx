import { useCallback, useEffect, useId, useState } from 'react'
import { ApiError } from '../api/client'
import { createInvitation, listInvitations, revokeInvitation, type Invitation } from '../api/admin'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import Field from '../components/Field'
import Modal from '../components/Modal'
import { toast } from '../components/toast'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'

const STATUS: Record<Invitation['status'], string> = {
  active: '可用',
  revoked: '已作废',
  expired: '已过期',
  exhausted: '已用完',
}

function expiryLabel(row: Invitation) {
  return row.expires_at ? `截止 ${row.expires_at.slice(0, 10)}` : '永久有效'
}

/** 邀请码明文保存，可以反复复制。 */
export default function InvitationsPage() {
  const [rows, setRows] = useState<Invitation[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

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

  async function copy(row: Invitation) {
    try {
      await navigator.clipboard.writeText(row.code)
      toast('邀请码已复制')
    } catch {
      setError('复制失败，请手动选择邀请码')
    }
  }

  async function revoke(row: Invitation) {
    if (!await confirmAction({
      title: '作废邀请码',
      message: `作废 ${row.code}？已发出去的链接将不能再注册。`,
      confirmText: '确认作废',
      tone: 'danger',
    })) return
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
        <PageHeader
          title="邀请码"
          description="邀请码以 JEV- 开头，生成后可以反复复制。"
          actions={<Button variant="primary" onClick={() => setCreating(true)}>生成邀请码</Button>}
        />
        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}
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
                      已用 {row.used_count}/{row.max_uses} · {expiryLabel(row)}
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
      {creating && (
        <CreateInvitationModal
          onClose={() => setCreating(false)}
          onCreated={async () => {
            setCreating(false)
            await reload()
          }}
          onError={setError}
        />
      )}
    </PageShell>
  )
}

function CreateInvitationModal({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void
  onCreated: () => Promise<void>
  onError: (message: string) => void
}) {
  const titleId = useId()
  const [note, setNote] = useState('')
  const [maxUses, setMaxUses] = useState('1')
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const maxUsesNumber = Math.max(1, Number(maxUses) || 1)
  const incomplete = maxUses.trim() === '' || Number(maxUses) < 1

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setProblem(null)
    try {
      await createInvitation({
        note,
        max_uses: maxUsesNumber,
        expires_at: expiresAt || null,
      })
      await onCreated()
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : '生成失败')
      setBusy(false)
    }
  }

  return (
    <Modal size="sm" scroll="hidden" onClose={onClose} busy={busy} labelledBy={titleId} initialFocusSelector="input" className="flex flex-col">
      <form onSubmit={submit} className="flex min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
          <h3 id={titleId} className="text-[17px] font-semibold text-ink">生成邀请码</h3>
          <Button size="sm" variant="text" type="button" disabled={busy} onClick={onClose} aria-label="关闭生成邀请码弹窗">关闭</Button>
        </header>
        <div className="space-y-3 px-4 py-4 sm:px-5">
          <Field label="备注" value={note} onChange={(event) => setNote(event.target.value)} placeholder="发给谁，可不填" />
          <Field
            label="可用次数"
            type="number"
            min={1}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            hint="最多 1000 次"
          />
          <Field
            label="截止日期"
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            hint="不填视为永久有效"
          />
          {problem && <p className="text-[12px] text-danger">{problem}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-4 py-3 sm:px-5">
          <Button type="button" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={incomplete} disabledReason="请填写可用次数">生成</Button>
        </footer>
      </form>
    </Modal>
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
