import { Api } from 'telegram'
import { json, readJsonBody, toBoolean, toInt } from './_lib/http.js'
import {
  ApiError,
  enrichMessagesWithSenders,
  makeUploadCustomFile,
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

async function okWithState(data, state, env, init = {}) {
  const headers = new Headers(init.headers || {})
  headers.set('set-cookie', await buildSessionCookie(state, env))
  return json({ ok: true, data }, { ...init, headers })
}

async function errorWithState(err, state, env) {
  const mapped = mapApiError(err)
  const headers = new Headers()

  const nextState = { ...state }
  if (mapped.tgSession) {
    nextState.session = mapped.tgSession
    nextState.updatedAt = Date.now()
    headers.set('set-cookie', await buildSessionCookie(nextState, env))
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
      headers,
    }
  )
}

async function handleSendCode({ request, env, state }) {
  const body = await readJsonBody(request)
  const phoneNumber = toText(body.phoneNumber || body.phone)
  if (!phoneNumber) throw new ApiError('PHONE_NUMBER_INVALID', 400, 'Phone number is required')

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client, apiId, apiHash }) =>
    sendCodeWithClient(client, apiId, apiHash, phoneNumber)
  )

  const nextState = {
    ...state,
    session: nextSession,
    pendingAuth: {
      phoneNumber,
      phoneCodeHash: result.phoneCodeHash,
      createdAt: Date.now(),
    },
    updatedAt: Date.now(),
  }

  return okWithState({ phoneCodeHash: result.phoneCodeHash }, nextState, env)
}

async function handleSignIn({ request, env, state }) {
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

  let nextSessionFromSignIn = state.session
  try {
    const { nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) =>
      signInWithCode(client, phoneNumber, phoneCodeHash, phoneCode)
    )
    nextSessionFromSignIn = nextSession
  } catch (err) {
    const mapped = mapApiError(err)
    if (mapped.code === 'SESSION_PASSWORD_NEEDED') {
      const nextState = {
        ...clearPendingAuth(state),
        session: mapped.tgSession || state.session,
        updatedAt: Date.now(),
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

  const nextState = {
    ...clearPendingAuth(state),
    session: nextSessionFromSignIn,
    updatedAt: Date.now(),
  }

  return okWithState({ authorized: true }, nextState, env)
}

async function handleSignIn2FA({ request, env, state }) {
  const body = await readJsonBody(request)
  const password = toText(body.password)
  if (!password) throw new ApiError('CLOUD_PASSWORD_REQUIRED', 400, 'Cloud password is required')

  const { nextSession } = await runWithTelegramClient(env, state.session, async ({ client, apiId, apiHash }) =>
    signInWithPassword(client, password, apiId, apiHash)
  )

  const nextState = {
    ...clearPendingAuth(state),
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState({ authorized: true }, nextState, env)
}

async function handleAuthorized({ env, state }) {
  if (!state.session) {
    return okWithState(false, state, env)
  }

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
    try {
      return await client.isUserAuthorized()
    } catch {
      return false
    }
  })

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(Boolean(result), nextState, env)
}

async function handleGetMe({ env, state }) {
  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
    const me = await client.getMe()
    return {
      id: me?.id?.toString?.() || '',
      firstName: me?.firstName || '',
      lastName: me?.lastName || '',
      username: me?.username || '',
    }
  })

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(result, nextState, env)
}

async function handleGetDialogs({ request, env, state }) {
  const url = new URL(request.url)
  const limit = clamp(toInt(url.searchParams.get('limit'), 20), 1, 1000)
  const folderRaw = url.searchParams.get('folder')
  const folder = folderRaw === null || folderRaw === '' ? undefined : toInt(folderRaw, 0)

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
    const options = { limit }
    if (folder !== undefined) options.folder = folder
    const dialogs = await client.getDialogs(options)
    return Array.isArray(dialogs) ? dialogs.map(serializeDialog) : []
  })

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(result, nextState, env)
}

