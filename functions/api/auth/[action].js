import {
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
  readAuthenticatedUser,
  readOAuthCookies,
  toSafeReturnTo,
  upsertGoogleUser,
} from '../_lib/auth.js'

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
