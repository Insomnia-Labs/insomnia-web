import { extractStillFrameFromVideoWithWasm } from './videoThumbWasm.js'

/**
 * Server-backed Telegram client adapter.
 * Frontend calls Cloudflare Pages Functions (/api/tg/*);
 * Telegram API credentials stay only on the server.
 */

const API_BASE = (import.meta.env.VITE_TELEGRAM_API_BASE_URL || '').replace(/\/$/, '')
const API_PREFIX = `${API_BASE}/api/tg`

const REQUEST_TIMEOUT_MS = 30_000
const AUTH_REQUEST_TIMEOUT_MS = 70_000
const MEDIA_PREVIEW_REQUEST_TIMEOUT_MS = 10_000
const MEDIA_PREVIEW_FAST_TIMEOUT_MS = 7_500
const MEDIA_PREVIEW_ULTRAFAST_TIMEOUT_MS = 2_400
const MEDIA_PREVIEW_HIGH_TIMEOUT_MS = 30_000
const MEDIA_PREVIEW_VIDEO_FRAME_FAST_TIMEOUT_MS = 1_800
const MEDIA_PREVIEW_VIDEO_FRAME_ULTRAFAST_TIMEOUT_MS = 1_100
const MEDIA_PREVIEW_VIDEO_FRAME_TIMEOUT_MS = 2_800
const MEDIA_PREVIEW_VIDEO_WASM_FAST_TIMEOUT_MS = 4_000
const MEDIA_PREVIEW_VIDEO_WASM_TIMEOUT_MS = 8_500
const UPLOAD_THUMB_MAX_BYTES = 400 * 1024
const UPLOAD_THUMB_PROBE_BYTES = [5 * 1024 * 1024, 15 * 1024 * 1024]
const UPLOAD_THUMB_NATIVE_TIMEOUT_MS = 2_500
const UPLOAD_THUMB_WASM_TIMEOUT_MS = 4_500
const UPLOAD_THUMB_WASM_SECOND_TIMEOUT_MS = 7_000
const MESSAGE_POLL_INTERVAL_MS = 2_500
const PRESENCE_POLL_INTERVAL_MS = 12_000

const avatarCache = new Map()
const mediaPreviewCache = new Map()
/** chatId:messageId -> timestamp(ms) until which preview refetch is suppressed */
const mediaPreviewMissCache = new Map()
const messagePollers = new Map()
const presenceSubscribers = new Set()

