import { Api } from 'telegram'
import { uploadFile as gramUploadFile, CustomFile } from 'telegram/client/uploads.js'
import { Buffer } from 'node:buffer'
import { readAuthenticatedUser } from '../_lib/auth.js'
import { json, readJsonBody, toBoolean, toInt } from './_lib/http.js'
import {
  ApiError,
  enrichMessagesWithSenders,
  mapApiError,
  resolvePeerEntity,
  runWithTelegramClient,
  sendCodeWithClient,
  serializeChatFolder,
  serializeDialog,
  serializeMessage,
  signInWithCode,
  signInWithPassword,
} from './_lib/telegram.js'
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  clearPendingAuth,
  readSessionState,
} from './_lib/session.js'
import {
  clearTelegramSessionForUser,
  loadTelegramSessionForUser,
  saveTelegramSessionForUser,
} from './_lib/storage.js'

function routeNotFoundResponse() {
  return json(
    {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    },
    { status: 404 }
  )
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function toText(value, fallback = '') {
  if (typeof value === 'string') return value.trim()
  return fallback
}

function toPositiveInt(value) {
  const parsed = toInt(value, 0)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return parsed
}

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif'])
const VIDEO_EXTENSIONS = new Set([
  'mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv',
  'ts', 'mts', 'm2ts', '3gp', '3g2', 'mpg', 'mpeg', 'mpe',
  'mpv', 'ogv', 'ogm', 'asf', 'vob', 'f4v', 'rm', 'rmvb',
])
const GENERIC_BINARY_MIMES = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/x-octet-stream',
  'application/x-binary',
  'application/unknown',
])
const PREVIEW_ETAG_VERSION = 'v9'
const MIN_ACCEPTABLE_PHOTO_PREVIEW_BYTES = 24 * 1024

function getFileExtension(value) {
  const text = toText(value).toLowerCase()
  if (!text) return ''
  const clean = text.split('?')[0].split('#')[0]
  const idx = clean.lastIndexOf('.')
  if (idx <= 0 || idx >= clean.length - 1) return ''
  return clean.slice(idx + 1)
}

function inferImageMimeByExtension(ext) {
  if (!ext) return ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'bmp') return 'image/bmp'
  if (ext === 'heic') return 'image/heic'
  if (ext === 'heif') return 'image/heif'
  if (ext === 'avif') return 'image/avif'
  return ''
}

function inferVideoMimeByExtension(ext) {
  if (!ext) return ''
  if (ext === 'webm') return 'video/webm'
  if (ext === 'mkv') return 'video/x-matroska'
  if (ext === 'mov') return 'video/quicktime'
  if (ext === 'avi') return 'video/x-msvideo'
  if (ext === 'wmv') return 'video/x-ms-wmv'
  if (ext === 'asf') return 'video/x-ms-asf'
  if (ext === 'flv') return 'video/x-flv'
  if (ext === 'ts' || ext === 'mts' || ext === 'm2ts') return 'video/mp2t'
  if (ext === '3gp') return 'video/3gpp'
  if (ext === '3g2') return 'video/3gpp2'
  if (ext === 'mpg' || ext === 'mpeg' || ext === 'mpe' || ext === 'mpv' || ext === 'vob') return 'video/mpeg'
  if (ext === 'ogv' || ext === 'ogm') return 'video/ogg'
  if (ext === 'f4v') return 'video/mp4'
  if (ext === 'mp4' || ext === 'm4v') return 'video/mp4'
  return ''
}

function isGenericBinaryMime(value) {
  const mime = toText(value).toLowerCase()
  if (!mime) return false
  return GENERIC_BINARY_MIMES.has(mime)
}

function isLikelyVideoMime(value) {
  const mime = toText(value).toLowerCase()
  if (!mime) return false
  if (mime.startsWith('video/')) return true
  return mime.includes('matroska')
    || mime.includes('x-msvideo')
    || mime.includes('msvideo')
    || mime.includes('quicktime')
    || mime.includes('x-ms-wmv')
    || mime.includes('x-ms-asf')
    || mime.includes('x-flv')
    || mime.includes('3gpp')
    || mime.includes('3gpp2')
    || mime.includes('mp2t')
    || mime.includes('vnd.dlna.mpeg-tts')
}

function resolveVideoPreviewMime(documentMime, fileExtension) {
  const mime = toText(documentMime).toLowerCase()
  if (mime && !isGenericBinaryMime(mime) && isLikelyVideoMime(mime)) {
    return mime
  }
  return inferVideoMimeByExtension(fileExtension) || ''
}

