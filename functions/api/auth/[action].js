import {
  APP_SESSION_COOKIE_NAME,
  buildAppSessionCookie,
  buildClearedAppSessionCookie,
  buildClearedOAuthCookies,
  buildGoogleOAuthStartUrl,
  buildOAuthReturnToCookie,
  buildOAuthStateCookie,
  createAppSession,
  createOAuthState,
  getGoogleOAuthConfig,
  getGoogleRedirectUri,
  invalidateAppSession,
  parseCookies,
  readAuthenticatedUser,
  readOAuthCookies,
  toSafeReturnTo,
  upsertGoogleUser,
} from '../_lib/auth.js'
import { supabaseRequest } from '../_lib/supabase.js'

const textEncoder = new TextEncoder()

function json(payload, init = {}) {
  const headers = new Headers(init.headers || {})
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8')
  }

  return new Response(JSON.stringify(payload), {
    ...init,
    headers,
  })
}

function redirect(location, headers = new Headers()) {
  headers.set('location', location)
  return new Response(null, { status: 302, headers })
}

function appendQueryParam(path, key, value) {
  const url = new URL(path, 'https://internal.local')
  url.searchParams.set(key, value)
  const query = url.searchParams.toString()
  return `${url.pathname}${query ? `?${query}` : ''}${url.hash || ''}`
}

function toSafeText(value, fallback = '') {
  if (typeof value === 'string') return value
  return fallback
}

function toPositiveInt(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.floor(parsed)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

async function readJsonBody(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('application/json')) return {}
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

async function sha256Hex(value) {
  const encoded = textEncoder.encode(String(value || ''))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function readCurrentSessionTokenHash(request) {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = toSafeText(cookies[APP_SESSION_COOKIE_NAME]).trim()
  if (!token) return ''
  return sha256Hex(token)
}

function serializeSessionRecord(record, currentTokenHash, now) {
  const id = toPositiveInt(record?.id)
  const createdAt = toPositiveInt(record?.created_at)
  const expiresAt = toPositiveInt(record?.expires_at)
  const lastSeenAt = toPositiveInt(record?.last_seen_at)
  const tokenHash = toSafeText(record?.token_hash).trim()
  const userAgent = toSafeText(record?.user_agent)
  const lastIp = toSafeText(record?.last_ip)
  const isCurrent = Boolean(currentTokenHash && tokenHash && tokenHash === currentTokenHash)

  return {
    id,
    createdAt,
    expiresAt,
    lastSeenAt,
    userAgent,
    lastIp,
    isCurrent,
    status: expiresAt > now ? 'active' : 'expired',
  }
}

async function loadUserSessionsForGoogleUser(env, userId, currentTokenHash = '') {
  const rows = await supabaseRequest(env, 'app_sessions', {
    query: {
      select: 'id,token_hash,created_at,expires_at,last_seen_at,user_agent,last_ip',
      user_id: `eq.${userId}`,
      order: 'last_seen_at.desc',
      limit: 120,
    },
  })
  const now = Date.now()
  const mapped = Array.isArray(rows)
    ? rows
      .map(item => serializeSessionRecord(item, currentTokenHash, now))
      .filter(item => item.id > 0)
    : []

  return mapped.sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1
    if (!a.isCurrent && b.isCurrent) return 1
    return (b.lastSeenAt || 0) - (a.lastSeenAt || 0)
  })
}

async function readTelegramSessionBindingForGoogleUser(env, userId) {
  const rows = await supabaseRequest(env, 'telegram_sessions', {
    query: {
      select: 'session_encrypted,updated_at',
      user_id: `eq.${userId}`,
      limit: 1,
    },
  })
  const row = Array.isArray(rows) ? rows[0] : null
  const encrypted = toSafeText(row?.session_encrypted).trim()
  return {
    linked: Boolean(encrypted),
    updatedAt: toPositiveInt(row?.updated_at),
  }
}

async function buildSessionManagerPayload({ request, env, user, currentTokenHash = '' }) {
  const activeTokenHash = currentTokenHash || await readCurrentSessionTokenHash(request)
  const sessions = await loadUserSessionsForGoogleUser(env, user.id, activeTokenHash)
  const currentSession = sessions.find(item => item.isCurrent)
  const telegramSession = await readTelegramSessionBindingForGoogleUser(env, user.id)

  return {
    authenticated: true,
    googleUser: {
      id: user.id,
      googleSub: user.googleSub,
      email: user.email,
      name: user.name,
      picture: user.picture,
    },
    totalSessions: sessions.length,
    currentSessionId: currentSession?.id || null,
    sessions,
    telegramSession,
  }
}

