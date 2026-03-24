/**
 * Server-backed Telegram client adapter.
 * Frontend calls Cloudflare Pages Functions (/api/tg/*);
 * Telegram API credentials stay only on the server.
 */

const API_BASE = (import.meta.env.VITE_TELEGRAM_API_BASE_URL || '').replace(/\/$/, '')
const API_PREFIX = `${API_BASE}/api/tg`

const REQUEST_TIMEOUT_MS = 30_000
const AUTH_REQUEST_TIMEOUT_MS = 70_000
const MEDIA_PREVIEW_REQUEST_TIMEOUT_MS = 8_000
const MEDIA_PREVIEW_FAST_TIMEOUT_MS = 4_500
const MEDIA_PREVIEW_ULTRAFAST_TIMEOUT_MS = 2_400
const MEDIA_PREVIEW_VIDEO_FRAME_FAST_TIMEOUT_MS = 1_800
const MEDIA_PREVIEW_VIDEO_FRAME_ULTRAFAST_TIMEOUT_MS = 1_100
const MEDIA_PREVIEW_VIDEO_FRAME_TIMEOUT_MS = 2_800
const MESSAGE_POLL_INTERVAL_MS = 2_500
const PRESENCE_POLL_INTERVAL_MS = 12_000

const avatarCache = new Map()
const mediaPreviewCache = new Map()
const messagePollers = new Map()
const presenceSubscribers = new Set()

let presenceTimerId = 0
let presenceTickInFlight = false
let presenceSnapshot = new Map()

function buildApiUrl(path, query) {
  const url = new URL(`${API_PREFIX}${path}`, window.location.origin)
  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return
      url.searchParams.set(key, String(value))
    })
  }
  return url.toString()
}

function extractErrorCodeFromText(value) {
  const text = String(value || '').trim()
  if (!text) return ''

  const normalized = text.toUpperCase()
  const explicitHttpCode = normalized.match(/\bHTTP[_\s-]?(\d{3})\b/)
  if (explicitHttpCode?.[1]) return `HTTP_${explicitHttpCode[1]}`

  const cloudflareCode = normalized.match(/\bERROR CODE:\s*(\d{3,4})\b/)
  if (cloudflareCode?.[1]) return `CF_${cloudflareCode[1]}`

  const words = normalized.match(/[A-Z][A-Z0-9_]{2,}/g) || []
  const ignore = new Set(['ERROR', 'FAILED', 'REQUEST', 'INTERNAL', 'SERVER', 'STATUS', 'CODE'])
  return words.find(candidate => !ignore.has(candidate)) || ''
}

function createError(code, message, status, details = null) {
  const normalizedCode = String(code || '').trim().toUpperCase()
    || (Number.isInteger(status) && status > 0 ? `HTTP_${status}` : 'REQUEST_FAILED')
  const normalizedMessage = String(message || '').trim() || normalizedCode

  const err = new Error(normalizedMessage)
  err.code = normalizedCode
  err.status = status || 0
  err.details = details
  return err
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw createError('REQUEST_TIMEOUT', 'Request timed out', 504)
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
  }
}

async function readJsonSafely(response) {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return null
  try {
    return await response.clone().json()
  } catch {
    return null
  }
}

async function readTextSafely(response, maxLength = 700) {
  try {
    const text = await response.clone().text()
    if (!text) return ''
    const compact = text.replace(/\s+/g, ' ').trim()
    if (!compact) return ''
    return compact.slice(0, maxLength)
  } catch {
    return ''
  }
}

