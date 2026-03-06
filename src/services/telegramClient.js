/**
 * telegramClient.js
 * Browser-side GramJS MTProto client (singleton).
 * Session is persisted to localStorage so the user stays logged in.
 */

import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { computeCheck } from 'telegram/Password.js'
import { NewMessage } from 'telegram/events/index.js'

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

    _client.setLogLevel('error')

    await _client.connect()

    // As soon as we connect, force the session offline so downloading chats doesn't trigger "online"
    try {
        await _client.invoke(new Api.account.UpdateStatus({ offline: true }))
    } catch (e) {
        console.warn('Failed to force offline status on connect:', e)
    }

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

export async function subscribeToMessages(chatId, callback) {
    const client = await getClient()

    const handler = async (event) => {
        const message = event.message
        if (!message) return

        // Extract chat ID depending on the peer type
        const pId = message.peerId
        const eventChatId = pId?.userId?.toString() || pId?.channelId?.toString() || pId?.chatId?.toString() || message.chatId?.toString()

        if (eventChatId === chatId.toString()) {
            // NewMessage events usually don't populate the sender object immediately
            try {
                if (typeof message.getSender === 'function') {
                    message.sender = await message.getSender()
                }
            } catch (err) {
                console.warn('[TG] Failed to get sender for realtime message', err)
            }

            callback(message)
        }
    }

    // Passive real-time connection from WebSockets pushes.
    // DOES NOT trigger the server-side online status heuristic.
    client.addEventHandler(handler, new NewMessage({}))

    // Provide unsubscribe
    return () => {
        client.removeEventHandler(handler, new NewMessage({}))
    }
}

export async function sendMessage(chatId, message) {
    const client = await getClient()

    // 1. Resolve peer to proper InputPeer
    const peer = await client.getInputEntity(chatId)

    // 2. Ghost Mode Delay: Minimum 15 seconds into the future
    // Injects the message into the datacenter's internal cron-worker queue
    const stealthScheduleTime = Math.floor(Date.now() / 1000) + 15

    // 3. Raw Request with Obfuscation flags (silent, background, no_webpage)
    const sendRequest = new Api.messages.SendMessage({
        peer: peer,
        message: message,
        randomId: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
        scheduleDate: stealthScheduleTime, // The core of the stealth logic
        silent: true,      // Obfuscation flag
        background: true,  // Obfuscation flag
        noWebpage: true,   // Obfuscation flag
        clearDraft: true
    })

    // 4. Wrap in InvokeWithoutUpdates to strictly block "B" side presence broadcasts
    const stealthRequest = new Api.InvokeWithoutUpdates({
        query: sendRequest
    })

    // To prevent any residual TCP leaks marking us online
    try { await client.invoke(new Api.account.UpdateStatus({ offline: true })) } catch (e) { }
    const result = await client.invoke(stealthRequest)
    try { await client.invoke(new Api.account.UpdateStatus({ offline: true })) } catch (e) { }

    return result
}

const _avatarCache = new Map()

// Concurrency queue for profile photos to prevent crashing connection
let _activeAvatarFetches = 0
const _avatarQueue = []

async function processAvatarQueue() {
    if (_activeAvatarFetches >= 3 || _avatarQueue.length === 0) return
    _activeAvatarFetches++
    const { entity, resolve } = _avatarQueue.shift()

    try {
        const client = await getClient()
        const buffer = await client.downloadProfilePhoto(entity, { isBig: false })
        if (!buffer || buffer.length === 0) {
            resolve(null)
        } else {
            const blob = new Blob([buffer], { type: 'image/jpeg' })
            resolve(URL.createObjectURL(blob))
        }
    } catch {
        resolve(null)
    } finally {
        _activeAvatarFetches--
        processAvatarQueue()
    }
}

export async function getProfilePhoto(entity) {
    if (!entity) return null
    const key = entity.id?.toString() || entity.toString()
    if (_avatarCache.has(key)) return _avatarCache.get(key)

    // Set a temporary promise so multiple identical requests wait for same promise
    if (!_avatarCache.has(key)) {
        const promise = new Promise(resolve => {
            _avatarQueue.push({ entity, resolve })
            processAvatarQueue()
        }).then(url => {
            _avatarCache.set(key, url)
            return url
        })
        _avatarCache.set(key, promise)
    }

    return await _avatarCache.get(key)
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

        console.log('[TG] Raw chat folders from Telegram:', filters)

        // helper: extract numeric peer ID from InputPeer objects
        const getPeerId = (peer) => {
            if (!peer) return null
            return (peer.userId || peer.chatId || peer.channelId || peer.id || peer.peerId)?.toString() || null
        }

        return filters
            .filter(f => f.className === 'DialogFilter' || f.className === 'DialogFilterChatlist')
            .map(f => {
                // title can be a string or a TextWithEntities object
                let title = f.title
                if (title && typeof title === 'object') {
                    // fallback safely for TextWithEntities or other objects
                    title = title.text || title.className || 'Folder'
                }

                let emoji = f.emoticon
                if (emoji && typeof emoji !== 'string') {
                    emoji = null // prevent React crash on complex animated emoji objects
                }

                return {
                    id: f.id,
                    title: typeof title === 'string' ? title : 'Folder',
                    emoji: emoji || null,
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
