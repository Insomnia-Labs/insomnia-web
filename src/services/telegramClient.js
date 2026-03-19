/**
 * telegramClient.js
 * Browser-side GramJS MTProto client (singleton).
 * Session is persisted to localStorage so the user stays logged in.
 */

import { TelegramClient, Api } from 'telegram'
import { StringSession } from 'telegram/sessions/index.js'
import { computeCheck } from 'telegram/Password.js'
import { NewMessage } from 'telegram/events/index.js'
import { readBigIntFromBuffer, generateRandomBytes } from 'telegram/Helpers.js'

const API_ID = Number(import.meta.env.VITE_TELEGRAM_API_ID)
const API_HASH = import.meta.env.VITE_TELEGRAM_API_HASH

const SESSION_KEY = 'void_tg_session'
const CONNECT_TIMEOUT_MS = 20000
const AUTH_TIMEOUT_MS = 30000
const UPLOAD_PART_SIZE_KB = 512
const UPLOAD_LARGE_FILE_THRESHOLD_BYTES = 10 * 1024 * 1024
const UPLOAD_MAX_WORKERS = 16
const UPLOAD_MIN_WORKERS = 1
const UPLOAD_RETRY_LIMIT = 4
const UPLOAD_RETRY_DELAY_MS = 250

let _client = null
let _phoneCodeHash = null

/* ── Internals ──────────────────────────────────────────── */

function getStoredSession() {
    return new StringSession(localStorage.getItem(SESSION_KEY) ?? '')
}

function persistSession() {
    if (_client) localStorage.setItem(SESSION_KEY, _client.session.save())
}

function withTimeout(promise, timeoutMs, code = 'REQUEST_TIMEOUT') {
    let timeoutId
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
            const err = new Error(code)
            err.code = code
            reject(err)
        }, timeoutMs)
    })

    return Promise.race([promise, timeoutPromise]).finally(() => {
        window.clearTimeout(timeoutId)
    })
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function clampUploadWorkers(value, partCount) {
    const numeric = Number(value)
    const wanted = Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : UPLOAD_MIN_WORKERS
    return Math.max(
        UPLOAD_MIN_WORKERS,
        Math.min(UPLOAD_MAX_WORKERS, Number.isFinite(partCount) ? partCount : UPLOAD_MAX_WORKERS, wanted)
    )
}

function pickAdaptiveWorkers(fileSizeBytes) {
    let workers = 8
    if (fileSizeBytes >= 64 * 1024 * 1024) workers = 12
    else if (fileSizeBytes <= 4 * 1024 * 1024) workers = 4

    const effectiveType = typeof navigator !== 'undefined' && navigator?.connection?.effectiveType
        ? navigator.connection.effectiveType
        : ''

    if (effectiveType.includes('2g')) workers = Math.min(workers, 2)
    else if (effectiveType.includes('3g')) workers = Math.min(workers, 4)

    return workers
}

function makeUploadFileId() {
    return readBigIntFromBuffer(generateRandomBytes(8), true, true)
}

async function readUploadChunk(file, start, end) {
    const chunkBlob = file.slice(start, end)
    const ab = await chunkBlob.arrayBuffer()
    return Buffer.from(ab)
}

async function uploadFileFast(client, file, options = {}) {
    const size = Number(file?.size)
    if (!Number.isFinite(size) || size <= 0) {
        throw new Error('FILE_SIZE_INVALID')
    }

    const name = file?.name || 'upload.bin'
    const partSize = UPLOAD_PART_SIZE_KB * 1024
    const partCount = Math.max(1, Math.ceil(size / partSize))
    const baseWorkers = Number.isFinite(options.workers) ? options.workers : pickAdaptiveWorkers(size)
    const workers = clampUploadWorkers(baseWorkers, partCount)
    const isLarge = size > UPLOAD_LARGE_FILE_THRESHOLD_BYTES
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const fileId = makeUploadFileId()

    let uploadedParts = 0
    let nextPart = 0

    const emitProgress = () => {
        if (!onProgress) return
        try {
            onProgress(Math.max(0, Math.min(1, uploadedParts / partCount)))
        } catch { }
    }

    emitProgress()

    const sendPart = async (sender, partIndex) => {
        const start = partIndex * partSize
        const end = Math.min(size, start + partSize)
        const bytes = await readUploadChunk(file, start, end)

        let attempt = 0
        while (true) {
            let activeSender = sender
            try {
                if (!activeSender || !activeSender.isConnected()) {
                    activeSender = await client.getSender(client.session.dcId)
                }

                const request = isLarge
                    ? new Api.upload.SaveBigFilePart({
                        fileId,
                        filePart: partIndex,
                        fileTotalParts: partCount,
                        bytes
                    })
                    : new Api.upload.SaveFilePart({
                        fileId,
                        filePart: partIndex,
                        bytes
                    })

                await activeSender.send(request)
                uploadedParts += 1
                emitProgress()
                return activeSender
            } catch (err) {
                attempt += 1
                if (err?.seconds && err?.errorMessage?.includes?.('FLOOD_WAIT')) {
                    await sleep(err.seconds * 1000)
                    continue
                }
                if (attempt > UPLOAD_RETRY_LIMIT) throw err
                await sleep(UPLOAD_RETRY_DELAY_MS * attempt)
                try {
                    activeSender = await client.getSender(client.session.dcId)
                } catch { }
                sender = activeSender
            }
        }
    }

    const runWorker = async () => {
        let sender = await client.getSender(client.session.dcId)
        while (true) {
            const partIndex = nextPart
            nextPart += 1
            if (partIndex >= partCount) break
            if (onProgress?.isCanceled) throw new Error('USER_CANCELED')
            sender = await sendPart(sender, partIndex)
        }
    }

    await Promise.all(Array.from({ length: workers }, () => runWorker()))

    emitProgress()

    if (isLarge) {
        return new Api.InputFileBig({
            id: fileId,
            parts: partCount,
            name
        })
    }

    return new Api.InputFile({
        id: fileId,
        parts: partCount,
        name,
        md5Checksum: ''
    })
}