async function exchangeGoogleCodeForAccessToken({ code, request, env }) {
  const { clientId, clientSecret } = getGoogleOAuthConfig(env)
  const redirectUri = getGoogleRedirectUri(request, env)
  const payload = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
  })

  const rawText = await response.text()
  let parsed = null
  try {
    parsed = JSON.parse(rawText)
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const message = parsed?.error_description || parsed?.error || rawText || 'Google token exchange failed'
    throw new Error(`GOOGLE_TOKEN_EXCHANGE_FAILED:${message}`)
  }

  const accessToken = String(parsed?.access_token || '').trim()
  if (!accessToken) {
    throw new Error('GOOGLE_TOKEN_EXCHANGE_FAILED:NO_ACCESS_TOKEN')
  }

  return accessToken
}

async function fetchGoogleUserProfile(accessToken) {
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    method: 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
  })

  const rawText = await response.text()
  let parsed = null
  try {
    parsed = JSON.parse(rawText)
  } catch {
    parsed = null
  }

  if (!response.ok || !parsed?.sub) {
    const message = parsed?.error_description || parsed?.error || rawText || 'Google userinfo failed'
    throw new Error(`GOOGLE_USERINFO_FAILED:${message}`)
  }

  return {
    sub: String(parsed.sub || '').trim(),
    email: String(parsed.email || '').trim(),
    name: String(parsed.name || '').trim(),
    picture: String(parsed.picture || '').trim(),
  }
}

function buildOAuthResultPath(returnTo, errorCode = '') {
  const base = toSafeReturnTo(returnTo, '/')
  if (!errorCode) return appendQueryParam(base, 'openVoidLogin', '1')

  let withFlag = appendQueryParam(base, 'openVoidLogin', '1')
  withFlag = appendQueryParam(withFlag, 'authError', errorCode)
  return withFlag
}

function validateOAuthState(requestState, cookieState) {
  const queryValue = String(requestState || '').trim()
  const cookieValue = String(cookieState || '').trim()
  if (!queryValue || !cookieValue) return false
  return queryValue === cookieValue
}

function isAllowedGoogleAvatarHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase()
  if (!host) return false
  return host === 'googleusercontent.com'
    || host.endsWith('.googleusercontent.com')
    || host === 'ggpht.com'
    || host.endsWith('.ggpht.com')
}

async function handleGoogleStart({ request, env }) {
  try {
    // Validate early to provide deterministic config errors.
    getGoogleOAuthConfig(env)
  } catch (err) {
    return json(
      {
        ok: false,
        error: {
          code: 'GOOGLE_OAUTH_CONFIG_MISSING',
          message: err?.message || 'Google OAuth is not configured',
        },
      },
      { status: 500 }
    )
  }

  const requestUrl = new URL(request.url)
  const requestedReturnTo = toSafeReturnTo(requestUrl.searchParams.get('returnTo'), '/')
  const state = createOAuthState()
  const { authUrl, returnTo } = buildGoogleOAuthStartUrl(request, env, state, requestedReturnTo)

  const headers = new Headers()
  headers.append('set-cookie', buildOAuthStateCookie(state))
  headers.append('set-cookie', buildOAuthReturnToCookie(returnTo))

  return redirect(authUrl, headers)
}

async function handleGoogleCallback({ request, env }) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const returnedState = requestUrl.searchParams.get('state')
  const oauthError = requestUrl.searchParams.get('error')
  const cookies = readOAuthCookies(request)
  const headers = new Headers()
  buildClearedOAuthCookies().forEach(cookie => headers.append('set-cookie', cookie))

  const returnTo = cookies.returnTo || '/'

  if (oauthError) {
    return redirect(buildOAuthResultPath(returnTo, 'google_denied'), headers)
  }

  if (!validateOAuthState(returnedState, cookies.state)) {
    return redirect(buildOAuthResultPath(returnTo, 'invalid_state'), headers)
  }

  if (!code) {
    return redirect(buildOAuthResultPath(returnTo, 'missing_code'), headers)
  }

  try {
    const accessToken = await exchangeGoogleCodeForAccessToken({ code, request, env })
    const profile = await fetchGoogleUserProfile(accessToken)
    const user = await upsertGoogleUser(env, profile)
    const { token } = await createAppSession(env, user.id, request)

    headers.append('set-cookie', buildAppSessionCookie(token))
    return redirect(buildOAuthResultPath(returnTo), headers)
  } catch (err) {
    console.error('[AUTH] Google callback failed:', err?.message || err)
    return redirect(buildOAuthResultPath(returnTo, 'callback_failed'), headers)
  }
}

