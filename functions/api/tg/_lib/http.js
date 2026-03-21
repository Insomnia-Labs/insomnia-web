const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
}

export function json(payload, init = {}) {
  const headers = new Headers(init.headers || {})
  Object.entries(JSON_HEADERS).forEach(([key, value]) => {
    if (!headers.has(key)) headers.set(key, value)
  })

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  })
}

export async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return {}

  try {
    return await request.json()
  } catch {
    return {}
  }
}

export function toBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const lowered = value.trim().toLowerCase()
    if (lowered === 'true') return true
    if (lowered === 'false') return false
  }
  return fallback
}

export function toInt(value, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.trunc(numeric)
}
