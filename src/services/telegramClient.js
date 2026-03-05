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

export async function getMe() {
    const client = await getClient()
    const me = await client.getMe()
    return me
}

export async function getDialogs(limit = 20, folder = undefined) {
    const client = await getClient()
    const opts = { limit }
    if (folder !== undefined) opts.folder = folder
    const dialogs = await client.getDialogs(opts)
    return dialogs
}

export async function getChatHistory(chatId, options = {}) {
    const client = await getClient()
    const limit = options.limit || 50
    const offsetId = options.offsetId || 0
    // getMessages expects a string/number id or an entity.
    const messages = await client.getMessages(chatId, {
        limit: limit,
        offsetId: offsetId
    })
    return messages
}

export async function sendMessage(chatId, message) {
    const client = await getClient()
    return await client.sendMessage(chatId, { message })
}

const _avatarCache = new Map()

export async function getProfilePhoto(entity) {
    if (!entity) return null
    const key = entity.id?.toString() || entity.toString()
    if (_avatarCache.has(key)) return _avatarCache.get(key)

    try {
        const client = await getClient()
        const buffer = await client.downloadProfilePhoto(entity, { isBig: false })
        if (!buffer || buffer.length === 0) {
            _avatarCache.set(key, null)
            return null
        }
        const blob = new Blob([buffer], { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        _avatarCache.set(key, url)
        return url
    } catch {
        _avatarCache.set(key, null)
        return null
    }
}

export async function getChatFolders() {
    try {
        const client = await getClient()
        const result = await client.invoke(new Api.messages.GetDialogFilters())
        // result can be DialogFilters (with .filters array) or an array directly
        let filters = []
        if (Array.isArray(result)) {
            filters = result
        } else if (result && Array.isArray(result.filters)) {
            filters = result.filters
        } else {
            console.warn('[TG] getChatFolders: unexpected result shape', result?.className)
            return []
        }

        // helper: extract numeric peer ID from InputPeer objects
        const getPeerId = (peer) => {
            if (!peer) return null
            return (peer.userId || peer.chatId || peer.channelId)?.toString() || null
        }

        return filters
            .filter(f => f.className === 'DialogFilter' || f.className === 'DialogFilterChatlist')
            .map(f => {
                // title can be a string or a TextWithEntities object
                let title = f.title
                if (title && typeof title === 'object') {
                    title = title.text || title.toString()
                }
                return {
                    id: f.id,
                    title: title || 'Folder',
                    emoji: f.emoticon || null,
                    // peer lists for client-side filtering
                    includePeers: (f.includePeers || []).map(getPeerId).filter(Boolean),
                    excludePeers: (f.excludePeers || []).map(getPeerId).filter(Boolean),
                    pinnedPeers: (f.pinnedPeers || []).map(getPeerId).filter(Boolean),
                    // type flags
                    contacts: !!f.contacts,
                    nonContacts: !!f.nonContacts,
                    groups: !!f.groups,
                    broadcasts: !!f.broadcasts,
                    bots: !!f.bots,
                    excludeMuted: !!f.excludeMuted,
                    excludeRead: !!f.excludeRead,
                    excludeArchived: !!f.excludeArchived,
                }
            })
    } catch (err) {
        console.error('[TG] getChatFolders error:', err)
        return []
    }
}

export function clearSession() {
    localStorage.removeItem(SESSION_KEY)
    _client = null
    _phoneCodeHash = null
}
