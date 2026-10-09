import { useCallback, useEffect, useId, useState } from 'react'
import { ApiError } from '../api/client'
import { createInvitation, listInvitations, revokeInvitation, type Invitation } from '../api/admin'
import Button from '../components/Button'
import { confirmAction } from '../components/confirm'
import Field from '../components/Field'
import Modal from '../components/Modal'
import { toast } from '../components/toast'
import { DataCard, EmptyState, Notice, PageBody, PageHeader, PageShell, StatusTag } from '../components/layout'
import { IconCopy, IconPlus } from '../components/icons'

const STATUS: Record<Invitation['status'], string> = {
  active: '可用',
  revoked: '已作废',
  expired: '已过期',
  exhausted: '已用完',
}

const STATUS_TONE: Record<Invitation['status'], 'success' | 'info' | 'warning'> = {
  active: 'success',
  revoked: 'info',
  expired: 'warning',
  exhausted: 'warning',
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

  const activeCount = rows.filter((row) => row.status === 'active').length

  return (
    <PageShell>
      <PageBody>
        <PageHeader
          title="邀请码"
          description="邀请码以 JEV- 开头，生成后可以反复复制；作废后已发出的链接立即失效。"
          actions={
            <Button variant="primary" onClick={() => setCreating(true)}>
              <IconPlus className="h-4 w-4" />
              生成邀请码
            </Button>
          }
        />
        {error && <div className="mb-4"><Notice tone="danger">{error}</Notice></div>}

        <DataCard
          title="已生成"
          description={
            rows.length > 0 ? `共 ${rows.length} 个 · ${activeCount} 个可用` : undefined
          }
          bodyClassName="p-0"
        >
          {rows.length === 0 ? (
            <EmptyState
              title="还没有邀请码"
              description="生成一个，把邀请码发给对方，对方即可自助注册账号。"
              action={<Button size="sm" onClick={() => setCreating(true)}>生成邀请码</Button>}
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {rows.map((row) => {
                const ratio = row.max_uses > 0 ? Math.min(1, row.used_count / row.max_uses) : 0
                return (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center gap-3 px-5 py-3.5 transition-colors duration-150 hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono select-all rounded-[6px] bg-surface-sunken px-2 py-0.5 text-[14px] font-medium tracking-tight text-ink">
                          {row.code}
                        </span>
                        <StatusTag tone={STATUS_TONE[row.status]}>{STATUS[row.status]}</StatusTag>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-ink-muted">
                        <span className="flex items-center gap-1.5">
                          <span className="tnum">已用 {row.used_count}/{row.max_uses}</span>
                          <span className="h-1 w-14 overflow-hidden rounded-full bg-border-subtle">
                            <span
                              className={`block h-full rounded-full transition-[width] duration-500 ease-out ${
                                ratio >= 1 ? 'bg-warning' : 'bg-primary/70'
                              }`}
                              style={{ width: `${Math.round(ratio * 100)}%` }}
                            />
                          </span>
                        </span>
                        <span>{expiryLabel(row)}</span>
                        {row.note && <span className="truncate">备注：{row.note}</span>}
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" onClick={() => void copy(row)}>
                        <IconCopy className="h-3.5 w-3.5" />
                        复制
                      </Button>
                      {row.status === 'active' && (
                        <Button size="sm" variant="danger" onClick={() => void revoke(row)}>作废</Button>
                      )}
                    </div>
                  </li>
                )
              })}
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
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border-subtle px-5 py-4">
          <h3 id={titleId} className="text-[16px] font-semibold tracking-tight text-ink">生成邀请码</h3>
          <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={onClose} aria-label="关闭生成邀请码弹窗">关闭</Button>
        </header>
        <div className="space-y-3.5 px-5 py-5">
          <Field label="备注" value={note} onChange={(event) => setNote(event.target.value)} placeholder="发给谁，可不填" />
          <Field
            label="可用次数"
            type="number"
            min={1}
            value={maxUses}
            onChange={(event) => setMaxUses(event.target.value)}
            hint="最多 1000 次；用满后自动作废"
          />
          <Field
            label="截止日期"
            type="date"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            hint="不填视为永久有效"
          />
          {problem && <p className="text-[13px] leading-5 text-danger">{problem}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={incomplete} disabledReason="请填写可用次数">生成</Button>
        </footer>
      </form>
    </Modal>
  )
}
