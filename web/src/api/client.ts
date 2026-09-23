/** 后端 API 客户端：Bearer 鉴权、统一错误模型、401 自动登出。 */

const TOKEN_KEY = 'helpme-jev.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    /* localStorage 不可用时仅本次会话有效 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
}

export interface ApiErrorBody {
  code: string
  message: string
  trace_id?: string
  retryable?: boolean
}

export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly traceId?: string
  readonly retryable: boolean

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || '请求失败')
    this.name = 'ApiError'
    this.status = status
    this.code = body.code || 'UNKNOWN'
    this.traceId = body.trace_id
    this.retryable = Boolean(body.retryable)
  }
}

export const UNAUTHORIZED_EVENT = 'helpme-jev:unauthorized'

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** 401 时是否触发全局登出事件（登录/注册接口应设 false） */
  notifyUnauthorized?: boolean
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, notifyUnauthorized = true } = options

  const headers = new Headers()
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return undefined as T

  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const errorBody = (payload as { error?: ApiErrorBody } | null)?.error
    if (response.status === 401 && notifyUnauthorized) {
      clearToken()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(
      response.status,
      errorBody ?? { code: 'UNKNOWN', message: `请求失败（HTTP ${response.status}）` },
    )
  }

  return payload as T
}

/** multipart 上传（图片等二进制）。 */
export async function postForm<T>(path: string, form: FormData): Promise<T> {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, { method: 'POST', headers, body: form })
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!response.ok) {
    const errorBody = (payload as { error?: ApiErrorBody } | null)?.error
    if (response.status === 401) {
      clearToken()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(
      response.status,
      errorBody ?? { code: 'UNKNOWN', message: `上传失败（HTTP ${response.status}）` },
    )
  }
  return payload as T
}

/** 带鉴权取二进制（图片原图），供 <img> 用 objectURL 展示。 */
export async function fetchBlob(path: string): Promise<Blob> {
  const headers = new Headers()
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(path, { headers })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let errorBody: ApiErrorBody | undefined
    try {
      errorBody = (JSON.parse(text) as { error?: ApiErrorBody }).error
    } catch {
      /* 非 JSON 错误体 */
    }
    if (response.status === 401) {
      clearToken()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(
      response.status,
      errorBody ?? { code: 'UNKNOWN', message: `加载失败（HTTP ${response.status}）` },
    )
  }
  return response.blob()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, notifyUnauthorized = true) =>
    request<T>(path, { method: 'POST', body, notifyUnauthorized }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