/**
 * Returns a connected GramJS client (singleton, lazy-init).
 */
export async function getClient() {
    if (_client && _client.connected) return _client

    if (!Number.isFinite(API_ID) || API_ID <= 0 || !API_HASH) {
        const err = new Error('TELEGRAM_CONFIG_MISSING')
        err.code = 'TELEGRAM_CONFIG_MISSING'
        throw err
    }

    _client = new TelegramClient(getStoredSession(), API_ID, API_HASH, {
        connectionRetries: 5,
        useWSS: true, // Browser MUST use WebSocket transport
    })

    _client.setLogLevel('error')

    await withTimeout(_client.connect(), CONNECT_TIMEOUT_MS, 'TELEGRAM_CONNECT_TIMEOUT')

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
    const client = await withTimeout(getClient(), CONNECT_TIMEOUT_MS, 'TELEGRAM_CONNECT_TIMEOUT')

    const result = await withTimeout(
        client.invoke(
            new Api.auth.SendCode({
                phoneNumber,
                apiId: API_ID,
                apiHash: API_HASH,
                settings: new Api.CodeSettings({}),
            })
        ),
        AUTH_TIMEOUT_MS,
        'TELEGRAM_SEND_CODE_TIMEOUT'
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

    const client = await withTimeout(getClient(), CONNECT_TIMEOUT_MS, 'TELEGRAM_CONNECT_TIMEOUT')

    const result = await withTimeout(
        client.invoke(
            new Api.auth.SignIn({
                phoneNumber,
                phoneCodeHash: _phoneCodeHash,
                phoneCode,
            })
        ),
        AUTH_TIMEOUT_MS,
        'TELEGRAM_SIGN_IN_TIMEOUT'
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
    const client = await withTimeout(getClient(), CONNECT_TIMEOUT_MS, 'TELEGRAM_CONNECT_TIMEOUT')

    // Fetch current 2FA password settings (SRP params) from Telegram
    const passwordInfo = await withTimeout(client.invoke(new Api.account.GetPassword()), AUTH_TIMEOUT_MS, 'TELEGRAM_2FA_FETCH_TIMEOUT')

    // GramJS computes the SRP proof for us
    const srpCheck = await computeCheck(passwordInfo, password)

    const result = await withTimeout(
        client.invoke(new Api.auth.CheckPassword({ password: srpCheck })),
        AUTH_TIMEOUT_MS,
        'TELEGRAM_2FA_CHECK_TIMEOUT'
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

    let peerId = chatId;
    if (typeof chatId === 'string' && /^-?\d+$/.test(chatId)) {
        try {
            const me = await client.getMe();
            if (me && me.id && me.id.toString() === chatId) {
                peerId = "me";
            }
        } catch (e) { }
    }

    try {
        const messages = await client.getMessages(peerId, {
            limit: limit,
            offsetId: offsetId
        })
        return messages
    } catch (err) {
        if (err.message && err.message.includes("Could not find the input entity")) {
            console.warn("[TG] Entity not found. Fetching dialogs to warm up cache...");
            await client.getDialogs({ limit: 200 });
            return await client.getMessages(peerId, {
                limit: limit,
                offsetId: offsetId
            })
        }
        throw err;
    }
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
    const messageFilter = new NewMessage({})
    client.addEventHandler(handler, messageFilter)

    // Provide unsubscribe
    return () => {
        client.removeEventHandler(handler, messageFilter)
    }
}

export async function subscribeToPresence(callback) {
    const client = await getClient()

    const handler = (event) => {
        // GramJS raw events
        let update = event
        if (event && event.update) update = event.update // Sometimes wrapped in an event object

        if (update && update.className === 'UpdateUserStatus') {
            callback({
                userId: update.userId?.toString(),
                status: update.status
            })
        } else if (update && update.className === 'UpdateShort' && update.update?.className === 'UpdateUserStatus') {
            callback({
                userId: update.update.userId?.toString(),
                status: update.update.status
            })
        }
    }

    client.addEventHandler(handler)

    return () => {
        client.removeEventHandler(handler)
    }
}

export async function subscribeToTyping(callback) {
    const client = await getClient()

    const handler = (event) => {
        let update = event
        if (event && event.update) update = event.update

        if (update?.className === 'UpdateUserTyping') {
            callback({
                chatId: update.userId?.toString(),
                userId: update.userId?.toString(),
                action: update.action?.className
            })
        } else if (update?.className === 'UpdateChatUserTyping') {
            // Provide neg (-) format if it's a group to match ChatId convention in GramJS dialogs but GramJS sometimes uses raw id
            callback({
                chatId: update.chatId?.toString(),
                userId: update.userId?.toString(),
                action: update.action?.className
            })
        } else if (update?.className === 'UpdateChannelUserTyping') {
            // Same logic for channel
            callback({
                chatId: '-100' + update.channelId?.toString(),
                userId: update.userId?.toString(),
                action: update.action?.className
            })
        } else if (update?.className === 'UpdateShort' && update.update?.className === 'UpdateUserTyping') {
            callback({
                chatId: update.update.userId?.toString(),
                userId: update.update.userId?.toString(),
                action: update.update.action?.className
            })
        }
    }

    client.addEventHandler(handler)

    return () => {
        client.removeEventHandler(handler)
    }
}

export async function sendMessage(chatId, message) {
    const client = await getClient()
    const peer = await resolvePeerEntity(client, chatId, 'sendMessage')

    // 2. Ghost Mode Delay: Minimum 10-12 seconds into the future (Telegram API limit)
    // Injects the message into the datacenter's internal cron-worker queue
    const stealthScheduleTime = Math.floor(Date.now() / 1000) + 12

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

async function resolvePeerEntity(client, chatId, context = 'resolvePeerEntity') {
    let peerId = chatId
    if (typeof chatId === 'string' && /^-?\d+$/.test(chatId)) {
        try {
            const me = await client.getMe()
            if (me && me.id && me.id.toString() === chatId) {
                peerId = 'me'
            }
        } catch (e) { }
    }

    try {
        return await client.getInputEntity(peerId)
    } catch (err) {
        if (err.message && err.message.includes('Could not find the input entity')) {
            console.warn(`[TG] Entity not found for ${context}. Warming up cache...`)
            await client.getDialogs({ limit: 200 })
            return await client.getInputEntity(peerId)
        }
        throw err
    }
}

function normalizeBrowserUploadFile(file) {
    if (typeof File === 'undefined' || !(file instanceof File)) {
        return file
    }

    // GramJS checks `"read" in file` before it handles browser File properly.
    // We provide that method through a File subclass so the object keeps native File behavior.
    if ('read' in file) {
        return file
    }

    try {
        class BrowserUploadFile extends File {
            read(start = 0, end = this.size) {
                return this.slice(start, end)
            }
        }

        return new BrowserUploadFile([file], file.name || 'upload.bin', {
            type: file.type || 'application/octet-stream',
            lastModified: Number.isFinite(file.lastModified) ? file.lastModified : Date.now()
        })
    } catch (err) {
        try {
            Object.defineProperty(file, 'read', {
                configurable: true,
                enumerable: false,
                writable: false,
                value: (start = 0, end = file.size) => file.slice(start, end)
            })
        } catch { }
        return file
    }
}

export async function sendFileToChat(chatId, file, options = {}) {
    if (!file) throw new Error('NO_FILE_PROVIDED')

    const client = await getClient()
    const peer = await resolvePeerEntity(client, chatId, 'sendFileToChat')
    const normalizedFile = normalizeBrowserUploadFile(file)

    const caption = typeof options.caption === 'string' ? options.caption : ''
    const silent = options.silent !== false
    const workers = Number.isFinite(options.workers) ? options.workers : undefined
    const forceDocument = options.forceDocument === true
    const progressHandler = typeof options.onProgress === 'function'
        ? options.onProgress
        : (typeof options.progressCallback === 'function' ? options.progressCallback : null)
    const progressCallback = progressHandler
        ? (value) => {
            try { progressHandler(value) } catch { }
        }
        : undefined

    try { client.invoke(new Api.account.UpdateStatus({ offline: true })).catch(() => { }) } catch (e) { }

    try {
        let uploadHandle = null
        try {
            uploadHandle = await uploadFileFast(client, normalizedFile, {
                workers,
                onProgress: progressCallback
            })
        } catch (uploadErr) {
            console.warn('[TG] Fast upload failed, fallback to default sendFile', uploadErr)
        }

        const result = await client.sendFile(peer, {
            file: uploadHandle || normalizedFile,
            caption,
            forceDocument,
            silent,
            workers,
            progressCallback: uploadHandle ? undefined : progressCallback,
            supportsStreaming: normalizedFile?.type?.startsWith?.('video/') || false
        })

        if (uploadHandle && progressCallback) {
            try { progressCallback(1) } catch { }
        }

        return result
    } finally {
        try { client.invoke(new Api.account.UpdateStatus({ offline: true })).catch(() => { }) } catch (e) { }
    }
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