async function extractStillFrameFromVideoBlob(blob, options = {}) {
  if (!blob || typeof blob.size !== 'number' || blob.size <= 0) return null
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  if (typeof window.HTMLVideoElement === 'undefined') return null

  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : MEDIA_PREVIEW_VIDEO_FRAME_TIMEOUT_MS
  const targetMaxEdge = Number(options.maxEdge) > 0 ? Number(options.maxEdge) : 320
  const jpegQuality = Number.isFinite(Number(options.quality))
    ? Math.max(0.45, Math.min(0.95, Number(options.quality)))
    : 0.72

  return await new Promise(resolve => {
    const video = document.createElement('video')
    const sourceUrl = URL.createObjectURL(blob)
    let settled = false
    let timeoutId = 0

    const finish = (result = null) => {
      if (settled) return
      settled = true
      if (timeoutId) window.clearTimeout(timeoutId)
      try {
        video.pause()
      } catch {
        // noop
      }
      try {
        video.removeAttribute('src')
      } catch {
        // noop
      }
      try {
        video.load()
      } catch {
        // noop
      }
      try {
        URL.revokeObjectURL(sourceUrl)
      } catch {
        // noop
      }
      resolve(result)
    }

    const drawFrame = () => {
      try {
        const width = Number(video.videoWidth) || 0
        const height = Number(video.videoHeight) || 0
        if (width <= 0 || height <= 0) {
          finish(null)
          return
        }

        const maxEdge = Math.max(width, height)
        const scale = maxEdge > targetMaxEdge ? targetMaxEdge / maxEdge : 1
        const outputWidth = Math.max(1, Math.round(width * scale))
        const outputHeight = Math.max(1, Math.round(height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = outputWidth
        canvas.height = outputHeight

        const ctx = canvas.getContext('2d', { alpha: false })
        if (!ctx) {
          finish(null)
          return
        }

        ctx.drawImage(video, 0, 0, outputWidth, outputHeight)
        canvas.toBlob(nextBlob => {
          if (!nextBlob || nextBlob.size <= 0) {
            finish(null)
            return
          }
          try {
            finish(URL.createObjectURL(nextBlob))
          } catch {
            finish(null)
          }
        }, 'image/jpeg', jpegQuality)
      } catch {
        finish(null)
      }
    }

    timeoutId = window.setTimeout(() => finish(null), timeoutMs)

    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.crossOrigin = 'anonymous'

    video.addEventListener('loadeddata', () => {
      drawFrame()
    }, { once: true })
    video.addEventListener('error', () => {
      finish(null)
    }, { once: true })

    video.src = sourceUrl
    video.load()
  })
}

async function apiRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    formData,
    query,
    timeoutMs = REQUEST_TIMEOUT_MS,
  } = options

  const headers = new Headers(options.headers || {})
  let payloadBody = undefined

  if (formData) {
    payloadBody = formData
  } else if (body !== undefined) {
    headers.set('content-type', 'application/json')
    payloadBody = JSON.stringify(body)
  }

  const response = await fetchWithTimeout(
    buildApiUrl(path, query),
    {
      method,
      headers,
      body: payloadBody,
    },
    timeoutMs
  )

  const payload = await readJsonSafely(response)
  const fallbackText = payload ? '' : await readTextSafely(response)

  if (!response.ok || payload?.ok === false) {
    const code = payload?.error?.code
      || extractErrorCodeFromText(fallbackText)
      || `HTTP_${response.status}`
    const message = payload?.error?.message
      || fallbackText
      || response.statusText
      || 'Request failed'
    const details = payload?.error || (fallbackText ? { raw: fallbackText } : null)
    throw createError(code, message, response.status, details)
  }

  if (payload && Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return payload.data
  }

  return payload
}

function safeMessageId(message) {
  if (message?.id === undefined || message?.id === null) return null
  try {
    return message.id.toString()
  } catch {
    return null
  }
}

function toBigIntOrNull(value) {
  if (value === undefined || value === null) return null
  const stringValue = String(value)
  if (!/^-?\d+$/.test(stringValue)) return null
  try {
    return BigInt(stringValue)
  } catch {
    return null
  }
}

function compareMessageIds(a, b) {
  const aBig = toBigIntOrNull(a)
  const bBig = toBigIntOrNull(b)

  if (aBig !== null && bBig !== null) {
    if (aBig === bBig) return 0
    return aBig > bBig ? 1 : -1
  }

  const aStr = String(a || '')
  const bStr = String(b || '')
  if (aStr === bStr) return 0
  return aStr > bStr ? 1 : -1
}

function resetMessagePolling() {
  for (const poller of messagePollers.values()) {
    if (poller.timerId) window.clearInterval(poller.timerId)
    poller.callbacks.clear()
  }
  messagePollers.clear()
}

function resetPresencePolling() {
  if (presenceTimerId) {
    window.clearInterval(presenceTimerId)
    presenceTimerId = 0
  }
  presenceSubscribers.clear()
  presenceSnapshot = new Map()
  presenceTickInFlight = false
}