function detectMediaContentType(bytes, fallback = '') {
  if (!bytes || bytes.length < 12) return fallback

  const b0 = bytes[0]
  const b1 = bytes[1]
  const b2 = bytes[2]
  const b3 = bytes[3]

  // JPEG
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg'
  // PNG
  if (
    b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // GIF
  if (
    b0 === 0x47 && b1 === 0x49 && b2 === 0x46
    && (bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61)
  ) {
    return 'image/gif'
  }
  // WEBP
  if (
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  // BMP
  if (b0 === 0x42 && b1 === 0x4d) return 'image/bmp'
  // MP4-ish (ftyp at offset 4)
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'video/mp4'
  }
  // Matroska / WebM (EBML)
  if (b0 === 0x1a && b1 === 0x45 && b2 === 0xdf && b3 === 0xa3) {
    const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, Math.min(bytes.length, 4096))).toLowerCase()
    if (text.includes('webm')) return 'video/webm'
    return 'video/x-matroska'
  }
  // AVI
  if (
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46
    && bytes[8] === 0x41 && bytes[9] === 0x56 && bytes[10] === 0x49 && bytes[11] === 0x20
  ) {
    return 'video/x-msvideo'
  }
  // FLV
  if (b0 === 0x46 && b1 === 0x4c && b2 === 0x56) return 'video/x-flv'
  // ASF/WMV container
  if (
    b0 === 0x30 && b1 === 0x26 && b2 === 0xb2 && b3 === 0x75
    && bytes[4] === 0x8e && bytes[5] === 0x66 && bytes[6] === 0xcf && bytes[7] === 0x11
  ) {
    return 'video/x-ms-asf'
  }
  // MPEG-TS (sync byte every 188 bytes)
  if (bytes.length > 376 && bytes[0] === 0x47 && bytes[188] === 0x47) return 'video/mp2t'

  return fallback
}

function concatBinaryChunks(chunks) {
  const safeChunks = Array.isArray(chunks)
    ? chunks.filter(chunk => chunk && chunk.length)
    : []
  if (safeChunks.length === 0) return null

  let total = 0
  safeChunks.forEach(chunk => {
    total += chunk.length
  })
  if (total <= 0) return null

  const merged = new Uint8Array(total)
  let offset = 0
  safeChunks.forEach(chunk => {
    merged.set(chunk, offset)
    offset += chunk.length
  })
  return merged
}

async function downloadDocumentHeadSample(client, document, maxBytes = 320 * 1024) {
  if (!document?.id || !document?.accessHash || !document?.fileReference) return null
  const dcId = toInt(document?.dcId, 0)
  const requestSize = 128 * 1024
  const maxChunks = Math.max(1, Math.ceil(maxBytes / requestSize))

  const location = new Api.InputDocumentFileLocation({
    id: document.id,
    accessHash: document.accessHash,
    fileReference: document.fileReference,
    thumbSize: '',
  })

  const chunks = []
  let total = 0

  for await (const chunk of client.iterDownload({
    file: location,
    dcId: dcId > 0 ? dcId : undefined,
    requestSize,
    chunkSize: requestSize,
    limit: maxChunks,
  })) {
    if (!chunk || !chunk.length) break
    const remaining = maxBytes - total
    if (remaining <= 0) break

    const normalized = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk
    chunks.push(normalized)
    total += normalized.length

    if (total >= maxBytes) break
  }

  return concatBinaryChunks(chunks)
}

function buildThumbAttemptIndexes(totalCount) {
  const count = Math.max(0, Number(totalCount) || 0)
  if (count <= 0) return []

  const indexes = [count - 1]
  if (count > 1) indexes.push(count - 2)
  if (count > 2) indexes.push(0)
  return Array.from(new Set(indexes))
}

function withPromiseTimeout(promise, timeoutMs, code = 'MEDIA_PREVIEW_FETCH_TIMEOUT') {
  let timeoutId = 0
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ApiError(code, 504, 'Media preview request timed out'))
    }, timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timeoutId)
  })
}

function withLegacySessionCleared(state) {
  return {
    ...state,
    session: '',
    updatedAt: Date.now(),
  }
}

function ensureAuthenticatedUser(user) {
  if (user?.id) return user
  throw new ApiError('APP_AUTH_REQUIRED', 401, 'Google authentication required')
}

async function runWithUserTelegramSession({ env, user, session }, fn) {
  const safeUser = ensureAuthenticatedUser(user)
  const { result, nextSession } = await runWithTelegramClient(env, session || '', fn)
  await saveTelegramSessionForUser(env, safeUser.id, nextSession)
  return { result, nextSession }
}

async function okWithState(data, state, env, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('set-cookie', await buildSessionCookie(withLegacySessionCleared(state), env))
  return json({ ok: true, data }, { ...init, headers })
}