let presenceTimerId = 0
let presenceTickInFlight = false
let presenceSnapshot = new Map()
const VIDEO_FILE_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv', 'flv',
  'ts', 'mts', 'm2ts', '3gp', '3g2', 'mpg', 'mpeg', 'mpe',
  'mpv', 'ogv', 'ogm', 'asf', 'vob', 'f4v', 'rm', 'rmvb',
])
const COMPLEX_VIDEO_EXTENSIONS = new Set([
  'mkv', 'avi', 'wmv', 'flv', 'ts', 'mts', 'm2ts', 'mpg',
  'mpeg', 'mpe', 'mpv', 'ogv', 'ogm', 'asf', 'vob', 'rm', 'rmvb',
])

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

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS, externalSignal = null) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  let externalListener = null
  if (externalSignal) {
    if (externalSignal.aborted) {
      window.clearTimeout(timeoutId)
      throw createError('REQUEST_CANCELLED', 'Upload cancelled', 0)
    }
    externalListener = () => controller.abort()
    externalSignal.addEventListener('abort', externalListener)
  }

  try {
    return await fetch(url, {
      ...options,
      credentials: 'include',
      signal: controller.signal,
    })
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (externalSignal?.aborted) {
        throw createError('REQUEST_CANCELLED', 'Upload cancelled', 0)
      }
      throw createError('REQUEST_TIMEOUT', 'Request timed out', 504)
    }
    throw err
  } finally {
    window.clearTimeout(timeoutId)
    if (externalSignal && externalListener) {
      externalSignal.removeEventListener('abort', externalListener)
    }
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

function shouldExtractUploadThumbFromVideoFile(file) {
  if (!file || typeof file.size !== 'number' || file.size <= 0) return false
  const mime = String(file.type || '').trim().toLowerCase()
  if (isLikelyVideoMime(mime)) return true
  const ext = getFileExtension(file.name)
  return VIDEO_FILE_EXTENSIONS.has(ext)
}

function isLikelyComplexVideoContainer(file) {
  if (!file) return false
  const mime = String(file.type || '').trim().toLowerCase()
  const ext = getFileExtension(file.name)
  return mime.includes('matroska')
    || mime.includes('msvideo')
    || mime.includes('x-ms-wmv')
    || mime.includes('x-flv')
    || mime.includes('mp2t')
    || COMPLEX_VIDEO_EXTENSIONS.has(ext)
}

function buildUploadProbeSizes(file) {
  const total = Number(file?.size) || 0
  if (total <= 0) return []
  const unique = new Set()
  UPLOAD_THUMB_PROBE_BYTES.forEach(limit => {
    const size = Math.max(0, Math.min(total, Number(limit) || 0))
    if (size > 0) unique.add(size)
  })
  return Array.from(unique)
}

function toUploadThumbFile(blob, fileName = 'thumb.jpg') {
  if (!(blob instanceof Blob) || blob.size <= 0 || blob.size > UPLOAD_THUMB_MAX_BYTES) return null
  return new File([blob], fileName, { type: 'image/jpeg' })
}

function getFileExtension(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return ''
  const idx = text.lastIndexOf('.')
  if (idx <= 0 || idx >= text.length - 1) return ''
  return text.slice(idx + 1).replace(/[^a-z0-9]/g, '')
}

function isLikelyVideoMime(value) {
  const mime = String(value || '').trim().toLowerCase()
  if (!mime) return false
  if (mime.startsWith('video/')) return true
  return mime.includes('matroska')
    || mime.includes('x-msvideo')
    || mime.includes('msvideo')
    || mime.includes('x-ms-wmv')
    || mime.includes('x-ms-asf')
    || mime.includes('quicktime')
    || mime.includes('x-flv')
    || mime.includes('3gpp')
    || mime.includes('3gpp2')
    || mime.includes('mp2t')
    || mime.includes('vnd.dlna.mpeg-tts')
    || mime.includes('video')
}

function guessVideoExtensionFromMime(value) {
  const mime = String(value || '').trim().toLowerCase()
  if (!mime) return 'bin'
  if (mime.includes('matroska')) return 'mkv'
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('quicktime')) return 'mov'
  if (mime.includes('x-msvideo') || mime.includes('msvideo')) return 'avi'
  if (mime.includes('x-ms-wmv')) return 'wmv'
  if (mime.includes('x-flv')) return 'flv'
  if (mime.includes('mp2t') || mime.includes('mpeg-tts')) return 'ts'
  if (mime.includes('3gpp2')) return '3g2'
  if (mime.includes('3gpp')) return '3gp'
  if (mime.includes('ogg')) return 'ogv'
  if (mime.includes('mpeg')) return 'mpeg'
  if (mime.includes('mp4')) return 'mp4'
  return 'bin'
}

