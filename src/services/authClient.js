const API_BASE = (import.meta.env.VITE_TELEGRAM_API_BASE_URL || '').replace(/\/$/, '')
const AUTH_PREFIX = `${API_BASE}/api/auth`

const REQUEST_TIMEOUT_MS = 30_000

function buildAuthUrl(path, query) {
  const url = new URL(`${AUTH_PREFIX}${path}`, window.location.origin)
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      url.searchParams.set(key, String(value))
    })
  }
  return url.toString()
}

function normalizeErrorPayload(payload, status = 0) {
  const code = String(payload?.error?.code || (status ? `HTTP_${status}` : 'REQUEST_FAILED'))
  const message = String(payload?.error?.message || code)
  const err = new Error(message)
  err.code = code
  err.status = status
  return err
}

async function fetchJson(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') || ''
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : null

    if (!response.ok || payload?.ok === false) {
      throw normalizeErrorPayload(payload, response.status)
    }

    return payload?.data
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timeoutErr = new Error('Auth request timed out')
      timeoutErr.code = 'REQUEST_TIMEOUT'
      timeoutErr.status = 504
      throw timeoutErr
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
  }
}

function buildReturnToWithLoginFlag() {
  const url = new URL(window.location.href)
  url.searchParams.set('openVoidLogin', '1')
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash || ''}`
}

export function getGoogleLoginStartUrl() {
  return buildAuthUrl('/google-start', {
    returnTo: buildReturnToWithLoginFlag(),
  })
}

export function getGoogleAvatarUrl(cacheKey = '') {
  return buildAuthUrl('/google-avatar', {
    t: cacheKey || Date.now(),
  })
}

export async function getAuthMe() {
  try {
    const data = await fetchJson(buildAuthUrl('/me'), { method: 'GET' })
    return {
      authenticated: Boolean(data?.authenticated),
      user: data?.user || null,
    }
  } catch {
    return {
      authenticated: false,
      user: null,
    }
  }
}

export async function logoutAppSession() {
  return fetchJson(buildAuthUrl('/logout'), { method: 'POST' })
}

export async function getAuthSessions() {
  return fetchJson(buildAuthUrl('/sessions'), { method: 'GET' })
}

export async function manageAuthSessions(action, payload = {}) {
  return fetchJson(buildAuthUrl('/sessions'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      action,
      ...(payload && typeof payload === 'object' ? payload : {}),
    }),
  })
}