async function errorWithState(err, state, env, user) {
  const mapped = mapApiError(err)
  if (mapped.tgSession && user?.id) {
    await saveTelegramSessionForUser(env, user.id, mapped.tgSession).catch(() => {})
  }

  return json(
    {
      ok: false,
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    },
    {
      status: mapped.status,
    }
  )
}

async function handleSendCode({ request, env, state, user, session }) {
  const safeUser = ensureAuthenticatedUser(user)
  const body = await readJsonBody(request)
  const phoneNumber = toText(body.phoneNumber || body.phone)
  if (!phoneNumber) throw new ApiError('PHONE_NUMBER_INVALID', 400, 'Phone number is required')

  const { result, nextSession } = await runWithTelegramClient(env, session || '', async ({ client, apiId, apiHash }) =>
    sendCodeWithClient(client, apiId, apiHash, phoneNumber)
  )
  await saveTelegramSessionForUser(env, safeUser.id, nextSession)

  const nextState = {
    ...withLegacySessionCleared(state),
    pendingAuth: {
      phoneNumber,
      phoneCodeHash: result.phoneCodeHash,
      createdAt: Date.now(),
    },
  }

  return okWithState({ phoneCodeHash: result.phoneCodeHash }, nextState, env)
}

async function handleSignIn({ request, env, state, user, session }) {
  const safeUser = ensureAuthenticatedUser(user)
  const body = await readJsonBody(request)
  const phoneNumber = toText(body.phoneNumber || body.phone || state.pendingAuth?.phoneNumber)
  const phoneCode = toText(body.phoneCode || body.code)
  const phoneCodeHash = state.pendingAuth?.phoneCodeHash || ''

  if (!phoneNumber || !phoneCode) {
    throw new ApiError('PHONE_CODE_INVALID', 400, 'Phone number and code are required')
  }
  if (!phoneCodeHash) {
    throw new ApiError('CALL_SEND_CODE_FIRST', 400, 'Call sendCode first')
  }

  let nextSessionFromSignIn = session || ''
  try {
    const { nextSession } = await runWithTelegramClient(env, session || '', async ({ client }) =>
      signInWithCode(client, phoneNumber, phoneCodeHash, phoneCode)
    )
    nextSessionFromSignIn = nextSession
  } catch (err) {
    const mapped = mapApiError(err)
    if (mapped.code === 'SESSION_PASSWORD_NEEDED') {
      await saveTelegramSessionForUser(env, safeUser.id, mapped.tgSession || session || '')
      const nextState = {
        ...withLegacySessionCleared(clearPendingAuth(state)),
      }

      return json(
        {
          ok: false,
          error: {
            code: mapped.code,
            message: mapped.message,
          },
        },
        {
          status: mapped.status,
          headers: {
            'set-cookie': await buildSessionCookie(nextState, env),
          },
        }
      )
    }
    throw err
  }
  await saveTelegramSessionForUser(env, safeUser.id, nextSessionFromSignIn)

  const nextState = {
    ...withLegacySessionCleared(clearPendingAuth(state)),
  }

  return okWithState({ authorized: true }, nextState, env)
}

async function handleSignIn2FA({ request, env, state, user, session }) {
  const safeUser = ensureAuthenticatedUser(user)
  const body = await readJsonBody(request)
  const password = toText(body.password)
  if (!password) throw new ApiError('CLOUD_PASSWORD_REQUIRED', 400, 'Cloud password is required')

  const { nextSession } = await runWithTelegramClient(env, session || '', async ({ client, apiId, apiHash }) =>
    signInWithPassword(client, password, apiId, apiHash)
  )
  await saveTelegramSessionForUser(env, safeUser.id, nextSession)

  const nextState = {
    ...withLegacySessionCleared(clearPendingAuth(state)),
  }

  return okWithState({ authorized: true }, nextState, env)
}

async function handleAuthorized({ env, state, user, session }) {
  if (!user?.id) {
    return okWithState(false, withLegacySessionCleared(state), env)
  }

  if (!session) {
    return okWithState(false, withLegacySessionCleared(state), env)
  }

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    try {
      return await client.isUserAuthorized()
    } catch {
      return false
    }
  })

  const nextState = withLegacySessionCleared(state)

  return okWithState(Boolean(result), nextState, env)
}

async function handleGetMe({ env, state, user, session }) {
  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const me = await client.getMe()
    return {
      id: me?.id?.toString?.() || '',
      firstName: me?.firstName || '',
      lastName: me?.lastName || '',
      username: me?.username || '',
    }
  })

  const nextState = withLegacySessionCleared(state)

  return okWithState(result, nextState, env)
}

