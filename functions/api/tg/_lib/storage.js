import { Buffer } from 'node:buffer'
import { supabaseRequest } from '../../_lib/supabase.js'

function readConfigText(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return ''

  if (
    (raw.startsWith('"') && raw.endsWith('"'))
    || (raw.startsWith('\'') && raw.endsWith('\''))
  ) {
    return raw.slice(1, -1).trim()
  }

  return raw
}

function getStorageSecret(env) {
  const dedicated = readConfigText(env?.TELEGRAM_DB_SESSION_SECRET)
  if (dedicated) return dedicated

  const fallback = readConfigText(env?.TELEGRAM_SESSION_SECRET)
  if (fallback) return fallback

  throw new Error('SESSION_SECRET_MISSING')
}

function toBase64Url(bufferLike) {
  const base64 = Buffer.from(bufferLike).toString('base64')
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/')
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
  return Buffer.from(normalized + padding, 'base64')
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

let cachedSecret = ''
let cachedKey = null
let corruptedSessionCleanupCount = 0

async function getEncryptionKey(env) {
  const secret = getStorageSecret(env)
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

async function encryptSessionValue(session, env) {
  const key = await getEncryptionKey(env)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = textEncoder.encode(String(session || ''))

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  )

  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

async function decryptSessionValue(payload, env) {
  const [ivPart, cipherPart] = String(payload || '').split('.')
  if (!ivPart || !cipherPart) return ''

  const key = await getEncryptionKey(env)
  const iv = fromBase64Url(ivPart)
  const ciphertext = fromBase64Url(cipherPart)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    new Uint8Array(ciphertext)
  )

  return textDecoder.decode(plaintext)
}

function toSafeUserId(userId) {
  const numeric = Number(userId)
  if (!Number.isFinite(numeric) || numeric <= 0) return 0
  return Math.trunc(numeric)
}

function isSessionSecretMissingError(err) {
  const code = typeof err?.code === 'string' ? err.code : ''
  const message = typeof err?.message === 'string' ? err.message : ''
  const normalized = `${code} ${message}`.toUpperCase()
  return normalized.includes('SESSION_SECRET_MISSING')
}

async function deleteTelegramSessionRow(env, safeUserId) {
  if (!safeUserId) return

  await supabaseRequest(env, 'telegram_sessions', {
    method: 'DELETE',
    query: {
      user_id: `eq.${safeUserId}`,
    },
    headers: {
      Prefer: 'return=minimal',
    },
  })
}

function incrementCorruptedSessionCleanupCount() {
  corruptedSessionCleanupCount += 1
  return corruptedSessionCleanupCount
}

export async function loadTelegramSessionForUser(env, userId) {
  const safeUserId = toSafeUserId(userId)
  if (!safeUserId) return ''

  const rows = await supabaseRequest(env, 'telegram_sessions', {
    query: {
      select: 'session_encrypted',
      user_id: `eq.${safeUserId}`,
      limit: 1,
    },
  })

  const encrypted = Array.isArray(rows) ? String(rows[0]?.session_encrypted || '') : ''
  if (!encrypted) return ''

  try {
    return await decryptSessionValue(encrypted, env)
  } catch (err) {
    // Missing encryption secret is a config issue; do not hide or delete data.
    if (isSessionSecretMissingError(err)) {
      throw err
    }

    // Encrypted payload cannot be decrypted (rotated key/corrupted row): remove stale row.
    try {
      await deleteTelegramSessionRow(env, safeUserId)
      const cleanupCount = incrementCorruptedSessionCleanupCount()
      console.info('[TG STORAGE] Auto-cleared corrupted telegram session row:', {
        userId: safeUserId,
        cleanupCount,
        decryptError: String(err?.message || err || ''),
      })
    } catch (deleteErr) {
      console.warn('[TG STORAGE] Failed to delete corrupted telegram session row:', {
        userId: safeUserId,
        decryptError: String(err?.message || err || ''),
        deleteError: String(deleteErr?.message || deleteErr || ''),
      })
    }
    return ''
  }
}

export async function saveTelegramSessionForUser(env, userId, session) {
  const safeUserId = toSafeUserId(userId)
  if (!safeUserId) return

  const value = typeof session === 'string' ? session : String(session || '')
  const now = Date.now()

  if (!value) {
    await deleteTelegramSessionRow(env, safeUserId)
    return
  }

  const encrypted = await encryptSessionValue(value, env)
  await supabaseRequest(env, 'telegram_sessions', {
    method: 'POST',
    query: {
      on_conflict: 'user_id',
    },
    body: {
      user_id: safeUserId,
      session_encrypted: encrypted,
      updated_at: now,
    },
    headers: {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
  })
}

export async function clearTelegramSessionForUser(env, userId) {
  return saveTelegramSessionForUser(env, userId, '')
}
