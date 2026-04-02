import { Buffer } from 'node:buffer'
import { Api, TelegramClient, password as TelegramPassword } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { CustomFile } from 'telegram/client/uploads.js'
import { ConnectionTCPObfuscated } from 'telegram/network/index.js'
import { PromisedWebSockets } from 'telegram/extensions/index.js'

const CONNECT_TIMEOUT_MS = 20_000
const REQUEST_TIMEOUT_MS = 30_000
const CONNECT_ATTEMPT_TIMEOUT_MS = 12_000
const WEB_DC_IDS = [1, 2, 3, 4, 5]
const CLIENT_CACHE_TTL_MS = 90_000
const CLIENT_CACHE_MAX_SIZE = 8

const TELEGRAM_CLIENT_CACHE = new Map()
const TELEGRAM_CLIENT_CACHE_PENDING = new Map()

const KNOWN_STATUS_CODES = new Map([
  ['APP_AUTH_REQUIRED', 401],
  ['SUPABASE_CONFIG_MISSING', 500],
  ['SUPABASE_REQUEST_FAILED', 500],
  ['TELEGRAM_CONFIG_MISSING', 500],
  ['SESSION_SECRET_MISSING', 500],
  ['TELEGRAM_CONNECT_TIMEOUT', 504],
  ['TELEGRAM_REQUEST_TIMEOUT', 504],
  ['TELEGRAM_SEND_CODE_TIMEOUT', 504],
  ['TELEGRAM_SIGN_IN_TIMEOUT', 504],
  ['TELEGRAM_2FA_FETCH_TIMEOUT', 504],
  ['TELEGRAM_2FA_CHECK_TIMEOUT', 504],
  ['PHONE_NUMBER_INVALID', 400],
  ['PHONE_CODE_INVALID', 401],
  ['PHONE_CODE_EXPIRED', 401],
  ['SESSION_PASSWORD_NEEDED', 401],
  ['PASSWORD_HASH_INVALID', 401],
  ['API_ID_INVALID', 500],
  ['API_HASH_INVALID', 500],
  ['AUTH_BYTES_INVALID', 401],
  ['AUTH_KEY_UNREGISTERED', 401],
  ['TWO_FA_SESSION_EXPIRED', 401],
  ['CALL_SEND_CODE_FIRST', 400],
  ['CHAT_ID_REQUIRED', 400],
  ['MESSAGE_ID_REQUIRED', 400],
  ['MESSAGE_REQUIRED', 400],
  ['MEDIA_PREVIEW_NOT_FOUND', 404],
  ['MEDIA_PREVIEW_UNSUPPORTED', 415],
  ['MEDIA_PREVIEW_EMPTY', 404],
  ['MEDIA_PREVIEW_FETCH_FAILED', 500],
  ['MEDIA_PREVIEW_FETCH_TIMEOUT', 504],
  ['NO_FILE_PROVIDED', 400],
  ['INVALID_REQUEST', 400],
])

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function withTimeout(promise, timeoutMs, code = 'TELEGRAM_REQUEST_TIMEOUT') {
  let timeoutId = 0
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(code)
      err.code = code
      reject(err)
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId)
  })
}

function toSafeInt(value, fallback = 0) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.trunc(numeric)
}

function toSafeId(value) {
  if (value === undefined || value === null) return null
  try {
    return value.toString()
  } catch {
    return null
  }
}

function toSafeText(value, fallback = '') {
  if (typeof value === 'string') return value
  return fallback
}

function readConfigText(value) {
  const raw = toSafeText(value).trim()
  if (!raw) return ''

  // Allow accidental quoting in .env/.dev.vars entries.
  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith('\'') && raw.endsWith('\''))
  ) {
    return raw.slice(1, -1).trim()
  }
  return raw
}

