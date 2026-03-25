import { Buffer } from 'node:buffer'
import { supabaseRequest } from './supabase.js'

export const APP_SESSION_COOKIE_NAME = 'app_session'
export const APP_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
export const GOOGLE_OAUTH_STATE_COOKIE_NAME = 'google_oauth_state'
export const GOOGLE_OAUTH_RETURN_TO_COOKIE_NAME = 'google_oauth_return_to'
export const GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS = 60 * 10

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

export function parseCookies(cookieHeader) {
  const result = {}
  if (!cookieHeader) return result

  cookieHeader
    .split(';')
    .map(part => part.trim())
    .filter(Boolean)
    .forEach(part => {
      const eqIndex = part.indexOf('=')
      if (eqIndex <= 0) return
      const key = part.slice(0, eqIndex).trim()
      const value = part.slice(eqIndex + 1).trim()

      let decoded = value
      try {
        decoded = decodeURIComponent(value)
      } catch {
        decoded = value
      }

      result[key] = decoded
    })

  return result
}

export function buildCookie(name, value, options = {}) {
  const safeName = String(name || '').trim()
  if (!safeName) return ''

  const encodedValue = encodeURIComponent(String(value || ''))
  const parts = [`${safeName}=${encodedValue}`]
  const maxAge = Number(options.maxAge)
  const path = toSafeText(options.path, '/')
  const sameSite = toSafeText(options.sameSite, 'Lax')
  const secure = options.secure !== false
  const httpOnly = options.httpOnly !== false

  if (Number.isFinite(maxAge) && maxAge >= 0) {
    parts.push(`Max-Age=${Math.trunc(maxAge)}`)
  }
  parts.push(`Path=${path || '/'}`)

  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  if (sameSite) parts.push(`SameSite=${sameSite}`)

  return parts.join('; ')
}

export function buildClearedCookie(name, options = {}) {
  return buildCookie(name, '', { ...options, maxAge: 0 })
}

function toBase64Url(bufferLike) {
  const base64 = Buffer.from(bufferLike).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function createRandomToken(bytes = 32) {
  const chunk = new Uint8Array(bytes)
  crypto.getRandomValues(chunk)
  return toBase64Url(chunk)
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Buffer.from(digest).toString('hex')
}

function sanitizeReturnTo(input, fallback = '/') {
  const raw = toSafeText(input, '').trim()
  if (!raw) return fallback
  if (!raw.startsWith('/')) return fallback
  if (raw.startsWith('//')) return fallback
  return raw
}

function trimForStorage(value, maxLength = 512) {
  const text = toSafeText(value).trim()
  if (!text) return ''
  return text.slice(0, maxLength)
}

function readRequestMetadata(request) {
  return {
    userAgent: trimForStorage(request.headers.get('user-agent') || '', 1024),
    ip: trimForStorage(
      request.headers.get('cf-connecting-ip')
      || request.headers.get('x-forwarded-for')
      || '',
      120
    ),
  }
}

export function getGoogleRedirectUri(request, env) {
  const explicit = readConfigText(env?.GOOGLE_REDIRECT_URI)
  if (explicit) return explicit

  const requestUrl = new URL(request.url)
  return `${requestUrl.origin}/api/auth/google-callback`
}

export function getGoogleOAuthConfig(env) {
  const clientId = readConfigText(env?.GOOGLE_CLIENT_ID)
  const clientSecret = readConfigText(env?.GOOGLE_CLIENT_SECRET)

  if (!clientId || !clientSecret) {
    const err = new Error('GOOGLE_OAUTH_CONFIG_MISSING')
    err.code = 'GOOGLE_OAUTH_CONFIG_MISSING'
    throw err
  }

  return { clientId, clientSecret }
}

export function buildGoogleOAuthStartUrl(request, env, state, returnTo) {
  const { clientId } = getGoogleOAuthConfig(env)
  const redirectUri = getGoogleRedirectUri(request, env)
  const normalizedReturnTo = sanitizeReturnTo(returnTo, '/')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'select_account')

  return {
    authUrl: url.toString(),
    returnTo: normalizedReturnTo,
  }
}

export function createOAuthState() {
  return createRandomToken(24)
}

export function buildOAuthStateCookie(state) {
  return buildCookie(GOOGLE_OAUTH_STATE_COOKIE_NAME, state, {
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
  })
}

export function buildOAuthReturnToCookie(returnTo) {
  return buildCookie(GOOGLE_OAUTH_RETURN_TO_COOKIE_NAME, sanitizeReturnTo(returnTo, '/'), {
    maxAge: GOOGLE_OAUTH_COOKIE_MAX_AGE_SECONDS,
  })
}