async function detectMediaKindFromBlob(blob) {
  if (!(blob instanceof Blob) || blob.size <= 0) return ''
  try {
    const head = new Uint8Array(await blob.slice(0, Math.min(blob.size, 4096)).arrayBuffer())
    if (head.length < 12) return ''

    const b0 = head[0]
    const b1 = head[1]
    const b2 = head[2]
    const b3 = head[3]

    if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image'
    if (
      b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47
      && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
    ) return 'image'
    if (
      b0 === 0x47 && b1 === 0x49 && b2 === 0x46
      && (head[3] === 0x38 && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61)
    ) return 'image'
    if (
      b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
      && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
    ) return 'image'

    if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return 'video'
    if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) return 'video'
    if (
      b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
      && head[8] === 0x41 && head[9] === 0x56 && head[10] === 0x49 && head[11] === 0x20
    ) return 'video'
    if (b0 === 0x46 && b1 === 0x4c && b2 === 0x56) return 'video'
    if (head.length > 376 && head[0] === 0x47 && head[188] === 0x47) return 'video'
  } catch {
    return ''
  }
  return ''
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
  const asBlob = options?.asBlob === true

  const forcedMime = String(options.mimeType || '').trim().toLowerCase()
  let workBlob = blob
  if (forcedMime && (!blob.type || blob.type === 'application/octet-stream')) {
    try {
      workBlob = new Blob([await blob.arrayBuffer()], { type: forcedMime })
    } catch {
      workBlob = blob
    }
  }

  return await new Promise(resolve => {
    const video = document.createElement('video')
    const sourceUrl = URL.createObjectURL(workBlob)
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
          if (asBlob) {
            finish(nextBlob)
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
    video.preload = 'auto'
    video.crossOrigin = 'anonymous'

    const tryDrawOnce = () => {
      const width = Number(video.videoWidth) || 0
      const height = Number(video.videoHeight) || 0
      return width > 0 && height > 0
    }

    video.addEventListener('loadeddata', () => {
      if (tryDrawOnce()) {
        drawFrame()
        return
      }
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked)
        if (tryDrawOnce()) drawFrame()
        else finish(null)
      }
      video.addEventListener('seeked', onSeeked, { once: true })
      try {
        const d = Number(video.duration)
        const t = Number.isFinite(d) && d > 0 ? Math.min(0.12, d * 0.02) : 0.05
        video.currentTime = t
      } catch {
        finish(null)
      }
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
    signal = null,
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
    timeoutMs,
    signal instanceof AbortSignal ? signal : null
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
  mediaPreviewMissCache.clear()
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

  const signal = options.signal instanceof AbortSignal ? options.signal : null

  // Small JPEG thumb for Telegram.
  // Strategy: try fast native extraction first; for complex containers use WASM fallback with bounded probes.
  let thumbFile = null
  const isComplexContainer = isLikelyComplexVideoContainer(file)
  if (shouldExtractUploadThumbFromVideoFile(file)) {
    try {
      const thumbBlob = await extractStillFrameFromVideoBlob(file, {
        asBlob: true,
        mimeType: file.type || '',
        timeoutMs: isComplexContainer ? 1_200 : UPLOAD_THUMB_NATIVE_TIMEOUT_MS,
        maxEdge: 160,
        quality: 0.64,
      })
      thumbFile = toUploadThumbFile(thumbBlob, 'thumb.jpg')
    } catch {
      // optional
    }
  }
  if (!thumbFile && isComplexContainer) {
    const probeSizes = buildUploadProbeSizes(file)
    for (let i = 0; i < probeSizes.length; i += 1) {
      const probeSize = probeSizes[i]
      try {
        const probeBlob = file.slice(0, probeSize, file.type || 'application/octet-stream')
        const wasmBlob = await extractStillFrameFromVideoWithWasm(probeBlob, {
          fileName: file.name || 'upload.bin',
          mimeType: file.type || '',
          captureMs: 1_200,
          maxEdge: 160,
          quality: 0.64,
          timeoutMs: i === 0 ? UPLOAD_THUMB_WASM_TIMEOUT_MS : UPLOAD_THUMB_WASM_SECOND_TIMEOUT_MS,
        })
        thumbFile = toUploadThumbFile(wasmBlob, 'thumb.jpg')
        if (thumbFile) break
      } catch {
        // optional
      }
    }
  }

  const formData = new FormData()
  formData.set('chatId', String(chatId))
  formData.set('file', file)
  if (thumbFile) formData.set('thumb', thumbFile)
  formData.set('caption', typeof options.caption === 'string' ? options.caption : '')
  formData.set('silent', String(options.silent !== false))
  formData.set('forceDocument', String(options.forceDocument === true))
  formData.set('workers', String(Number.isFinite(options.workers) ? options.workers : 16))

  // Give at least 10 minutes, or 1 second per MB (whichever is larger).
  const fileSizeBytes = typeof file.size === 'number' ? file.size : 0
  const timeoutMs = Math.max(600_000, Math.ceil(fileSizeBytes / 1024))

  if (onProgress) {
    try { onProgress(0) } catch { /* noop */ }
  }

  // Fake progress that updates every 300ms using an asymptotic curve:
  //   progress += (0.92 - progress) * 0.005  each tick
  // This gives fast movement early on and slows naturally near 92%:
  //   ~7%  at  5s  |  ~37% at 30s  |  ~60% at 1min  |  ~86% at 5min
  // Decoupled from timeoutMs so updates are always responsive regardless
  // of how large the file is or how long the upload takes.
  let fakeProgressId = 0
  let fakeProgress = 0
  if (onProgress) {
    fakeProgressId = window.setInterval(() => {
      fakeProgress = fakeProgress + (0.92 - fakeProgress) * 0.005
      try { onProgress(fakeProgress) } catch { /* noop */ }
    }, 300)
  }

  let uploaded
  try {
    uploaded = await apiRequest('/send-file', {
      method: 'POST',
      formData,
      timeoutMs,
      signal,
    })
  } finally {
    if (fakeProgressId) window.clearInterval(fakeProgressId)
  }

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

function buildMediaPreviewCacheKey(chatId, messageId, mode = 'fast', variant = '') {
  const chat = String(chatId || '').trim()
  const msg = String(messageId || '').trim()
  const quality = String(mode || 'fast').trim().toLowerCase()
  const extra = String(variant || '').trim().toLowerCase()
  if (!chat || !msg) return ''
  return `${chat}:${msg}:${quality || 'fast'}:${extra || 'base'}`
}

export async function getMessageMediaPreview(chatId, messageId, options = {}) {
  const mode = String(options?.mode || 'fast').trim().toLowerCase() || 'fast'
  const allowWasm = options?.allowWasm !== false
  const allowEscalation = options?.allowEscalation !== false
  const escalationDepth = Number.isFinite(Number(options?.escalationDepth))
    ? Math.max(0, Number(options.escalationDepth))
    : 0
  const probeOffsetBytes = Number.isFinite(Number(options?.probeOffsetBytes))
    ? Math.max(0, Math.trunc(Number(options.probeOffsetBytes)))
    : 0
  const probeMaxBytes = Number.isFinite(Number(options?.probeMaxBytes))
    ? Math.max(0, Math.min(12 * 1024 * 1024, Math.trunc(Number(options.probeMaxBytes))))
    : 0
  const preferredCaptureMs = Number.isFinite(Number(options?.preferredCaptureMs))
    ? Math.max(0, Math.trunc(Number(options.preferredCaptureMs)))
    : 1_200
  const cacheVariant = (probeOffsetBytes > 0 || probeMaxBytes > 0)
    ? `o${probeOffsetBytes}b${probeMaxBytes}`
    : 'base'
  const cacheKey = buildMediaPreviewCacheKey(chatId, messageId, mode, cacheVariant)
  if (!cacheKey) {
    console.warn('[TG API] media preview skipped: invalid chatId/messageId', { chatId, messageId })
    return null
  }

  const missKey = `${String(chatId).trim()}:${String(messageId).trim()}:${mode}:${cacheVariant}`
  const missUntil = Number(mediaPreviewMissCache.get(missKey)) || 0
  if (missUntil > Date.now()) {
    return null
  }
  if (missUntil > 0) {
    mediaPreviewMissCache.delete(missKey)
  }

  if (mediaPreviewCache.has(cacheKey)) {
    return await mediaPreviewCache.get(cacheKey)
  }

  const pending = (async () => {
    try {
      const isHighQualityMode = mode === 'high' || mode === 'best' || mode === 'full'
      const requestTimeoutMs = mode === 'ultrafast'
        ? MEDIA_PREVIEW_ULTRAFAST_TIMEOUT_MS
        : (mode === 'fast'
          ? MEDIA_PREVIEW_FAST_TIMEOUT_MS
          : (isHighQualityMode ? MEDIA_PREVIEW_HIGH_TIMEOUT_MS : MEDIA_PREVIEW_REQUEST_TIMEOUT_MS))

      const response = await fetchWithTimeout(
        buildApiUrl('/media-preview', {
          chatId,
          messageId,
          mode,
          probeOffset: probeOffsetBytes > 0 ? probeOffsetBytes : undefined,
          probeBytes: probeMaxBytes > 0 ? probeMaxBytes : undefined,
        }),
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
        const normalizedCode = String(err?.code || '').trim().toUpperCase()
        const isTransientPreviewEmpty = normalizedCode === 'MEDIA_PREVIEW_EMPTY'

        // 404/415 are expected for unsupported messages (files without thumbnails, links, etc.).
        if ((response.status === 404 || response.status === 415) && !isTransientPreviewEmpty) {
          const missTtlMs = response.status === 415 ? 45_000 : 20_000
          mediaPreviewMissCache.set(missKey, Date.now() + missTtlMs)
          console.info('[TG API] media preview unavailable:', {
            code: err.code,
            status: err.status,
            chatId: String(chatId || ''),
            messageId: String(messageId || ''),
          })
          return null
        }

        if (
          isTransientPreviewEmpty
          && allowEscalation
          && escalationDepth < 2
          && (mode === 'fast' || mode === 'ultrafast')
        ) {
          try {
            const fallbackMode = mode === 'ultrafast' ? 'fast' : 'high'
            return await getMessageMediaPreview(chatId, messageId, {
              mode: fallbackMode,
              allowWasm,
              allowEscalation,
              escalationDepth: escalationDepth + 1,
              probeOffsetBytes,
              probeMaxBytes,
              preferredCaptureMs,
            })
          } catch {
            // keep error fallback below so Dashboard retry logic can continue
          }
        }

        if (
          isTransientPreviewEmpty
          && allowEscalation
          && escalationDepth < 3
          && mode === 'high'
          && probeOffsetBytes <= 0
        ) {
          const probePlan = [
            { offset: 0, bytes: 12 * 1024 * 1024, captureMs: 1_200 },
            { offset: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, captureMs: 800 },
            { offset: 8 * 1024 * 1024, bytes: 3 * 1024 * 1024, captureMs: 1_200 },
            { offset: 24 * 1024 * 1024, bytes: 4 * 1024 * 1024, captureMs: 1_600 },
          ]
          for (const probe of probePlan) {
            try {
              const probed = await getMessageMediaPreview(chatId, messageId, {
                mode: 'high',
                allowWasm: true,
                allowEscalation: false,
                escalationDepth: escalationDepth + 1,
                probeOffsetBytes: probe.offset,
                probeMaxBytes: probe.bytes,
                preferredCaptureMs: probe.captureMs,
              })
              if (probed?.url) return probed
            } catch {
              // continue with next probe
            }
          }
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
      let isImageContentType = contentType.startsWith('image/')
      let isVideoContentType = contentType.startsWith('video/')
      const isVideoSampleLike = previewSource === 'video-head-sample' || previewSource === 'video-probe-sample'

      const blob = await response.blob()
      if (!blob || blob.size === 0) {
        throw createError('MEDIA_PREVIEW_EMPTY_BLOB', 'Media preview response is empty', 502, {
          chatId: String(chatId || ''),
          messageId: String(messageId || ''),
        })
      }

      if (!isImageContentType && !isVideoContentType && !isVideoSampleLike) {
        const detectedKind = await detectMediaKindFromBlob(blob)
        if (detectedKind === 'image') {
          isImageContentType = true
        } else if (detectedKind === 'video') {
          isVideoContentType = true
        } else {
          throw createError('MEDIA_PREVIEW_NON_RENDERABLE_RESPONSE', `Expected image/* or video/* but got ${rawContentType || 'empty content-type'}`, 502, {
            contentType,
            chatId: String(chatId || ''),
            messageId: String(messageId || ''),
          })
        }
      }

      if (isVideoContentType || isVideoSampleLike) {
        const inferredVideoMime = isLikelyVideoMime(contentType) ? contentType : 'video/mp4'
        const isMatroska = inferredVideoMime.includes('matroska')
        const isWebm = inferredVideoMime.includes('webm')
        const isMp4Like = inferredVideoMime.includes('mp4') || inferredVideoMime.includes('quicktime')
        const allowNativeDecode = probeOffsetBytes <= 0
        if (allowNativeDecode) {
          const stillFrameUrl = await extractStillFrameFromVideoBlob(blob, {
            mimeType: inferredVideoMime,
            timeoutMs: mode === 'ultrafast'
              ? MEDIA_PREVIEW_VIDEO_FRAME_ULTRAFAST_TIMEOUT_MS
              : (mode === 'fast'
                ? (isMatroska
                  ? 1_900
                  : (isWebm || isMp4Like ? 2_600 : MEDIA_PREVIEW_VIDEO_FRAME_FAST_TIMEOUT_MS))
                : MEDIA_PREVIEW_VIDEO_FRAME_TIMEOUT_MS),
            maxEdge: mode === 'ultrafast' ? 220 : (mode === 'fast' ? 260 : 340),
            quality: mode === 'ultrafast' ? 0.58 : (mode === 'fast' ? 0.66 : 0.74),
          })

          if (stillFrameUrl) {
            return {
              url: stillFrameUrl,
              mimeType: 'image/jpeg',
            }
          }
        }

        if (allowWasm) {
          const wasmFrame = await extractStillFrameFromVideoWithWasm(blob, {
            mimeType: inferredVideoMime,
            fileName: `preview_${String(chatId || 'chat')}_${String(messageId || 'msg')}.${guessVideoExtensionFromMime(inferredVideoMime)}`,
            captureMs: preferredCaptureMs,
            maxEdge: mode === 'ultrafast' ? 220 : (mode === 'fast' ? 260 : 340),
            quality: mode === 'ultrafast' ? 0.58 : (mode === 'fast' ? 0.66 : 0.74),
            timeoutMs: mode === 'fast' || mode === 'ultrafast'
              ? MEDIA_PREVIEW_VIDEO_WASM_FAST_TIMEOUT_MS
              : MEDIA_PREVIEW_VIDEO_WASM_TIMEOUT_MS,
          })
          if (wasmFrame instanceof Blob && wasmFrame.size > 0) {
            return {
              url: URL.createObjectURL(wasmFrame),
              mimeType: 'image/jpeg',
            }
          }
        }

        console.info('[TG API] media preview video frame extraction unavailable, preview skipped', {
          chatId: String(chatId || ''),
          messageId: String(messageId || ''),
          mode,
          mimeType: inferredVideoMime,
          previewSource,
          size: blob.size,
          allowWasm,
          probeOffsetBytes,
          probeMaxBytes,
        })

        if (
          allowEscalation
          && escalationDepth < 2
          && (mode === 'fast' || mode === 'ultrafast')
          && previewSource === 'video-head-sample'
        ) {
          try {
            const fallbackMode = mode === 'ultrafast' ? 'fast' : 'high'
            return await getMessageMediaPreview(chatId, messageId, {
              mode: fallbackMode,
              allowWasm,
              allowEscalation,
              escalationDepth: escalationDepth + 1,
              probeOffsetBytes,
              probeMaxBytes,
              preferredCaptureMs,
            })
          } catch {
            // keep null fallback below
          }
        }

        if (
          allowEscalation
          && escalationDepth < 3
          && mode === 'high'
          && probeOffsetBytes <= 0
          && (previewSource === 'video-head-sample' || previewSource === 'video-probe-sample')
        ) {
          const probePlan = []
          if (isMp4Like || isWebm) {
            // For MP4/WebM, a larger contiguous head sample often helps with delayed keyframes/metadata layout.
            probePlan.push({ offset: 0, bytes: 12 * 1024 * 1024, captureMs: 1_200 })
          }
          probePlan.push(
            { offset: 2 * 1024 * 1024, bytes: 2 * 1024 * 1024, captureMs: 800 },
            { offset: 8 * 1024 * 1024, bytes: 3 * 1024 * 1024, captureMs: 1_200 },
            { offset: 24 * 1024 * 1024, bytes: 4 * 1024 * 1024, captureMs: 1_600 },
          )
          for (const probe of probePlan) {
            try {
              const probed = await getMessageMediaPreview(chatId, messageId, {
                mode: 'high',
                allowWasm: true,
                allowEscalation: false,
                escalationDepth: escalationDepth + 1,
                probeOffsetBytes: probe.offset,
                probeMaxBytes: probe.bytes,
                preferredCaptureMs: probe.captureMs,
              })
              if (probed?.url) return probed
            } catch {
              // continue with next probe
            }
          }
        }

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
