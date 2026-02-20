/**
 * telegramClient.js
 * Browser-side GramJS MTProto client (singleton).
 * Session is persisted to localStorage so the user stays logged in.
 */

import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { computeCheck } from 'telegram/Password.js'

const API_ID = Number(import.meta.env.VITE_TELEGRAM_API_ID)
const API_HASH = import.meta.env.VITE_TELEGRAM_API_HASH

const SESSION_KEY = 'void_tg_session'

let _client = null
let _phoneCodeHash = null

/* ── Internals ──────────────────────────────────────────── */

function getStoredSession() {
    return new StringSession(localStorage.getItem(SESSION_KEY) ?? '')
}

function persistSession() {
    if (_client) localStorage.setItem(SESSION_KEY, _client.session.save())
}

/**
 * Returns a connected GramJS client (singleton, lazy-init).
 */
export async function getClient() {
    if (_client && _client.connected) return _client

    _client = new TelegramClient(getStoredSession(), API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true, // Browser MUST use WebSocket transport
    })

    await _client.connect()
    return _client
}

/* ── Public API ─────────────────────────────────────────── */

/**
 * Step 1 – request a sign-in code to the given phone number.
 */
export async function sendCode(phoneNumber) {
    const client = await getClient()

    const result = await client.invoke(
        new Api.auth.SendCode({
            phoneNumber,
            apiId: API_ID,
            apiHash: API_HASH,
            settings: new Api.CodeSettings({}),
        })
    )

    _phoneCodeHash = result.phoneCodeHash
    console.log('[TG] sendCode OK')
    return { phoneCodeHash: _phoneCodeHash }
}

/**
 * Step 2 – verify the received code.
 * Throws with message 'SESSION_PASSWORD_NEEDED' if 2FA is enabled.
 */
export async function signIn(phoneNumber, phoneCode) {
    if (!_phoneCodeHash) throw new Error('Call sendCode() first')

    const client = await getClient()

    const result = await client.invoke(
        new Api.auth.SignIn({
            phoneNumber,
            phoneCodeHash: _phoneCodeHash,
            phoneCode,
        })
    )

    persistSession()
    console.log('[TG] signIn OK, user:', result.user?.firstName)
    return result
}

/**
 * Step 3 (optional) – complete 2FA with the cloud password.
 * Call this only when signIn() threw SESSION_PASSWORD_NEEDED.
 */
export async function signInWith2FA(password) {
    const client = await getClient()

    // Fetch current 2FA password settings (SRP params) from Telegram
    const passwordInfo = await client.invoke(new Api.account.GetPassword())

    // GramJS computes the SRP proof for us
    const srpCheck = await computeCheck(passwordInfo, password)

    const result = await client.invoke(
        new Api.auth.CheckPassword({ password: srpCheck })
    )

    persistSession()
    console.log('[TG] 2FA OK, user:', result.user?.firstName)
    return result
}

/**
 * Returns true if there's a valid, authorized session stored.
 */
export async function isAuthorized() {
    try {
        const client = await getClient()
        return await client.isUserAuthorized()
    } catch {
        return false
    }
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY)
    _client = null
    _phoneCodeHash = null
}