async function handleGetDialogs({ request, env, state, user, session }) {
  const url = new URL(request.url)
  const limit = clamp(toInt(url.searchParams.get('limit'), 20), 1, 1000)
  const folderRaw = url.searchParams.get('folder')
  const folder = folderRaw === null || folderRaw === '' ? undefined : toInt(folderRaw, 0)

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const options = { limit }
    if (folder !== undefined) options.folder = folder
    const dialogs = await client.getDialogs(options)
    return Array.isArray(dialogs) ? dialogs.map(serializeDialog) : []
  })

  const nextState = withLegacySessionCleared(state)

  return okWithState(result, nextState, env)
}

async function handleGetHistory({ request, env, state, user, session }) {
  const url = new URL(request.url)
  const chatId = toText(url.searchParams.get('chatId'))
  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')

  const limit = clamp(toInt(url.searchParams.get('limit'), 50), 1, 200)
  const offsetId = clamp(toInt(url.searchParams.get('offsetId'), 0), 0, Number.MAX_SAFE_INTEGER)

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    let peerId = chatId
    if (/^-?\d+$/.test(chatId)) {
      try {
        const me = await client.getMe()
        if (me?.id?.toString?.() === chatId) {
          peerId = 'me'
        }
      } catch {
        // noop
      }
    }

    let messages
    try {
      messages = await client.getMessages(peerId, { limit, offsetId })
    } catch (err) {
      const message = String(err?.message || '')
      if (!message.includes('Could not find the input entity')) throw err
      await client.getDialogs({ limit: 200 })
      messages = await client.getMessages(peerId, { limit, offsetId })
    }

    await enrichMessagesWithSenders(messages)
    return Array.isArray(messages) ? messages.map(serializeMessage) : []
  })

  const nextState = withLegacySessionCleared(state)

  return okWithState(result, nextState, env)
}

async function handleGetChatFolders({ env, state, user, session }) {
  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const response = await client.invoke(new Api.messages.GetDialogFilters())
    const filters = Array.isArray(response) ? response : Array.isArray(response?.filters) ? response.filters : []

    return filters
      .filter(item => item?.className === 'DialogFilter' || item?.className === 'DialogFilterChatlist')
      .map(serializeChatFolder)
  })

  const nextState = withLegacySessionCleared(state)

  return okWithState(result, nextState, env)
}

async function handleSendMessage({ request, env, state, user, session }) {
  const body = await readJsonBody(request)
  const chatId = toText(body.chatId)
  const message = typeof body.message === 'string' ? body.message : ''

  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')
  if (!message.trim()) throw new ApiError('MESSAGE_REQUIRED', 400, 'message is required')

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const peer = await resolvePeerEntity(client, chatId, 'sendMessage')
    const stealthScheduleTime = Math.floor(Date.now() / 1000) + 12

    const sendRequest = new Api.messages.SendMessage({
      peer,
      message,
      randomId: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
      scheduleDate: stealthScheduleTime,
      silent: true,
      background: true,
      noWebpage: true,
      clearDraft: true,
    })

    const wrappedRequest = new Api.InvokeWithoutUpdates({ query: sendRequest })

    try {
      await client.invoke(new Api.account.UpdateStatus({ offline: true }))
    } catch {
      // noop
    }
    const response = await client.invoke(wrappedRequest)
    try {
      await client.invoke(new Api.account.UpdateStatus({ offline: true }))
    } catch {
      // noop
    }
    return { acknowledged: true, className: response?.className || 'Updates' }
  })

  const nextState = withLegacySessionCleared(state)

  return okWithState(result, nextState, env)
}