function getWebDcHost(dcId) {
  switch (Number(dcId)) {
    case 1: return 'pluto.web.telegram.org'
    case 2: return 'venus.web.telegram.org'
    case 3: return 'aurora.web.telegram.org'
    case 4: return 'vesta.web.telegram.org'
    case 5: return 'flora.web.telegram.org'
    default: return ''
  }
}

function normalizeDcId(value, fallback = 4) {
  const dcId = Number(value)
  if (!Number.isInteger(dcId) || dcId < 1 || dcId > 5) return fallback
  return dcId
}

function normalizeDcHost(value) {
  const host = toSafeText(value, '').trim().toLowerCase()
  if (!host || isIpv4Address(host) || host.includes(':')) return ''
  return host
}

function buildDcCandidates(session) {
  const preferredDcId = normalizeDcId(session?.dcId, 4)
  const sessionHost = normalizeDcHost(session?.serverAddress)
  const candidates = []
  const seenHosts = new Set()

  const pushCandidate = (dcId, host) => {
    const safeDcId = normalizeDcId(dcId, preferredDcId)
    const normalizedHost = normalizeDcHost(host)
    const resolvedHost = normalizedHost || getWebDcHost(safeDcId)
    if (!resolvedHost || seenHosts.has(resolvedHost)) return
    seenHosts.add(resolvedHost)
    candidates.push({
      dcId: safeDcId,
      host: resolvedHost,
      port: 443,
    })
  }

  pushCandidate(preferredDcId, sessionHost || getWebDcHost(preferredDcId))
  WEB_DC_IDS.forEach(dcId => pushCandidate(dcId, getWebDcHost(dcId)))
  return candidates.length ? candidates : [{ dcId: 4, host: getWebDcHost(4), port: 443 }]
}

function buildConnectAttemptTimeoutMs(totalCandidates) {
  const safeCount = Math.max(1, Number(totalCandidates) || 1)
  const perAttempt = Math.max(CONNECT_ATTEMPT_TIMEOUT_MS, Math.floor(CONNECT_TIMEOUT_MS / safeCount))
  return Math.min(CONNECT_TIMEOUT_MS, perAttempt)
}

function isRetryableConnectError(err) {
  const code = String(err?.code || '').toUpperCase()
  const message = String(err?.message || '').toUpperCase()
  if (code === 'TELEGRAM_CONNECT_TIMEOUT' || code === 'TELEGRAM_REQUEST_TIMEOUT') return true

  const text = `${code} ${message}`
  return (
    text.includes('TIMEOUT')
    || text.includes('ETIMEDOUT')
    || text.includes('ECONNRESET')
    || text.includes('ECONNREFUSED')
    || text.includes('ENETUNREACH')
    || text.includes('EHOSTUNREACH')
    || text.includes('ENOTFOUND')
    || text.includes('EAI_AGAIN')
    || text.includes('WEBSOCKET')
    || text.includes('SOCKET')
  )
}

function createTelegramClient(session, apiId, apiHash) {
  const client = new TelegramClient(session, apiId, apiHash, {
    connection: ConnectionTCPObfuscated,
    networkSocket: PromisedWebSockets,
    connectionRetries: 1,
    requestRetries: 2,
    downloadRetries: 1,
    autoReconnect: true,
    retryDelay: 500,
    maxConcurrentDownloads: 1,
    useWSS: true,
    useIPV6: false,
    receiveUpdates: false,
  })
  client.setLogLevel('error')

  const originalGetDC = client.getDC.bind(client)
  client.getDC = async (requestedDcId, downloadDC = false) => {
    return originalGetDC(requestedDcId, downloadDC, true)
  }
  return client
}

function isIpv4Address(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || ''))
}

