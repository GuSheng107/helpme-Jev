/** 认证相关接口与类型。 */

import { api } from './client'

export interface UserSummary {
  id: string
  username: string
  display_name: string
  role: 'admin' | 'user'
  must_change_password: boolean
  capabilities: string[]
  email?: string | null
}

export interface LoginResponse extends UserSummary {
  access_token: string
  token_type: string
}

export function login(username: string, password: string): Promise<LoginResponse> {
  // 登录接口本身返回 401 时不触发全局登出事件
  return api.post<LoginResponse>('/api/auth/login', { username, password }, false)
}

export function register(payload: {
  invitation_code: string
  username: string
  display_name: string
  password: string
  email?: string
}): Promise<UserSummary> {
  return api.post<UserSummary>('/api/auth/register', payload, false)
}

export function fetchMe(): Promise<UserSummary> {
  return api.get<UserSummary>('/api/auth/me')
}

export function logout(): Promise<void> {
  return api.post<void>('/api/auth/logout')
}

export function changePassword(oldPassword: string, newPassword: string): Promise<UserSummary> {
  return api.post<UserSummary>('/api/account/password', {
    old_password: oldPassword,
    new_password: newPassword,
  })
}