async function handleSendFile({ request, env, state, user, session }) {
  const formData = await request.formData()
  const chatId = toText(formData.get('chatId'))
  const caption = toText(formData.get('caption'))
  const silent = toBoolean(formData.get('silent'), true)
  const forceDocument = toBoolean(formData.get('forceDocument'), false)
  const workers = clamp(toInt(formData.get('workers'), 16), 1, 16)
  const file = formData.get('file')
  const thumbEntry = formData.get('thumb')

  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new ApiError('NO_FILE_PROVIDED', 400, 'No file provided')
  }
  if (!file.size) throw new ApiError('NO_FILE_PROVIDED', 400, 'File is empty')

  const fileName = (typeof file.name === 'string' && file.name.trim()) ? file.name.trim() : 'upload.bin'
  const fileSize = file.size
  const fileMime = toText(file.type) || 'application/octet-stream'
  const fileExt = (fileName.split('.').pop() || '').toLowerCase()
  const isVideo = fileMime.startsWith('video/')
    || /^(mkv|avi|mov|wmv|flv|webm|mp4|m4v|3gp|ts|mts)$/.test(fileExt)

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const peer = await resolvePeerEntity(client, chatId, 'sendFile')

    // Upload main file. GramJS's sendFile→_fileToMedia→uploadFile pipeline has a bug
    // for files > 20MB: it uses file.path ('' = falsy) instead of the buffer.
    // Fix: call uploadFile directly with maxBufferSize > fileSize to force the buffer path.
    const arrayBuffer = await file.arrayBuffer()
    const customFile = new CustomFile(fileName, fileSize, '', Buffer.from(arrayBuffer))
    const fileHandle = await gramUploadFile(client, {
      file: customFile,
      workers,
      maxBufferSize: 2 ** 31,
    })

    // Optional JPEG thumb: GramJS _fileToMedia accepts File or Buffer for thumb (CustomFile is not handled for thumb).
    let thumbPayload = undefined
    if (thumbEntry && typeof thumbEntry.arrayBuffer === 'function' && thumbEntry.size > 0 && thumbEntry.size <= 512 * 1024) {
      try {
        const buf = Buffer.from(await thumbEntry.arrayBuffer())
        if (buf.length > 0) {
          thumbPayload = typeof File !== 'undefined'
            ? new File([buf], 'thumb.jpg', { type: 'image/jpeg' })
            : buf
        }
      } catch {
        // non-fatal
      }
    }
    const message = await client.sendFile(peer, {
      file: fileHandle,
      caption,
      silent,
      forceDocument,
      supportsStreaming: isVideo && !forceDocument,
      thumb: thumbPayload,
      workers: 1,
    })

    if (!message.sender && typeof message.getSender === 'function') {
      try { message.sender = await message.getSender() } catch { /* noop */ }
    }
    return serializeMessage(message)
  })

  const nextState = withLegacySessionCleared(state)
  return okWithState(result, nextState, env)
}

async function handleGetProfilePhoto({ request, env, state, user, session }) {
  const url = new URL(request.url)
  const entityId = toText(url.searchParams.get('entityId') || url.searchParams.get('id'))
  if (!entityId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'entityId is required')

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const peer = await resolvePeerEntity(client, entityId, 'getProfilePhoto')
    const bytes = await client.downloadProfilePhoto(peer, { isBig: false })
    return bytes && bytes.length ? bytes : null
  })

  const nextState = withLegacySessionCleared(state)

  if (!result) {
    return okWithState(null, nextState, env)
  }

  const headers = new Headers({
    'content-type': 'image/jpeg',
    'cache-control': 'private, max-age=300',
    'set-cookie': await buildSessionCookie(nextState, env),
  })
  return new Response(result, { status: 200, headers })
}