function resetCaches() {
  for (const cached of avatarCache.values()) {
    if (typeof cached === 'string') {
      try {
        URL.revokeObjectURL(cached)
      } catch {
        // noop
      }
    }
  }
  avatarCache.clear()

  for (const cached of mediaPreviewCache.values()) {
    if (typeof cached === 'string') {
      try {
        URL.revokeObjectURL(cached)
      } catch {
        // noop
      }
      continue
    }

    if (cached && typeof cached === 'object' && typeof cached.url === 'string') {
      try {
        URL.revokeObjectURL(cached.url)
      } catch {
        // noop
      }
    }
  }
  mediaPreviewCache.clear()
}

function getHighestMessageId(messages) {
  let maxId = null
  for (const message of messages) {
    const id = safeMessageId(message)
    if (!id) continue
    if (!maxId || compareMessageIds(id, maxId) > 0) maxId = id
  }
  return maxId
}

function ensureMessagePoller(chatId) {
  const key = String(chatId)
  if (messagePollers.has(key)) return messagePollers.get(key)

  const poller = {
    chatId: key,
    callbacks: new Set(),
    timerId: 0,
    started: false,
    running: false,
    lastSeenId: null,
  }

  const tick = async () => {
    if (poller.running || poller.callbacks.size === 0) return
    poller.running = true

    try {
      const history = await getChatHistory(poller.chatId, { limit: 20 })
      const list = Array.isArray(history) ? history : []
      const highestId = getHighestMessageId(list)

      if (!poller.started) {
        poller.lastSeenId = highestId
        poller.started = true
        return
      }

      if (!highestId || !poller.lastSeenId || compareMessageIds(highestId, poller.lastSeenId) <= 0) {
        if (highestId && (!poller.lastSeenId || compareMessageIds(highestId, poller.lastSeenId) > 0)) {
          poller.lastSeenId = highestId
        }
        return
      }

      const ordered = [...list].reverse()
      const nextMessages = []
      for (const item of ordered) {
        const msgId = safeMessageId(item)
        if (!msgId) continue
        if (!poller.lastSeenId || compareMessageIds(msgId, poller.lastSeenId) > 0) {
          nextMessages.push(item)
        }
      }

      if (nextMessages.length > 0) {
        poller.lastSeenId = highestId
        for (const message of nextMessages) {
          for (const callback of poller.callbacks) {
            try {
              callback(message)
            } catch {
              // isolate subscriber errors
            }
          }
        }
      }
    } catch (err) {
      console.warn('[TG API] message polling failed:', err)
    } finally {
      poller.running = false
    }
  }

  poller.timerId = window.setInterval(tick, MESSAGE_POLL_INTERVAL_MS)
  void tick()

  messagePollers.set(key, poller)
  return poller
}

async function tickPresence() {
  if (presenceTickInFlight || presenceSubscribers.size === 0) return
  presenceTickInFlight = true

  try {
    const dialogs = await getDialogs(300, 0)
    const nextSnapshot = new Map()

    for (const dialog of Array.isArray(dialogs) ? dialogs : []) {
      const userId = dialog?.entity?.id?.toString?.() || null
      const status = dialog?.entity?.status || null
      if (!userId || !status) continue
      nextSnapshot.set(userId, JSON.stringify(status))

      const prevSerialized = presenceSnapshot.get(userId)
      const nextSerialized = nextSnapshot.get(userId)
      if (prevSerialized === nextSerialized) continue

      const update = {
        userId,
        status,
      }

      for (const subscriber of presenceSubscribers) {
        try {
          subscriber(update)
        } catch {
          // noop
        }
      }
    }

    presenceSnapshot = nextSnapshot
  } catch (err) {
    console.warn('[TG API] presence polling failed:', err)
  } finally {
    presenceTickInFlight = false
  }
}

function ensurePresencePolling() {
  if (presenceTimerId) return
  presenceTimerId = window.setInterval(() => {
    void tickPresence()
  }, PRESENCE_POLL_INTERVAL_MS)
  void tickPresence()
}

export async function sendCode(phoneNumber) {
  return apiRequest('/send-code', {
    method: 'POST',
    body: { phoneNumber },
    timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
  })
}

export async function signIn(phoneNumber, phoneCode) {
  return apiRequest('/sign-in', {
    method: 'POST',
    body: { phoneNumber, phoneCode },
    timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
  })
}

export async function signInWith2FA(password) {
  return apiRequest('/sign-in-2fa', {
    method: 'POST',
    body: { password },
    timeoutMs: AUTH_REQUEST_TIMEOUT_MS,
  })
}

export async function isAuthorized() {
  try {
    const authorized = await apiRequest('/authorized')
    return Boolean(authorized)
  } catch {
    return false
  }
}