function extractErrorCode(err) {
  const numericCode = Number(err?.code)

  const preferredCandidates = [
    err?.errorMessage,
    err?.message,
    err?.code,
  ]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
    .map(value => String(value).trim())

  for (const candidate of preferredCandidates) {
    // Skip plain numeric values like "401" here; we prefer symbolic Telegram error codes.
    if (/^\d+$/.test(candidate)) continue

    if (/^[A-Z][A-Z0-9_]{2,}$/.test(candidate)) return candidate

    const normalized = candidate.toUpperCase()
    const matches = normalized.match(/[A-Z][A-Z0-9_]{2,}/g)
    if (!matches?.length) continue

    const known = matches.find(item => KNOWN_STATUS_CODES.has(item))
    if (known) return known
  }

  if (Number.isInteger(numericCode) && numericCode >= 400 && numericCode <= 599) {
    return `HTTP_${numericCode}`
  }

  const candidates = [
    err?.code,
    err?.errorMessage,
    err?.message,
  ]
    .filter(Boolean)
    .map(value => String(value))

  for (const candidate of candidates) {
    if (/^[A-Z0-9_]+$/.test(candidate)) return candidate

    const normalized = candidate.toUpperCase()
    const matches = normalized.match(/[A-Z][A-Z0-9_]{2,}/g)
    if (!matches?.length) continue

    const code = matches.find(item => KNOWN_STATUS_CODES.has(item)) || matches[0]
    if (code) return code
  }

  return 'TELEGRAM_UNKNOWN_ERROR'
}

export class ApiError extends Error {
  constructor(code, status = 500, message = code, details = null) {
    super(message || code)
    this.name = 'ApiError'
    this.code = code || 'UNKNOWN_ERROR'
    this.status = status
    this.details = details
  }
}

export function toApiError(err) {
  if (err instanceof ApiError) return err

  const code = extractErrorCode(err)
  const numericHttpCode = /^HTTP_(\d{3})$/.exec(code)?.[1]
  const status = KNOWN_STATUS_CODES.get(code) || (numericHttpCode ? Number(numericHttpCode) : 500)
  const message = typeof err?.message === 'string' ? err.message : code
  const details = err?.stack ? String(err.stack).slice(0, 2000) : null
  const wrapped = new ApiError(code, status, message, details)

  if (typeof err?.tgSession === 'string') {
    wrapped.tgSession = err.tgSession
  }
  return wrapped
}

function getApiConfig(env) {
  const apiIdRaw = readConfigText(env?.TELEGRAM_API_ID) || readConfigText(env?.VITE_TELEGRAM_API_ID)
  const apiHash = readConfigText(env?.TELEGRAM_API_HASH) || readConfigText(env?.VITE_TELEGRAM_API_HASH)
  const apiId = Number(apiIdRaw)

  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash) {
    const hasTelegramApiId = Boolean(readConfigText(env?.TELEGRAM_API_ID))
    const hasTelegramApiHash = Boolean(readConfigText(env?.TELEGRAM_API_HASH))
    const hasLegacyViteApiId = Boolean(readConfigText(env?.VITE_TELEGRAM_API_ID))
    const hasLegacyViteApiHash = Boolean(readConfigText(env?.VITE_TELEGRAM_API_HASH))

    throw new ApiError(
      'TELEGRAM_CONFIG_MISSING',
      500,
      `Telegram API credentials are missing (TELEGRAM_API_ID=${hasTelegramApiId}, TELEGRAM_API_HASH=${hasTelegramApiHash}, VITE_TELEGRAM_API_ID=${hasLegacyViteApiId}, VITE_TELEGRAM_API_HASH=${hasLegacyViteApiHash})`
    )
  }
  return { apiId, apiHash }
}

async function safeDisconnect(client) {
  try {
    if (client?.connected) {
      await client.disconnect()
      return
    }
    await client?.disconnect?.()
  } catch {
    // noop
  }
}

function normalizeSessionString(sessionString) {
  return typeof sessionString === 'string' ? sessionString.trim() : String(sessionString || '').trim()
}