async function handleGetMediaPreview({ request, env, state, user, session }) {
  const url = new URL(request.url)
  const chatId = toText(url.searchParams.get('chatId'))
  const messageId = toPositiveInt(url.searchParams.get('messageId') || url.searchParams.get('id'))
  const mode = toText(url.searchParams.get('mode') || url.searchParams.get('quality') || 'fast').toLowerCase()
  const isUltraFastMode = mode === 'ultrafast' || mode === 'quick'
  const isFastMode = isUltraFastMode || (mode !== 'best' && mode !== 'full' && mode !== 'high')
  const cacheEtag = `W/"tg-preview-${PREVIEW_ETAG_VERSION}-${mode || 'fast'}-${chatId || 'unknown'}-${messageId || 0}"`

  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')
  if (!messageId) throw new ApiError('MESSAGE_ID_REQUIRED', 400, 'messageId is required')

  const incomingEtag = request.headers.get('if-none-match')
  if (incomingEtag && incomingEtag === cacheEtag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag: cacheEtag,
        'cache-control': 'private, max-age=86400, immutable',
      },
    })
  }

  const { result } = await runWithUserTelegramSession({ env, user, session }, async ({ client }) => {
    const peer = await resolvePeerEntity(client, chatId, 'getMediaPreview')

    let targetMessage = null

    const resolveByIdCandidates = async () => {
      const attempts = isFastMode
        ? [{ ids: [messageId] }]
        : [
          { ids: [messageId] },
          { ids: messageId },
        ]

      for (const options of attempts) {
        try {
          const result = await client.getMessages(peer, options)
          if (Array.isArray(result)) {
            const matched = result.find(item => toPositiveInt(item?.id) === messageId)
            if (matched) return matched
            if (result[0]) return result[0]
          } else if (result?.id) {
            return result
          }
        } catch (err) {
          console.warn('[TG API] getMediaPreview getMessages(ids) failed:', err?.message || err)
        }
      }

      return null
    }

    targetMessage = await resolveByIdCandidates()

    if (!targetMessage && !isFastMode) {
      // Fallback scan: recent history can still contain the message if ids lookup fails in a specific peer type.
      const recent = await client.getMessages(peer, { limit: 120 })
      if (Array.isArray(recent)) {
        targetMessage = recent.find(item => toPositiveInt(item?.id) === messageId) || null
      }
    }

    if (!targetMessage) {
      throw new ApiError('MEDIA_PREVIEW_NOT_FOUND', 404, 'Message not found for preview')
    }

    const media = targetMessage?.media
    const document = media?.document || null
    const documentMime = toText(media?.document?.mimeType).toLowerCase()
    const documentAttributes = Array.isArray(media?.document?.attributes) ? media.document.attributes : []
    const documentThumbsRaw = Array.isArray(media?.document?.thumbs) ? media.document.thumbs : []
    const documentThumbs = documentThumbsRaw.filter(item => item?.className !== 'PhotoPathSize')
    const documentThumbTypes = documentThumbs
      .map((item, index) => ({
        type: toText(item?.type),
        size: toInt(item?.size, 0),
        index,
      }))
      .filter(item => item.type)
      .sort((a, b) => {
        if (a.size !== b.size) return b.size - a.size
        return a.index - b.index
      })
    const documentVideoThumbsRaw = Array.isArray(media?.document?.videoThumbs) ? media.document.videoThumbs : []
    const documentVideoThumbs = documentVideoThumbsRaw.filter(item => item?.className === 'VideoSize' && toText(item?.type))
    const photoSizes = Array.isArray(media?.photo?.sizes) ? media.photo.sizes : []
    const photoVideoSizes = Array.isArray(media?.photo?.videoSizes) ? media.photo.videoSizes : []
    const photoThumbs = [...photoSizes, ...photoVideoSizes].filter(item => item?.className !== 'PhotoPathSize')
    const filenameAttr = documentAttributes.find(attr => attr?.className === 'DocumentAttributeFilename')
    const fileExtension = getFileExtension(filenameAttr?.fileName)
    const resolvedVideoMime = resolveVideoPreviewMime(documentMime, fileExtension)

    const isPhoto = Boolean(media?.photo)
    const isImageDocument = documentMime.startsWith('image/')
      || documentAttributes.some(attr => attr?.className === 'DocumentAttributeImageSize')
      || IMAGE_EXTENSIONS.has(fileExtension)
    const isVideoDocument = isLikelyVideoMime(documentMime)
      || documentAttributes.some(attr => attr?.className === 'DocumentAttributeVideo')
      || VIDEO_EXTENSIONS.has(fileExtension)
      || Boolean(resolvedVideoMime)
    const availableThumbCount = isPhoto ? photoThumbs.length : documentThumbs.length
    const thumbIndexes = buildThumbAttemptIndexes(availableThumbCount)
    if (!isPhoto && !isImageDocument && !isVideoDocument) {
      console.info('[TG API] getMediaPreview unsupported media type', {
        chatId,
        messageId,
        mime: documentMime,
        extension: fileExtension,
        hasPhoto: Boolean(media?.photo),
        className: media?.className || '',
      })
      throw new ApiError('MEDIA_PREVIEW_UNSUPPORTED', 415, 'Preview is supported only for image/video messages')
    }

    const isPhotoLike = isPhoto || isImageDocument

    let bytes = null
    let bestEffortPhotoThumb = null
    let forcedContentType = ''
    let previewSource = ''

    const attempts = []

    const primaryThumbIndexes = isPhotoLike
      ? thumbIndexes.slice(0, isFastMode ? 1 : 2)
      : []
    primaryThumbIndexes.forEach((thumbIndex, idx) => {
      let timeoutMs = 1_400
      if (isUltraFastMode) {
        timeoutMs = 900
      } else if (!isFastMode) {
        timeoutMs = idx === 0 ? 3_200 : 2_400
      }

      attempts.push({
        workers: 1,
        thumb: thumbIndex,
        timeoutMs,
        source: 'thumb',
      })
    })

    if (isVideoDocument && document && documentThumbTypes.length > 0) {
      const selectedDocumentThumbs = documentThumbTypes.slice(0, isUltraFastMode ? 1 : (isFastMode ? 2 : 4))
      selectedDocumentThumbs.forEach((thumbMeta, idx) => {
        let timeoutMs = 1_300
        if (isUltraFastMode) {
          timeoutMs = 900
        } else if (!isFastMode) {
          timeoutMs = idx === 0 ? 2_400 : 1_800
        } else if (idx > 0) {
          timeoutMs = 1_000
        }

        attempts.push({
          source: 'doc-thumb-file',
          thumbType: thumbMeta.type,
          timeoutMs,
        })
      })
    }

    if (isVideoDocument && documentVideoThumbs.length > 0) {
      const sortedVideoThumbs = [...documentVideoThumbs].sort((a, b) => (Number(b?.size) || 0) - (Number(a?.size) || 0))
      const selectedVideoThumbs = sortedVideoThumbs.slice(0, isUltraFastMode ? 1 : (isFastMode ? 1 : 2))
      selectedVideoThumbs.forEach((videoThumb, idx) => {
        let timeoutMs = 1_600
        if (isUltraFastMode) {
          timeoutMs = 1_000
        } else if (!isFastMode) {
          timeoutMs = idx === 0 ? 2_600 : 2_000
        }

        attempts.push({
          source: 'video-thumb-file',
          thumbType: toText(videoThumb?.type),
          timeoutMs,
        })
      })
    }

    if (isPhotoLike && !isFastMode) {
      // For photo/image messages, use full image as a late fallback to avoid very blurry previews.
      attempts.push({ workers: 1, timeoutMs: 4_200, source: 'full' })
    } else if (attempts.length === 0) {
      if (!isVideoDocument || !document) {
        throw new ApiError('MEDIA_PREVIEW_UNSUPPORTED', 415, 'Video preview is unavailable for this format')
      }
    }

    for (const options of attempts) {
      try {
        const { timeoutMs = 1_800, source = 'thumb', ...downloadOptions } = options
        let downloaded = null

        if (source === 'video-thumb-file' || source === 'doc-thumb-file') {
          const thumbType = toText(options?.thumbType)
          if (!document?.id || !document?.accessHash || !document?.fileReference || !thumbType) {
            continue
          }

          const dcId = toInt(document?.dcId, 0)
          const inputLocation = new Api.InputDocumentFileLocation({
            id: document.id,
            accessHash: document.accessHash,
            fileReference: document.fileReference,
            thumbSize: thumbType,
          })

          downloaded = await withPromiseTimeout(
            client.downloadFile(inputLocation, { dcId: dcId > 0 ? dcId : undefined }),
            timeoutMs
          )
        } else {
          downloaded = await withPromiseTimeout(
            client.downloadMedia(targetMessage, downloadOptions),
            timeoutMs
          )
        }

        if (typeof downloaded === 'string') {
          continue
        }

        if (downloaded && downloaded.length) {
          if (isPhotoLike && source === 'thumb' && downloaded.length < MIN_ACCEPTABLE_PHOTO_PREVIEW_BYTES) {
            if (!bestEffortPhotoThumb || downloaded.length > bestEffortPhotoThumb.length) {
              bestEffortPhotoThumb = downloaded
            }
            continue
          }

          bytes = downloaded
          previewSource = source
          break
        }
      } catch (err) {
        const code = String(err?.errorMessage || err?.code || err?.message || '')
        const isExpectedTransient = code.includes('MEDIA_INVALID')
          || code.includes('FILE_REFERENCE_')
          || code.includes('MEDIA_PREVIEW_FETCH_TIMEOUT')
          || code.includes('TIMEOUT')
        if (isExpectedTransient) {
          continue
        }
        console.warn('[TG API] getMediaPreview download attempt failed:', {
          chatId,
          messageId,
          code,
          options,
          message: err?.message || String(err || ''),
        })
      }
    }

    if (!bytes && bestEffortPhotoThumb) {
      bytes = bestEffortPhotoThumb
      previewSource = 'best-effort-photo-thumb'
    }

    if (!bytes && isVideoDocument && document) {
      try {
        const noTelegramThumbs = documentThumbs.length === 0 && documentVideoThumbs.length === 0
        const isWebmOrMkv = resolvedVideoMime.includes('webm')
          || resolvedVideoMime.includes('matroska')
          || fileExtension === 'webm'
          || fileExtension === 'mkv'

        let sampleMaxBytes = 320 * 1024
        if (isUltraFastMode) {
          sampleMaxBytes = 384 * 1024
        } else if (isFastMode) {
          sampleMaxBytes = 786_432
        } else {
          sampleMaxBytes = 2_097_152
        }
        if (noTelegramThumbs && isWebmOrMkv) {
          if (isUltraFastMode) sampleMaxBytes = 524_288
          else if (isFastMode) sampleMaxBytes = 1_572_864
          else sampleMaxBytes = 10_485_760
        }
        const sampleTimeoutMs = isUltraFastMode ? 2_400 : (isFastMode ? 7_500 : 20_000)
        const sampled = await withPromiseTimeout(
          downloadDocumentHeadSample(client, document, sampleMaxBytes),
          sampleTimeoutMs
        )
        const minHead = isWebmOrMkv && noTelegramThumbs ? 48 * 1024 : 64 * 1024
        if (sampled && sampled.length >= minHead) {
          bytes = sampled
          forcedContentType = resolvedVideoMime || 'video/mp4'
          previewSource = 'video-head-sample'
        }
      } catch (err) {
        console.warn('[TG API] getMediaPreview video sample fallback failed:', {
          chatId,
          messageId,
          error: String(err?.message || err || ''),
        })
      }
    }

    if (!bytes || !bytes.length) {
      console.warn('[TG API] getMediaPreview no bytes after attempts', {
        chatId,
        messageId,
        mime: documentMime,
        extension: fileExtension,
        availableThumbCount,
        documentThumbTypes: documentThumbTypes.map(item => item.type),
        documentVideoThumbTypes: documentVideoThumbs.map(item => toText(item?.type)),
      })
      throw new ApiError('MEDIA_PREVIEW_EMPTY', 404, 'Preview bytes are empty')
    }

    let contentType = detectMediaContentType(bytes, '')
    if (!contentType) {
      if (forcedContentType) {
        contentType = forcedContentType
      } else if (isImageDocument && documentMime) {
        contentType = documentMime
      } else if (isImageDocument && fileExtension) {
        contentType = inferImageMimeByExtension(fileExtension) || 'image/jpeg'
      } else if (isVideoDocument) {
        contentType = resolvedVideoMime || 'video/mp4'
      } else {
        contentType = 'image/jpeg'
      }
    }

    return { bytes, contentType, source: previewSource || 'unknown' }
  })

  const nextState = withLegacySessionCleared(state)

  const headers = new Headers({
    'content-type': result.contentType || 'image/jpeg',
    'cache-control': 'private, max-age=86400, immutable',
    etag: cacheEtag,
    'set-cookie': await buildSessionCookie(nextState, env),
  })
  if (result?.source) {
    headers.set('x-tg-preview-source', result.source)
  }
  return new Response(result.bytes, { status: 200, headers })
}