async function handleGetHistory({ request, env, state }) {
  const url = new URL(request.url)
  const chatId = toText(url.searchParams.get('chatId'))
  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')

  const limit = clamp(toInt(url.searchParams.get('limit'), 50), 1, 200)
  const offsetId = clamp(toInt(url.searchParams.get('offsetId'), 0), 0, Number.MAX_SAFE_INTEGER)

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
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

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(result, nextState, env)
}

async function handleGetChatFolders({ env, state }) {
  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
    const response = await client.invoke(new Api.messages.GetDialogFilters())
    const filters = Array.isArray(response) ? response : Array.isArray(response?.filters) ? response.filters : []

    return filters
      .filter(item => item?.className === 'DialogFilter' || item?.className === 'DialogFilterChatlist')
      .map(serializeChatFolder)
  })

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(result, nextState, env)
}

async function handleSendMessage({ request, env, state }) {
  const body = await readJsonBody(request)
  const chatId = toText(body.chatId)
  const message = typeof body.message === 'string' ? body.message : ''

  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')
  if (!message.trim()) throw new ApiError('MESSAGE_REQUIRED', 400, 'message is required')

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
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

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(result, nextState, env)
}

async function handleSendFile({ request, env, state }) {
  const formData = await request.formData()
  const chatId = toText(formData.get('chatId'))
  const caption = toText(formData.get('caption'))
  const silent = toBoolean(formData.get('silent'), true)
  const forceDocument = toBoolean(formData.get('forceDocument'), false)
  const workers = clamp(toInt(formData.get('workers'), 4), 1, 16)
  const file = formData.get('file')

  if (!chatId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'chatId is required')
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new ApiError('NO_FILE_PROVIDED', 400, 'No file provided')
  }

  const customFile = await makeUploadCustomFile(file)

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
    const peer = await resolvePeerEntity(client, chatId, 'sendFile')
    const message = await client.sendFile(peer, {
      file: customFile,
      caption,
      silent,
      forceDocument,
      workers,
      supportsStreaming: String(file.type || '').startsWith('video/'),
    })

    if (!message.sender && typeof message.getSender === 'function') {
      try {
        message.sender = await message.getSender()
      } catch {
        // noop
      }
    }
    return serializeMessage(message)
  })

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

  return okWithState(result, nextState, env)
}

async function handleGetProfilePhoto({ request, env, state }) {
  const url = new URL(request.url)
  const entityId = toText(url.searchParams.get('entityId') || url.searchParams.get('id'))
  if (!entityId) throw new ApiError('CHAT_ID_REQUIRED', 400, 'entityId is required')

  const { result, nextSession } = await runWithTelegramClient(env, state.session, async ({ client }) => {
    const peer = await resolvePeerEntity(client, entityId, 'getProfilePhoto')
    const bytes = await client.downloadProfilePhoto(peer, { isBig: false })
    return bytes && bytes.length ? bytes : null
  })

  const nextState = {
    ...state,
    session: nextSession,
    updatedAt: Date.now(),
  }

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

function handleLogout() {
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

  try {
    if (method === 'POST' && action === 'send-code') return await handleSendCode({ request, env, state })
    if (method === 'POST' && action === 'sign-in') return await handleSignIn({ request, env, state })
    if (method === 'POST' && action === 'sign-in-2fa') return await handleSignIn2FA({ request, env, state })
    if (method === 'GET' && action === 'authorized') return await handleAuthorized({ env, state })
    if (method === 'GET' && action === 'me') return await handleGetMe({ env, state })
    if (method === 'GET' && action === 'dialogs') return await handleGetDialogs({ request, env, state })
    if (method === 'GET' && action === 'history') return await handleGetHistory({ request, env, state })
    if (method === 'GET' && action === 'chat-folders') return await handleGetChatFolders({ env, state })
    if (method === 'POST' && action === 'send-message') return await handleSendMessage({ request, env, state })
    if (method === 'POST' && action === 'send-file') return await handleSendFile({ request, env, state })
    if (method === 'GET' && action === 'profile-photo') return await handleGetProfilePhoto({ request, env, state })
    if (method === 'POST' && action === 'logout') return handleLogout()

    return routeNotFoundResponse()
  } catch (err) {
    return errorWithState(err, state, env)
  }
}