function hashTextFast(input) {
  let hash = 2166136261 >>> 0
  const text = String(input || '')
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

function buildClientCacheKey(options, sessionString, apiId) {
  const explicit = toSafeText(options?.cacheKey, '').trim()
  if (explicit) return `user:${explicit}`
  const normalizedSession = normalizeSessionString(sessionString)
  if (!normalizedSession) return ''
  return `session:${apiId}:${hashTextFast(normalizedSession)}`
}

function isSessionStateInvalidError(err) {
  const text = `${String(err?.code || '').toUpperCase()} ${String(err?.message || '').toUpperCase()}`
  return text.includes('AUTH_KEY_UNREGISTERED')
    || text.includes('AUTH_BYTES_INVALID')
    || text.includes('SESSION_REVOKED')
    || text.includes('SESSION_EXPIRED')
    || text.includes('TELEGRAM_SESSION_NOT_LINKED')
    || text.includes('USER_DEACTIVATED')
    || text.includes('USER_DEACTIVATED_BAN')
}

function wrapTelegramClientError(err, client) {
  const wrapped = err instanceof Error ? err : new Error(String(err || 'UNKNOWN_ERROR'))
  try {
    wrapped.tgSession = client?.session?.save?.() || ''
  } catch {
    wrapped.tgSession = ''
  }
  return wrapped
}

async function evictCachedClientByKey(cacheKey) {
  if (!cacheKey) return
  const entry = TELEGRAM_CLIENT_CACHE.get(cacheKey)
  if (!entry) return
  TELEGRAM_CLIENT_CACHE.delete(cacheKey)
  await safeDisconnect(entry.client)
}

async function sweepCachedClients() {
  const now = Date.now()
  const staleKeys = []

  for (const [key, entry] of TELEGRAM_CLIENT_CACHE.entries()) {
    const lastUsedAt = Number(entry?.lastUsedAt || 0)
    if (!lastUsedAt || (now - lastUsedAt) > CLIENT_CACHE_TTL_MS) {
      staleKeys.push(key)
    }
  }

  for (const key of staleKeys) {
    await evictCachedClientByKey(key)
  }

  if (TELEGRAM_CLIENT_CACHE.size <= CLIENT_CACHE_MAX_SIZE) return

  const sorted = Array.from(TELEGRAM_CLIENT_CACHE.entries())
    .sort((a, b) => Number(a[1]?.lastUsedAt || 0) - Number(b[1]?.lastUsedAt || 0))
  const overflow = TELEGRAM_CLIENT_CACHE.size - CLIENT_CACHE_MAX_SIZE
  for (let index = 0; index < overflow; index += 1) {
    const [key] = sorted[index] || []
    if (key) {
      await evictCachedClientByKey(key)
    }
  }
}

async function connectFreshClient(sessionString, apiId, apiHash) {
  const initialSession = new StringSession(sessionString || '')
  const candidates = buildDcCandidates(initialSession)
  const attemptTimeoutMs = buildConnectAttemptTimeoutMs(candidates.length)
  const connectErrors = []

  for (const candidate of candidates) {
    const session = new StringSession(sessionString || '')
    session.setDC(candidate.dcId, candidate.host, candidate.port)

    const client = createTelegramClient(session, apiId, apiHash)
    let hasConnected = false

    try {
      await withTimeout(client.connect(), attemptTimeoutMs, 'TELEGRAM_CONNECT_TIMEOUT')
      hasConnected = true
      return { client }
    } catch (err) {
      const wrapped = wrapTelegramClientError(err, client)
      if (!hasConnected && isRetryableConnectError(wrapped)) {
        connectErrors.push({
          dcId: candidate.dcId,
          host: candidate.host,
          message: String(wrapped.message || wrapped.code || 'connect failed').slice(0, 160),
        })
        continue
      }
      throw wrapped
    } finally {
      if (!hasConnected) {
        await safeDisconnect(client)
      }
    }
  }

  throw new ApiError(
    'TELEGRAM_CONNECT_TIMEOUT',
    504,
    'TELEGRAM_CONNECT_TIMEOUT',
    connectErrors
  )
}

async function getOrCreateCachedClient(cacheKey, sessionString, apiId, apiHash) {
  const normalizedSession = normalizeSessionString(sessionString)
  if (!cacheKey || !normalizedSession) return null

  const existing = TELEGRAM_CLIENT_CACHE.get(cacheKey)
  if (existing) {
    const sameSession = existing.sessionString === normalizedSession
    const sameConfig = existing.apiId === apiId && existing.apiHash === apiHash
    if (sameSession && sameConfig) {
      existing.lastUsedAt = Date.now()
      return existing
    }
    await evictCachedClientByKey(cacheKey)
  }

  const pending = TELEGRAM_CLIENT_CACHE_PENDING.get(cacheKey)
  if (pending) {
    const entry = await pending
    entry.lastUsedAt = Date.now()
    return entry
  }

  const createPromise = (async () => {
    const { client } = await connectFreshClient(normalizedSession, apiId, apiHash)
    const entry = {
      client,
      sessionString: normalizedSession,
      apiId,
      apiHash,
      lastUsedAt: Date.now(),
    }
    TELEGRAM_CLIENT_CACHE.set(cacheKey, entry)
    return entry
  })()

  TELEGRAM_CLIENT_CACHE_PENDING.set(cacheKey, createPromise)
  try {
    const entry = await createPromise
    return entry
  } finally {
    TELEGRAM_CLIENT_CACHE_PENDING.delete(cacheKey)
  }
}

function updateCachedEntrySession(cacheKey, entry, nextSession) {
  if (!cacheKey || !entry) return
  const normalizedNextSession = normalizeSessionString(nextSession)
  entry.sessionString = normalizedNextSession
  entry.lastUsedAt = Date.now()
}

export async function runWithTelegramClient(env, sessionString, fn, options = {}) {
  const { apiId, apiHash } = getApiConfig(env)
  const normalizedSession = normalizeSessionString(sessionString)
  const cacheKey = buildClientCacheKey(options, normalizedSession, apiId)
  await sweepCachedClients()

  if (cacheKey && normalizedSession) {
    const entry = await getOrCreateCachedClient(cacheKey, normalizedSession, apiId, apiHash)
    if (entry?.client) {
      try {
        const result = await fn({ client: entry.client, apiId, apiHash })
        const nextSession = entry.client.session.save()
        updateCachedEntrySession(cacheKey, entry, nextSession)
        if (!normalizeSessionString(nextSession)) {
          await evictCachedClientByKey(cacheKey)
        }
        return { result, nextSession }
      } catch (err) {
        const wrapped = wrapTelegramClientError(err, entry.client)
        if (isSessionStateInvalidError(wrapped)) {
          await evictCachedClientByKey(cacheKey)
        } else {
          entry.lastUsedAt = Date.now()
        }
        throw wrapped
      }
    }
  }

  const { client } = await connectFreshClient(normalizedSession, apiId, apiHash)
  try {
    const result = await fn({ client, apiId, apiHash })
    const nextSession = client.session.save()
    return { result, nextSession }
  } catch (err) {
    throw wrapTelegramClientError(err, client)
  } finally {
    await safeDisconnect(client)
  }
}

export async function sendCodeWithClient(client, apiId, apiHash, phoneNumber) {
  const result = await withTimeout(
    client.invoke(
      new Api.auth.SendCode({
        phoneNumber,
        apiId,
        apiHash,
        settings: new Api.CodeSettings({}),
      })
    ),
    REQUEST_TIMEOUT_MS,
    'TELEGRAM_SEND_CODE_TIMEOUT'
  )
  return { phoneCodeHash: result.phoneCodeHash }
}

export async function signInWithCode(client, phoneNumber, phoneCodeHash, phoneCode) {
  return withTimeout(
    client.invoke(
      new Api.auth.SignIn({
        phoneNumber,
        phoneCodeHash,
        phoneCode,
      })
    ),
    REQUEST_TIMEOUT_MS,
    'TELEGRAM_SIGN_IN_TIMEOUT'
  )
}

function normalizePassword(value) {
  if (typeof value === 'string') return value.normalize('NFKC')
  return String(value ?? '').normalize('NFKC')
}

function isAuthKeyUnregisteredError(err) {
  const message = String(err?.message || '').toUpperCase()
  return message.includes('AUTH_KEY_UNREGISTERED')
}

export async function signInWithPassword(client, password, apiId, apiHash) {
  const normalizedPassword = normalizePassword(password)
  if (!normalizedPassword.trim()) {
    throw new ApiError('CLOUD_PASSWORD_REQUIRED', 400, 'Cloud password is required')
  }

  const runSrpCheck = async () => {
    const passwordInfo = await withTimeout(
      client.invoke(new Api.account.GetPassword()),
      REQUEST_TIMEOUT_MS,
      'TELEGRAM_2FA_FETCH_TIMEOUT'
    )

    const srpCheck = await TelegramPassword.computeCheck(passwordInfo, normalizedPassword)
    let srpIdSafe = srpCheck?.srpId
    if (typeof srpIdSafe === 'string') {
      srpIdSafe = BigInt(srpIdSafe)
    } else if (typeof srpIdSafe === 'number') {
      srpIdSafe = BigInt(Math.trunc(srpIdSafe))
    } else if (typeof srpIdSafe !== 'bigint' && srpIdSafe?.toString) {
      srpIdSafe = BigInt(srpIdSafe.toString())
    }

    const aBytes = Buffer.isBuffer(srpCheck?.A) ? srpCheck.A : Buffer.from(srpCheck?.A || [])
    const m1Bytes = Buffer.isBuffer(srpCheck?.M1) ? srpCheck.M1 : Buffer.from(srpCheck?.M1 || [])

    return withTimeout(
      client.invoke(
        new Api.auth.CheckPassword({
          password: new Api.InputCheckPasswordSRP({
            srpId: srpIdSafe,
            A: aBytes,
            M1: m1Bytes,
          }),
        })
      ),
      REQUEST_TIMEOUT_MS,
      'TELEGRAM_2FA_CHECK_TIMEOUT'
    )
  }

  const runBuiltInCheck = async () => {
    const user = await withTimeout(
      client.signInWithPassword(
        { apiId, apiHash },
        {
          password: async () => normalizedPassword,
          onError: async (err) => {
            throw err
          },
        }
      ),
      REQUEST_TIMEOUT_MS,
      'TELEGRAM_2FA_CHECK_TIMEOUT'
    )
    return { user }
  }

  let attemptsLeft = 2
  while (attemptsLeft > 0) {
    try {
      try {
        return await runSrpCheck()
      } catch {
        return await runBuiltInCheck()
      }
    } catch (err) {
      attemptsLeft -= 1
      if (isAuthKeyUnregisteredError(err) && attemptsLeft > 0) {
        await delay(150)
        continue
      }
      if (isAuthKeyUnregisteredError(err)) {
        throw new ApiError('TWO_FA_SESSION_EXPIRED', 401, '2FA auth session expired')
      }
      throw err
    }
  }

  throw new ApiError('TWO_FA_SESSION_EXPIRED', 401, '2FA auth session expired')
}

export async function resolvePeerEntity(client, chatId, context = 'resolvePeerEntity') {
  let peerId = chatId
  if (typeof chatId === 'string' && /^-?\d+$/.test(chatId)) {
    try {
      const me = await client.getMe()
      if (me?.id && me.id.toString() === chatId) {
        peerId = 'me'
      }
    } catch {
      // noop
    }
  }

  try {
    return await client.getInputEntity(peerId)
  } catch (err) {
    const message = String(err?.message || '')
    if (message.includes('Could not find the input entity')) {
      console.warn(`[TG API] entity not found in ${context}, warming dialogs cache`)
      await client.getDialogs({ limit: 200 })
      return client.getInputEntity(peerId)
    }
    throw err
  }
}

function serializeStatus(status) {
  if (!status) return null
  return {
    className: status.className || null,
    wasOnline: toSafeInt(status.wasOnline, 0) || null,
    expires: toSafeInt(status.expires, 0) || null,
  }
}

function serializeMigratedTo(migratedTo) {
  if (!migratedTo) return null
  return {
    className: migratedTo.className || null,
    channelId: toSafeId(migratedTo.channelId || migratedTo.id),
  }
}

export function serializeEntity(entity) {
  if (!entity) return null

  return {
    id: toSafeId(entity.id),
    className: entity.className || null,
    firstName: toSafeText(entity.firstName, ''),
    lastName: toSafeText(entity.lastName, ''),
    title: toSafeText(entity.title, ''),
    username: toSafeText(entity.username, ''),
    bot: Boolean(entity.bot),
    contact: Boolean(entity.contact),
    megagroup: Boolean(entity.megagroup),
    deactivated: Boolean(entity.deactivated),
    migratedTo: serializeMigratedTo(entity.migratedTo),
    status: serializeStatus(entity.status),
  }
}

function serializePeerId(peerId) {
  if (!peerId) return null
  return {
    className: peerId.className || null,
    userId: toSafeId(peerId.userId),
    chatId: toSafeId(peerId.chatId),
    channelId: toSafeId(peerId.channelId),
  }
}

function serializeDocumentAttributes(attributes) {
  if (!Array.isArray(attributes)) return []
  return attributes.map(attr => {
    const serialized = {
      className: attr?.className || null,
    }

    if (attr?.fileName) serialized.fileName = attr.fileName
    if (attr?.duration !== undefined) serialized.duration = toSafeInt(attr.duration, 0)
    if (attr?.w !== undefined) serialized.w = toSafeInt(attr.w, 0)
    if (attr?.h !== undefined) serialized.h = toSafeInt(attr.h, 0)
    if (attr?.voice !== undefined) serialized.voice = Boolean(attr.voice)
    if (attr?.roundMessage !== undefined) serialized.roundMessage = Boolean(attr.roundMessage)
    if (attr?.supportsStreaming !== undefined) serialized.supportsStreaming = Boolean(attr.supportsStreaming)
    if (attr?.alt) serialized.alt = attr.alt

    return serialized
  })
}

function serializeMedia(media) {
  if (!media) return null

  const result = {
    className: media.className || null,
  }

  if (media.photo) {
    result.photo = {
      id: toSafeId(media.photo.id || media.photo.photoId),
      className: media.photo.className || null,
    }
  }

  if (media.document) {
    const thumbsRaw = Array.isArray(media.document.thumbs) ? media.document.thumbs : []
    const thumbs = thumbsRaw.filter(item => item?.className !== 'PhotoPathSize')
    const videoThumbsRaw = Array.isArray(media.document.videoThumbs) ? media.document.videoThumbs : []
    const videoThumbs = videoThumbsRaw.filter(
      item => item?.className === 'VideoSize' && item?.type
    )
    result.document = {
      id: toSafeId(media.document.id),
      size: toSafeInt(media.document.size, 0),
      mimeType: toSafeText(media.document.mimeType, ''),
      attributes: serializeDocumentAttributes(media.document.attributes),
      thumbCount: thumbs.length,
      videoThumbCount: videoThumbs.length,
    }
  }

  if (media.webpage) {
    result.webpage = {
      url: toSafeText(media.webpage.url, ''),
      displayUrl: toSafeText(media.webpage.displayUrl, ''),
      title: toSafeText(media.webpage.title, ''),
    }
  }

  return result
}

function serializeSender(sender) {
  if (!sender) return null
  return {
    id: toSafeId(sender.id),
    firstName: toSafeText(sender.firstName, ''),
    lastName: toSafeText(sender.lastName, ''),
    title: toSafeText(sender.title, ''),
    username: toSafeText(sender.username, ''),
  }
}

export function serializeMessage(message) {
  if (!message) return null

  return {
    id: toSafeId(message.id),
    date: toSafeInt(message.date, 0),
    editDate: toSafeInt(message.editDate, 0) || null,
    out: Boolean(message.out),
    message: toSafeText(message.message, ''),
    className: message.className || null,
    views: toSafeInt(message.views, 0) || null,
    chatId: toSafeId(message.chatId),
    peerId: serializePeerId(message.peerId),
    sender: serializeSender(message.sender),
    media: serializeMedia(message.media),
  }
}

export async function enrichMessagesWithSenders(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages

  await Promise.all(
    messages.map(async message => {
      if (message?.sender || typeof message?.getSender !== 'function') return
      try {
        message.sender = await message.getSender()
      } catch {
        // ignore individual sender failures
      }
    })
  )
  return messages
}

function serializeNotifySettings(notifySettings) {
  if (!notifySettings) return null
  return {
    muteUntil: toSafeInt(notifySettings.muteUntil, 0),
  }
}

export function serializeDialog(dialog) {
  return {
    id: toSafeId(dialog?.id || dialog?.entity?.id),
    title: toSafeText(dialog?.title, ''),
    unreadCount: toSafeInt(dialog?.unreadCount, 0),
    unreadMentionsCount: toSafeInt(dialog?.unreadMentionsCount, 0),
    folderId: toSafeInt(dialog?.folderId ?? dialog?.dialog?.folderId, 0),
    pinned: Boolean(dialog?.pinned),
    entity: serializeEntity(dialog?.entity),
    message: serializeMessage(dialog?.message),
    dialog: {
      folderId: toSafeInt(dialog?.dialog?.folderId, 0),
      notifySettings: serializeNotifySettings(dialog?.dialog?.notifySettings),
    },
  }
}

function getPeerId(peer) {
  if (!peer) return null
  return toSafeId(peer.userId || peer.chatId || peer.channelId || peer.id || peer.peerId)
}

export function serializeChatFolder(folder) {
  let title = folder?.title
  if (title && typeof title === 'object') {
    title = title.text || title.className || 'Folder'
  }

  const emoji = typeof folder?.emoticon === 'string' ? folder.emoticon : null

  return {
    id: toSafeInt(folder?.id, 0),
    title: typeof title === 'string' ? title : 'Folder',
    emoji,
    includePeers: (folder?.includePeers || []).map(getPeerId).filter(Boolean),
    excludePeers: (folder?.excludePeers || []).map(getPeerId).filter(Boolean),
    pinnedPeers: (folder?.pinnedPeers || []).map(getPeerId).filter(Boolean),
    contacts: Boolean(folder?.contacts),
    nonContacts: Boolean(folder?.nonContacts),
    groups: Boolean(folder?.groups),
    broadcasts: Boolean(folder?.broadcasts),
    bots: Boolean(folder?.bots),
    excludeMuted: Boolean(folder?.excludeMuted),
    excludeRead: Boolean(folder?.excludeRead),
    excludeArchived: Boolean(folder?.excludeArchived),
  }
}

export function mapApiError(err) {
  const mapped = toApiError(err)
  return {
    code: mapped.code,
    status: mapped.status,
    message: mapped.message || mapped.code,
    details: mapped.details || null,
    tgSession: mapped.tgSession || '',
  }
}

export function makeUploadCustomFile(file) {
  if (!file) throw new ApiError('NO_FILE_PROVIDED', 400, 'No file was provided')

  const name = toSafeText(file.name, 'upload.bin') || 'upload.bin'
  const size = toSafeInt(file.size, 0)
  if (!size) throw new ApiError('NO_FILE_PROVIDED', 400, 'File is empty')

  return file
    .arrayBuffer()
    .then(buffer => new CustomFile(name, size, '', Buffer.from(buffer)))
}
