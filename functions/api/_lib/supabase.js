function toSafeText(value, fallback = '') {
  if (typeof value === 'string') return value
  return fallback
}

function readConfigText(value) {
  const raw = toSafeText(value).trim()
  if (!raw) return ''

  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith('\'') && raw.endsWith('\''))
  ) {
    return raw.slice(1, -1).trim()
  }

  return raw
}

export function getSupabaseConfig(env) {
  const url = readConfigText(env?.SUPABASE_URL)
  const serviceRoleKey = readConfigText(env?.SUPABASE_SERVICE_ROLE_KEY)

  if (!url || !serviceRoleKey) {
    const err = new Error('SUPABASE_CONFIG_MISSING')
    err.code = 'SUPABASE_CONFIG_MISSING'
    throw err
  }

  return { url, serviceRoleKey }
}

function buildSupabaseUrl(baseUrl, table, query = {}) {
  const normalizedTable = String(table || '').replace(/^\/+/, '')
  const url = new URL(`/rest/v1/${normalizedTable}`, baseUrl)

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    url.searchParams.set(key, String(value))
  })

  return url.toString()
}

function buildSupabaseHeaders(serviceRoleKey, options = {}) {
  const headers = new Headers(options.headers || {})
  headers.set('apikey', serviceRoleKey)
  headers.set('authorization', `Bearer ${serviceRoleKey}`)
  if (!headers.has('content-type') && options.includeJsonContentType !== false) {
    headers.set('content-type', 'application/json')
  }
  return headers
}

function safePreview(value, maxLength = 700) {
  const text = toSafeText(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.slice(0, maxLength)
}

export async function supabaseRequest(env, table, options = {}) {
  const { url, serviceRoleKey } = getSupabaseConfig(env)
  const {
    method = 'GET',
    query = {},
    body,
    headers: customHeaders,
    includeJsonContentType = true,
  } = options

  const endpoint = buildSupabaseUrl(url, table, query)
  const headers = buildSupabaseHeaders(serviceRoleKey, { headers: customHeaders, includeJsonContentType })

  const response = await fetch(endpoint, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => null)
    : null

  if (!response.ok) {
    const err = new Error(
      payload?.message
      || payload?.error_description
      || payload?.hint
      || safePreview(await response.text().catch(() => ''))
      || 'Supabase request failed'
    )
    err.code = payload?.code || 'SUPABASE_REQUEST_FAILED'
    err.status = response.status || 500
    err.details = payload || null
    throw err
  }

  return payload
}