async function handleLogout({ env, user }) {
  if (user?.id) {
    await clearTelegramSessionForUser(env, user.id)
  }

  return json(
    { ok: true, data: { cleared: true } },
    {
      status: 200,
      headers: {
        'set-cookie': buildClearedSessionCookie(),
      },
    }
  )
}

export async function onRequest(context) {
  const { request, env, params } = context
  const method = request.method.toUpperCase()
  const action = String(params?.action || '')
  const state = await readSessionState(request, env)
  let user = null
  let telegramSession = ''

  try {
    user = await readAuthenticatedUser(request, env)
    telegramSession = user?.id ? await loadTelegramSessionForUser(env, user.id) : ''

    if (method === 'GET' && action === 'authorized') {
      return await handleAuthorized({ env, state, user, session: telegramSession })
    }

    if (method === 'POST' && action === 'logout') {
      return await handleLogout({ env, user })
    }

    if (!user?.id) {
      throw new ApiError('APP_AUTH_REQUIRED', 401, 'Google authentication required')
    }

    if (method === 'POST' && action === 'send-code') {
      return await handleSendCode({ request, env, state, user, session: telegramSession })
    }
    if (method === 'POST' && action === 'sign-in') {
      return await handleSignIn({ request, env, state, user, session: telegramSession })
    }
    if (method === 'POST' && action === 'sign-in-2fa') {
      return await handleSignIn2FA({ request, env, state, user, session: telegramSession })
    }
    if (method === 'GET' && action === 'me') {
      return await handleGetMe({ env, state, user, session: telegramSession })
    }
    if (method === 'GET' && action === 'dialogs') {
      return await handleGetDialogs({ request, env, state, user, session: telegramSession })
    }
    if (method === 'GET' && action === 'history') {
      return await handleGetHistory({ request, env, state, user, session: telegramSession })
    }
    if (method === 'GET' && action === 'chat-folders') {
      return await handleGetChatFolders({ env, state, user, session: telegramSession })
    }
    if (method === 'POST' && action === 'send-message') {
      return await handleSendMessage({ request, env, state, user, session: telegramSession })
    }
    if (method === 'POST' && action === 'send-file') {
      return await handleSendFile({ request, env, state, user, session: telegramSession })
    }
    if (method === 'GET' && action === 'profile-photo') {
      return await handleGetProfilePhoto({ request, env, state, user, session: telegramSession })
    }
    if (method === 'GET' && action === 'media-preview') {
      return await handleGetMediaPreview({ request, env, state, user, session: telegramSession })
    }

    return routeNotFoundResponse()
  } catch (err) {
    return errorWithState(err, state, env, user)
  }
}