async function handleMe({ request, env }) {
  const user = await readAuthenticatedUser(request, env)
  if (!user) {
    return json({ ok: true, data: { authenticated: false, user: null } }, { status: 200 })
  }

  return json(
    {
      ok: true,
      data: {
        authenticated: true,
        user: {
          id: user.id,
          googleSub: user.googleSub,
          email: user.email,
          name: user.name,
          picture: user.picture,
        },
      },
    },
    { status: 200 }
  )
}

async function handleLogout({ request, env }) {
  try {
    await invalidateAppSession(request, env)
  } catch (err) {
    console.warn('[AUTH] logout failed to delete session:', err?.message || err)
  }

  return json(
    { ok: true, data: { cleared: true } },
    {
      status: 200,
      headers: {
        'set-cookie': buildClearedAppSessionCookie(),
      },
    }
  )
}

async function handleGoogleAvatar({ request, env }) {
  const user = await readAuthenticatedUser(request, env)
  if (!user) {
    return json(
      {
        ok: false,
        error: { code: 'APP_AUTH_REQUIRED', message: 'Google authentication required' },
      },
      { status: 401 }
    )
  }

  const pictureUrl = String(user?.picture || '').trim()
  if (!pictureUrl) {
    return new Response(null, {
      status: 404,
      headers: {
        'cache-control': 'private, max-age=30',
        vary: 'Cookie',
      },
    })
  }

  let source
  try {
    source = new URL(pictureUrl)
  } catch {
    return new Response(null, {
      status: 404,
      headers: {
        'cache-control': 'private, max-age=30',
        vary: 'Cookie',
      },
    })
  }

  const protocol = String(source.protocol || '').toLowerCase()
  if ((protocol !== 'https:' && protocol !== 'http:') || !isAllowedGoogleAvatarHost(source.hostname)) {
    return json(
      {
        ok: false,
        error: { code: 'GOOGLE_AVATAR_URL_INVALID', message: 'Unsupported Google avatar URL' },
      },
      { status: 400 }
    )
  }

  let upstream
  try {
    upstream = await fetch(source.toString(), {
      method: 'GET',
      headers: {
        accept: 'image/*,*/*;q=0.8',
      },
    })
  } catch {
    return new Response(null, {
      status: 502,
      headers: {
        'cache-control': 'private, max-age=30',
        vary: 'Cookie',
      },
    })
  }

  if (!upstream.ok) {
    return new Response(null, {
      status: upstream.status === 404 ? 404 : 502,
      headers: {
        'cache-control': 'private, max-age=30',
        vary: 'Cookie',
      },
    })
  }

  const contentType = String(upstream.headers.get('content-type') || '').toLowerCase()
  if (!contentType.startsWith('image/')) {
    return new Response(null, {
      status: 415,
      headers: {
        'cache-control': 'private, max-age=30',
        vary: 'Cookie',
      },
    })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': contentType,
      'cache-control': 'private, max-age=600',
      vary: 'Cookie',
    },
  })
}

async function handleSessionsGet({ request, env }) {
  const user = await readAuthenticatedUser(request, env)
  if (!user) {
    return json(
      {
        ok: true,
        data: {
          authenticated: false,
          googleUser: null,
          totalSessions: 0,
          currentSessionId: null,
          sessions: [],
          telegramSession: { linked: false, updatedAt: 0 },
        },
      },
      { status: 200 }
    )
  }

  const data = await buildSessionManagerPayload({ request, env, user })
  return json({ ok: true, data }, { status: 200 })
}