export async function getMe() {
  return apiRequest('/me')
}

export async function getDialogs(limit = 20, folder = undefined) {
  return apiRequest('/dialogs', {
    query: { limit, folder },
  })
}

export async function getChatHistory(chatId, options = {}) {
  return apiRequest('/history', {
    query: {
      chatId,
      limit: options.limit || 50,
      offsetId: options.offsetId || 0,
    },
  })
}

export async function subscribeToMessages(chatId, callback) {
  const poller = ensureMessagePoller(chatId)
  poller.callbacks.add(callback)

  return () => {
    poller.callbacks.delete(callback)
    if (poller.callbacks.size === 0) {
      if (poller.timerId) window.clearInterval(poller.timerId)
      messagePollers.delete(String(chatId))
    }
  }
}

export async function subscribeToPresence(callback) {
  presenceSubscribers.add(callback)
  ensurePresencePolling()

  return () => {
    presenceSubscribers.delete(callback)
    if (presenceSubscribers.size === 0) {
      resetPresencePolling()
    }
  }
}

export async function subscribeToTyping() {
  // Server-side transport intentionally avoids exposing realtime MTProto update streams to the browser.
  // Typing indicators can be added later through a dedicated push channel.
  return () => {}
}

export async function sendMessage(chatId, message) {
  return apiRequest('/send-message', {
    method: 'POST',
    body: { chatId, message },
  })
}

export async function sendFileToChat(chatId, file, options = {}) {
  if (!file) throw createError('NO_FILE_PROVIDED', 'No file provided', 400)

  const onProgress = typeof options.onProgress === 'function'
    ? options.onProgress
    : (typeof options.progressCallback === 'function' ? options.progressCallback : null)

  const formData = new FormData()
  formData.set('chatId', String(chatId))
  formData.set('file', file)
  formData.set('caption', typeof options.caption === 'string' ? options.caption : '')
  formData.set('silent', String(options.silent !== false))
  formData.set('forceDocument', String(options.forceDocument === true))
  formData.set('workers', String(Number.isFinite(options.workers) ? options.workers : 4))

  if (onProgress) {
    try { onProgress(0) } catch { /* noop */ }
  }

  const uploaded = await apiRequest('/send-file', {
    method: 'POST',
    formData,
    timeoutMs: 180_000,
  })

  if (onProgress) {
    try { onProgress(1) } catch { /* noop */ }
  }

  return uploaded
}

export async function getProfilePhoto(entity) {
  if (!entity) return null

  const key = entity?.id?.toString?.() || entity?.toString?.() || ''
  if (!key) return null

  if (avatarCache.has(key)) {
    return await avatarCache.get(key)
  }

  const pending = (async () => {
    try {
      const response = await fetchWithTimeout(
        buildApiUrl('/profile-photo', { entityId: key }),
        { method: 'GET' },
        REQUEST_TIMEOUT_MS
      )

      if (!response.ok) return null

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('image/')) return null

      const blob = await response.blob()
      if (!blob || blob.size === 0) return null

      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  })()

  avatarCache.set(key, pending)
  const resolved = await pending
  avatarCache.set(key, resolved)
  return resolved
}

function buildMediaPreviewCacheKey(chatId, messageId, mode = 'fast') {
  const chat = String(chatId || '').trim()
  const msg = String(messageId || '').trim()
  const quality = String(mode || 'fast').trim().toLowerCase()
  if (!chat || !msg) return ''
  return `${chat}:${msg}:${quality || 'fast'}`
}

