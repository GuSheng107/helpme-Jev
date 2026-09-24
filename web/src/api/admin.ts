import { api } from './client'

export interface ManagedUser {
  id: number
  username: string
  display_name: string
  role: 'admin' | 'user'
  is_active: boolean
  must_change_password: boolean
  created_at: string
  last_login_at: string
}

export interface Invitation {
  id: number
  code: string
  note: string
  max_uses: number
  used_count: number
  status: 'active' | 'revoked' | 'expired' | 'exhausted'
  created_at: string
}

export function listUsers() {
  return api.get<ManagedUser[]>('/api/admin/users')
}

export function createUser(body: { username: string; display_name: string; password: string }) {
  return api.post<ManagedUser>('/api/admin/users', body)
}

export function setUserActive(id: number, active: boolean) {
  return api.post<ManagedUser>(`/api/admin/users/${id}/active?active=${active}`, {})
}

export function resetUserPassword(id: number) {
  return api.post<ManagedUser & { temporary_password: string }>(`/api/admin/users/${id}/reset-password`, {})
}

export function deleteUser(id: number) {
  return api.delete<void>(`/api/admin/users/${id}`)
}

export function listInvitations() {
  return api.get<Invitation[]>('/api/admin/invitations')
}

export function createInvitation(body: { note: string; max_uses: number }) {
  return api.post<Invitation>('/api/admin/invitations', body)
}

export function revokeInvitation(id: number) {
  return api.post<Invitation>(`/api/admin/invitations/${id}/revoke`, {})
}