async function handleSessionsManage({ request, env }) {
  const user = await readAuthenticatedUser(request, env)
  if (!user) {
    return json(
      {
        ok: false,
        error: { code: 'APP_AUTH_REQUIRED', message: 'Google authentication required' },
      },
      { status: 401 }
    )
  }

  const body = await readJsonBody(request)
  const action = toSafeText(body?.action).trim().toLowerCase()
  const now = Date.now()
  const headers = new Headers()
  let currentTokenHash = await readCurrentSessionTokenHash(request)

  const throwActionError = (code, message, status = 400) => {
    const err = new Error(message)
    err.code = code
    err.status = status
    throw err
  }

  if (!action) {
    throwActionError('ACTION_REQUIRED', 'Session action is required', 400)
  }

  if (action === 'create') {
    const { token } = await createAppSession(env, user.id, request)
    headers.append('set-cookie', buildAppSessionCookie(token))
    currentTokenHash = await sha256Hex(token)
  } else if (action === 'delete') {
    const sessionId = toPositiveInt(body?.sessionId || body?.id)
    if (!sessionId) {
      throwActionError('SESSION_ID_REQUIRED', 'sessionId is required', 400)
    }

    const rows = await supabaseRequest(env, 'app_sessions', {
      query: {
        select: 'id,token_hash',
        id: `eq.${sessionId}`,
        user_id: `eq.${user.id}`,
        limit: 1,
      },
    })
    const session = Array.isArray(rows) ? rows[0] : null
    if (!session?.id) {
      throwActionError('SESSION_NOT_FOUND', 'Session not found', 404)
    }

    const isDeletingCurrent = Boolean(currentTokenHash && toSafeText(session?.token_hash).trim() === currentTokenHash)
    await supabaseRequest(env, 'app_sessions', {
      method: 'DELETE',
      query: {
        id: `eq.${sessionId}`,
        user_id: `eq.${user.id}`,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
    if (isDeletingCurrent) {
      headers.append('set-cookie', buildClearedAppSessionCookie())
      currentTokenHash = ''
    }
  } else if (action === 'delete_all_except_current') {
    const query = { user_id: `eq.${user.id}` }
    if (currentTokenHash) {
      query.token_hash = `neq.${currentTokenHash}`
    }
    await supabaseRequest(env, 'app_sessions', {
      method: 'DELETE',
      query,
      headers: {
        Prefer: 'return=minimal',
      },
    })
  } else if (action === 'delete_expired') {
    await supabaseRequest(env, 'app_sessions', {
      method: 'DELETE',
      query: {
        user_id: `eq.${user.id}`,
        expires_at: `lt.${now}`,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
  } else if (action === 'extend') {
    const sessionId = toPositiveInt(body?.sessionId || body?.id)
    const requestedDays = clamp(toPositiveInt(body?.days || 30), 1, 180)
    if (!sessionId) {
      throwActionError('SESSION_ID_REQUIRED', 'sessionId is required', 400)
    }

    const nextExpiresAt = now + (requestedDays * 24 * 60 * 60 * 1000)
    await supabaseRequest(env, 'app_sessions', {
      method: 'PATCH',
      query: {
        id: `eq.${sessionId}`,
        user_id: `eq.${user.id}`,
      },
      body: {
        expires_at: nextExpiresAt,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
  } else if (action === 'unlink_telegram') {
    await supabaseRequest(env, 'telegram_sessions', {
      method: 'PATCH',
      query: {
        user_id: `eq.${user.id}`,
      },
      body: {
        session_encrypted: '',
        updated_at: now,
      },
      headers: {
        Prefer: 'return=minimal',
      },
    })
  } else {
    throwActionError('ACTION_INVALID', 'Unsupported session action', 400)
  }

  const data = await buildSessionManagerPayload({ request, env, user, currentTokenHash })
  return json({ ok: true, data }, { status: 200, headers })
}

function routeNotFound() {
  return json(
    {
      ok: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    },
    { status: 404 }
  )
}

export async function onRequest(context) {
  const { request, env, params } = context
  const method = request.method.toUpperCase()
  const action = String(params?.action || '')

  try {
    if (method === 'GET' && action === 'google-start') {
      return handleGoogleStart({ request, env })
    }

    if (method === 'GET' && action === 'google-callback') {
      return handleGoogleCallback({ request, env })
    }

    if (method === 'GET' && action === 'me') {
      return handleMe({ request, env })
    }

    if (method === 'POST' && action === 'logout') {
      return handleLogout({ request, env })
    }

    if (method === 'GET' && action === 'google-avatar') {
      return handleGoogleAvatar({ request, env })
    }

    if (method === 'GET' && action === 'sessions') {
      return handleSessionsGet({ request, env })
    }

    if (method === 'POST' && action === 'sessions') {
      return handleSessionsManage({ request, env })
    }

    return routeNotFound()
  } catch (err) {
    const code = String(err?.code || 'INTERNAL_ERROR')
    const message = String(err?.message || code)
    const status = Number(err?.status) || 500

    return json(
      {
        ok: false,
        error: { code, message },
      },
      { status }
    )
  }
}
