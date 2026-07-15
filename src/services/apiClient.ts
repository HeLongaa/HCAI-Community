import type { ApiEnvelope } from './contracts'

type RequestOptions = RequestInit & {
  token?: string | null
}

export class ApiClientError extends Error {
  code: string
  details?: unknown
  status: number

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export const isApiClientError = (error: unknown): error is ApiClientError => error instanceof ApiClientError

const defaultBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() || '/api'
const accessTokenKey = 'hcaiAccessToken'
const csrfTokenKey = 'hcaiCsrfToken'

const trimSlash = (value: string) => value.replace(/\/+$/, '')

const buildUrl = (path: string) => {
  const base = trimSlash(defaultBaseUrl)
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

export const withQuery = (path: string, query?: Record<string, string | number | boolean | null | undefined>) => {
  const params = new URLSearchParams()
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value))
    }
  })
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

export const getStoredAccessToken = () => {
  try {
    return localStorage.getItem(accessTokenKey)
  } catch {
    return null
  }
}

export const setStoredAccessToken = (token: string | null) => {
  try {
    if (token) {
      localStorage.setItem(accessTokenKey, token)
    } else {
      localStorage.removeItem(accessTokenKey)
    }
  } catch {
    return
  }
}

const getCookieValue = (name: string) => {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  const match = document.cookie
    .split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
  return match ? decodeURIComponent(match.slice(prefix.length)) : null
}

const isUnsafeMethod = (method?: string) => {
  const normalized = (method ?? 'GET').toUpperCase()
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS'
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as ApiEnvelope<T>
  if (!response.ok) {
    const error = payload?.error ?? { code: 'HTTP_ERROR', message: response.statusText }
    throw new ApiClientError(response.status, error.code, error.message, error.details)
  }
  return payload.data
}

async function request(path: string, options: RequestOptions = {}) {
  const headers = new Headers(options.headers)
  headers.set('accept', 'application/json')
  if (!headers.has('content-type') && options.body && !(options.body instanceof FormData)) {
    headers.set('content-type', 'application/json')
  }
  const token = options.token === undefined ? getStoredAccessToken() : options.token
  if (token) {
    headers.set('authorization', `Bearer ${token}`)
  }
  const csrfToken = getCookieValue(csrfTokenKey)
  if (csrfToken && isUnsafeMethod(options.method)) {
    headers.set('x-csrf-token', csrfToken)
  }
  return fetch(buildUrl(path), {
    credentials: 'include',
    ...options,
    headers,
  })
}

export const apiStream = (path: string, options: RequestOptions = {}) => request(path, options)

async function parseEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  const payload = (await response.json()) as ApiEnvelope<T>
  if (!response.ok) {
    const error = payload?.error ?? { code: 'HTTP_ERROR', message: response.statusText }
    throw new ApiClientError(response.status, error.code, error.message, error.details)
  }
  return payload
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options)
  return parseResponse<T>(response)
}

export async function apiEnvelope<T>(path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
  const response = await request(path, options)
  return parseEnvelope<T>(response)
}

export async function apiText(path: string, options: RequestOptions = {}): Promise<string> {
  const response = await request(path, options)
  if (!response.ok) {
    let message = response.statusText
    try {
      const payload = (await response.json()) as ApiEnvelope<unknown>
      message = payload?.error?.message ?? message
      throw new ApiClientError(response.status, payload?.error?.code ?? 'HTTP_ERROR', message, payload?.error?.details)
    } catch (error) {
      if (error instanceof ApiClientError) throw error
      throw new ApiClientError(response.status, 'HTTP_ERROR', message)
    }
  }
  return response.text()
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'GET' }),
  getEnvelope: <T>(path: string, options?: RequestOptions) => apiEnvelope<T>(path, { ...options, method: 'GET' }),
  text: (path: string, options?: RequestOptions) => apiText(path, { ...options, method: options?.method ?? 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, {
      ...options,
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, {
      ...options,
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(path, {
      ...options,
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  del: <T>(path: string, options?: RequestOptions) => apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
