import { Buffer } from 'node:buffer'
import { toInt } from './http.js'

const COOKIE_NAME = 'tg_session_state'
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

let cachedSecret = ''
let cachedKey = null

function emptyState() {
  return {
    session: '',
    pendingAuth: null,
    updatedAt: Date.now(),
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePendingAuth(value) {
  if (!isObject(value)) return null

  const phoneNumber = typeof value.phoneNumber === 'string' ? value.phoneNumber : ''
  const phoneCodeHash = typeof value.phoneCodeHash === 'string' ? value.phoneCodeHash : ''
  if (!phoneNumber || !phoneCodeHash) return null

  return {
    phoneNumber,
    phoneCodeHash,
    createdAt: toInt(value.createdAt, Date.now()),
  }
}

function normalizeState(raw) {
  const state = emptyState()
  if (!isObject(raw)) return state

  state.session = typeof raw.session === 'string' ? raw.session : ''
  state.pendingAuth = normalizePendingAuth(raw.pendingAuth)
  state.updatedAt = toInt(raw.updatedAt, Date.now())

  return state
}

function parseCookies(cookieHeader) {
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
      result[key] = value
    })

  return result
}

function toBase64Url(bufferLike) {
  const base64 = Buffer.from(bufferLike).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(padded, 'base64')
}

async function getSessionKey(env) {
  const secret = String(env?.TELEGRAM_SESSION_SECRET || '').trim()
  if (!secret) {
    throw new Error('SESSION_SECRET_MISSING')
  }

  if (cachedKey && cachedSecret === secret) return cachedKey

  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret))
  cachedKey = await crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
  cachedSecret = secret
  return cachedKey
}

async function encryptPayload(payload, env) {
  const key = await getSessionKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(JSON.stringify(payload))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

async function decryptPayload(token, env) {
  const [ivPart, cipherPart] = String(token || '').split('.')
  if (!ivPart || !cipherPart) return null

  const key = await getSessionKey(env)
  const iv = fromBase64Url(ivPart)
  const ciphertext = fromBase64Url(cipherPart)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext)
  )

  return JSON.parse(textDecoder.decode(plaintext))
}

export async function readSessionState(request, env) {
  const cookieHeader = request.headers.get('cookie')
  const cookies = parseCookies(cookieHeader)
  const token = cookies[COOKIE_NAME]
  if (!token) return emptyState()

  try {
    const raw = await decryptPayload(token, env)
    return normalizeState(raw)
  } catch {
    return emptyState()
  }
}

export async function buildSessionCookie(state, env) {
  const normalized = normalizeState(state)
  normalized.updatedAt = Date.now()

  const token = await encryptPayload(normalized, env)
  return [
    `${COOKIE_NAME}=${token}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

export function buildClearedSessionCookie() {
  return [
    `${COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ')
}

export function clearPendingAuth(state) {
  return {
    ...normalizeState(state),
    pendingAuth: null,
    updatedAt: Date.now(),
  }
}