export function readOAuthCookies(request) {
  const cookies = parseCookies(request.headers.get('cookie'))
  return {
    state: toSafeText(cookies[GOOGLE_OAUTH_STATE_COOKIE_NAME]),
    returnTo: sanitizeReturnTo(cookies[GOOGLE_OAUTH_RETURN_TO_COOKIE_NAME], '/'),
  }
}

export function buildClearedOAuthCookies() {
  return [
    buildClearedCookie(GOOGLE_OAUTH_STATE_COOKIE_NAME),
    buildClearedCookie(GOOGLE_OAUTH_RETURN_TO_COOKIE_NAME),
  ]
}

export function buildAppSessionCookie(token) {
  return buildCookie(APP_SESSION_COOKIE_NAME, token, {
    maxAge: APP_SESSION_MAX_AGE_SECONDS,
  })
}

export function buildClearedAppSessionCookie() {
  return buildClearedCookie(APP_SESSION_COOKIE_NAME)
}

export async function createAppSession(env, userId, request) {
  const token = createRandomToken(32)
  const tokenHash = await sha256Hex(token)
  const now = Date.now()
  const expiresAt = now + APP_SESSION_MAX_AGE_SECONDS * 1000
  const { userAgent, ip } = readRequestMetadata(request)

  await supabaseRequest(env, 'app_sessions', {
    method: 'POST',
    body: {
      user_id: Number(userId),
      token_hash: tokenHash,
      created_at: now,
      expires_at: expiresAt,
      last_seen_at: now,
      user_agent: userAgent,
      last_ip: ip,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  })

  return { token, expiresAt }
}

export async function invalidateAppSession(request, env) {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = toSafeText(cookies[APP_SESSION_COOKIE_NAME])
  if (!token) return false

  const tokenHash = await sha256Hex(token)
  await supabaseRequest(env, 'app_sessions', {
    method: 'DELETE',
    query: {
      token_hash: `eq.${tokenHash}`,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  })

  return true
}

export async function readAuthenticatedUser(request, env) {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = toSafeText(cookies[APP_SESSION_COOKIE_NAME])
  if (!token) return null

  const tokenHash = await sha256Hex(token)
  const now = Date.now()

  const sessions = await supabaseRequest(env, 'app_sessions', {
    query: {
      select: 'user_id,expires_at',
      token_hash: `eq.${tokenHash}`,
      expires_at: `gt.${now}`,
      limit: 1,
    },
  })

  const session = Array.isArray(sessions) ? sessions[0] : null
  if (!session?.user_id) return null

  const users = await supabaseRequest(env, 'users', {
    query: {
      select: 'id,google_sub,email,name,picture',
      id: `eq.${session.user_id}`,
      limit: 1,
    },
  })

  const user = Array.isArray(users) ? users[0] : null
  if (!user?.id) return null

  const { userAgent, ip } = readRequestMetadata(request)
  await supabaseRequest(env, 'app_sessions', {
    method: 'PATCH',
    query: {
      token_hash: `eq.${tokenHash}`,
    },
    body: {
      last_seen_at: now,
      user_agent: userAgent,
      last_ip: ip,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  }).catch(() => {})

  return {
    id: Number(user.id),
    googleSub: toSafeText(user.google_sub),
    email: toSafeText(user.email),
    name: toSafeText(user.name),
    picture: toSafeText(user.picture),
    expiresAt: Number(session.expires_at) || 0,
  }
}

export async function upsertGoogleUser(env, profile) {
  const googleSub = trimForStorage(profile?.sub || profile?.googleSub || '', 255)
  if (!googleSub) {
    const err = new Error('GOOGLE_PROFILE_INVALID')
    err.code = 'GOOGLE_PROFILE_INVALID'
    throw err
  }

  const email = trimForStorage(profile?.email || '', 320)
  const name = trimForStorage(profile?.name || '', 320)
  const picture = trimForStorage(profile?.picture || '', 1024)
  const now = Date.now()

  const inserted = await supabaseRequest(env, 'users', {
    method: 'POST',
    query: {
      on_conflict: 'google_sub',
      select: 'id,google_sub,email,name,picture',
    },
    body: {
      google_sub: googleSub,
      email,
      name,
      picture,
      created_at: now,
      updated_at: now,
    },
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
  })

  const user = Array.isArray(inserted) ? inserted[0] : null
  if (!user?.id) {
    const err = new Error('GOOGLE_USER_UPSERT_FAILED')
    err.code = 'GOOGLE_USER_UPSERT_FAILED'
    throw err
  }

  return {
    id: Number(user.id),
    googleSub: toSafeText(user.google_sub),
    email: toSafeText(user.email),
    name: toSafeText(user.name),
    picture: toSafeText(user.picture),
  }
}

export function toSafeReturnTo(input, fallback = '/') {
  return sanitizeReturnTo(input, fallback)
}