export async function getMessageMediaPreview(chatId, messageId, options = {}) {
  const mode = String(options?.mode || 'fast').trim().toLowerCase() || 'fast'
  const cacheKey = buildMediaPreviewCacheKey(chatId, messageId, mode)
  if (!cacheKey) {
    console.warn('[TG API] media preview skipped: invalid chatId/messageId', { chatId, messageId })
    return null
  }

  if (mediaPreviewCache.has(cacheKey)) {
    return await mediaPreviewCache.get(cacheKey)
  }

  const pending = (async () => {
    try {
      const requestTimeoutMs = mode === 'ultrafast'
        ? MEDIA_PREVIEW_ULTRAFAST_TIMEOUT_MS
        : (mode === 'fast' ? MEDIA_PREVIEW_FAST_TIMEOUT_MS : MEDIA_PREVIEW_REQUEST_TIMEOUT_MS)

      const response = await fetchWithTimeout(
        buildApiUrl('/media-preview', { chatId, messageId, mode }),
        { method: 'GET' },
        requestTimeoutMs
      )

      if (!response.ok) {
        const payload = await readJsonSafely(response)
        const fallbackText = payload ? '' : await readTextSafely(response, 260)
        const code = payload?.error?.code
          || extractErrorCodeFromText(fallbackText)
          || `HTTP_${response.status}`
        const message = payload?.error?.message
          || fallbackText
          || response.statusText
          || 'Failed to fetch media preview'
        const err = createError(code, message, response.status, payload?.error || null)

        // 404/415 are expected for unsupported messages (files without thumbnails, links, etc.).
        if (response.status === 404 || response.status === 415) {
          console.info('[TG API] media preview unavailable:', {
            code: err.code,
            status: err.status,
            chatId: String(chatId || ''),
            messageId: String(messageId || ''),
          })
          return null
        }

        console.error('[TG API] media preview request failed:', {
          code: err.code,
          status: err.status,
          message: err.message,
          chatId: String(chatId || ''),
          messageId: String(messageId || ''),
        })
        throw err
      }

      const rawContentType = response.headers.get('content-type') || ''
      const contentType = rawContentType.split(';')[0].trim().toLowerCase()
      const previewSource = response.headers.get('x-tg-preview-source') || ''
      const isRenderableMedia = contentType.startsWith('image/') || contentType.startsWith('video/')
      if (!isRenderableMedia) {
        throw createError('MEDIA_PREVIEW_NON_RENDERABLE_RESPONSE', `Expected image/* or video/* but got ${rawContentType || 'empty content-type'}`, 502, {
          contentType,
          chatId: String(chatId || ''),
          messageId: String(messageId || ''),
        })
      }

      const blob = await response.blob()
      if (!blob || blob.size === 0) {
        throw createError('MEDIA_PREVIEW_EMPTY_BLOB', 'Media preview response is empty', 502, {
          chatId: String(chatId || ''),
          messageId: String(messageId || ''),
        })
      }

      if (contentType.startsWith('video/')) {
        const stillFrameUrl = await extractStillFrameFromVideoBlob(blob, {
          timeoutMs: mode === 'ultrafast'
            ? MEDIA_PREVIEW_VIDEO_FRAME_ULTRAFAST_TIMEOUT_MS
            : (mode === 'fast' ? MEDIA_PREVIEW_VIDEO_FRAME_FAST_TIMEOUT_MS : MEDIA_PREVIEW_VIDEO_FRAME_TIMEOUT_MS),
          maxEdge: mode === 'ultrafast' ? 220 : (mode === 'fast' ? 260 : 340),
          quality: mode === 'ultrafast' ? 0.58 : (mode === 'fast' ? 0.66 : 0.74),
        })

        if (stillFrameUrl) {
          return {
            url: stillFrameUrl,
            mimeType: 'image/jpeg',
          }
        }

        console.info('[TG API] media preview video frame extraction unavailable, preview skipped', {
          chatId: String(chatId || ''),
          messageId: String(messageId || ''),
          mimeType: contentType,
          previewSource,
          size: blob.size,
        })

        return null
      }

      return {
        url: URL.createObjectURL(blob),
        mimeType: contentType || 'application/octet-stream',
      }
    } catch (err) {
      const wrapped = err?.code ? err : createError('MEDIA_PREVIEW_FETCH_FAILED', String(err?.message || err || 'Failed to fetch media preview'), 500)
      console.warn('[TG API] media preview exception:', {
        code: wrapped.code,
        status: wrapped.status,
        message: wrapped.message,
        chatId: String(chatId || ''),
        messageId: String(messageId || ''),
      })
      throw wrapped
    }
  })()

  mediaPreviewCache.set(cacheKey, pending)
  try {
    const resolved = await pending
    if (resolved) {
      mediaPreviewCache.set(cacheKey, resolved)
    } else {
      // Do not freeze missing previews forever; allow future retries.
      mediaPreviewCache.delete(cacheKey)
    }
    return resolved
  } catch (err) {
    mediaPreviewCache.delete(cacheKey)
    throw err
  }
}

export async function getChatFolders() {
  return apiRequest('/chat-folders')
}

export function clearSession() {
  resetMessagePolling()
  resetPresencePolling()
  resetCaches()

  void apiRequest('/logout', { method: 'POST' }).catch(() => {
    // local session state is already cleared from the UI perspective
  })
}
