import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { sendCode, signIn, signInWith2FA, isAuthorized } from '../../services/telegramClient'
import { getAuthMe, getGoogleLoginStartUrl, logoutAppSession } from '../../services/authClient'
import VoidOceanBackground from './VoidOceanBackground'

/* ─────────────────────────────────────────────────────────────
   Tiny helpers
───────────────────────────────────────────────────────────── */

function Typewriter({ text, speed = 22, onDone }) {
    const [displayed, setDisplayed] = useState('')
    const idx = useRef(0)

    useEffect(() => {
        idx.current = 0
        setDisplayed('')
        const id = setInterval(() => {
            idx.current += 1
            setDisplayed(text.slice(0, idx.current))
            if (idx.current >= text.length) {
                clearInterval(id)
                onDone?.()
            }
        }, speed)
        return () => clearInterval(id)
    }, [text, speed])

    return <span>{displayed}<span className="vl-cursor">▮</span></span>
}

function extractAuthErrorCode(err) {
    const candidates = [
        err?.code,
        err?.details?.code,
        err?.message,
        err?.details?.message,
        err?.details?.raw,
    ]
        .filter(Boolean)
        .map(value => String(value).trim())

    for (const candidate of candidates) {
        if (!candidate) continue

        const normalizedCandidate = candidate.toUpperCase()

        const explicitHttp = normalizedCandidate.match(/\bHTTP[_\s-]?(\d{3})\b/)
        if (explicitHttp?.[1]) return `HTTP_${explicitHttp[1]}`

        const cloudflareRuntime = normalizedCandidate.match(/\bERROR CODE:\s*(\d{3,4})\b/)
        if (cloudflareRuntime?.[1]) return `CF_${cloudflareRuntime[1]}`

        if (/^CF_\d{3,4}$/.test(normalizedCandidate)) return normalizedCandidate
        if (/^[A-Z][A-Z0-9_]{2,}$/.test(normalizedCandidate)) return normalizedCandidate

        const tokens = normalizedCandidate.match(/[A-Z][A-Z0-9_]{2,}/g) || []
        const ignored = new Set(['ERROR', 'FAILED', 'REQUEST', 'INTERNAL', 'SERVER', 'STATUS', 'CODE'])
        const token = tokens.find(item => !ignored.has(item))
        if (token) return token
    }

    const status = Number(err?.status)
    if (Number.isInteger(status) && status > 0) return `HTTP_${status}`
    return 'UNKNOWN_ERROR'
}

function compactErrorMessage(err) {
    const text = String(
        err?.message
        || err?.details?.message
        || err?.details?.raw
        || ''
    )
        .replace(/\s+/g, ' ')
        .trim()

    if (!text) return ''
    if (text.length <= 120) return text
    return `${text.slice(0, 117)}...`
}

function extractFloodWaitSeconds(err) {
    const text = String(
        err?.message
        || err?.details?.message
        || err?.details?.raw
        || ''
    )
    const explicit = text.match(/FLOOD_WAIT[_\s-]?(\d+)/i)
    if (explicit?.[1]) return Number(explicit[1]) || 0

    const phrase = text.match(/wait of (\d+) seconds/i)
    if (phrase?.[1]) return Number(phrase[1]) || 0
    return 0
}

function withDiagnosticCode(message, code) {
    const safeMessage = String(message || '').trim() || 'REQUEST FAILED'
    const safeCode = String(code || '').trim().toUpperCase()
    if (!safeCode || safeCode === 'UNKNOWN_ERROR') return safeMessage
    if (safeMessage.toUpperCase().includes(safeCode)) return safeMessage
    return `${safeMessage} [${safeCode}]`
}

function isNetworkTimeoutCode(code) {
    return (
        code === 'REQUEST_TIMEOUT'
        || code === 'TELEGRAM_CONNECT_TIMEOUT'
        || code === 'TELEGRAM_SEND_CODE_TIMEOUT'
        || code === 'TELEGRAM_SIGN_IN_TIMEOUT'
        || code === 'TELEGRAM_REQUEST_TIMEOUT'
        || code === 'TELEGRAM_2FA_FETCH_TIMEOUT'
        || code === 'TELEGRAM_2FA_CHECK_TIMEOUT'
        || code === 'HTTP_504'
    )
}

function resolveSendCodeError(err) {
    const code = extractAuthErrorCode(err)

    if (code === 'TELEGRAM_CONFIG_MISSING' || code === 'SESSION_SECRET_MISSING') {
        return withDiagnosticCode('SERVER CONFIG ERROR: TELEGRAM KEYS ARE MISSING', code)
    }
    if (code === 'SUPABASE_CONFIG_MISSING' || code === 'SUPABASE_REQUEST_FAILED') {
        return withDiagnosticCode('SERVER CONFIG ERROR: AUTH STORAGE IS MISCONFIGURED', code)
    }
    if (code === 'API_ID_INVALID' || code === 'API_HASH_INVALID') {
        return withDiagnosticCode('INVALID TELEGRAM API CREDENTIALS', code)
    }
    if (code === 'PHONE_NUMBER_INVALID') {
        return withDiagnosticCode('INVALID PHONE NUMBER FORMAT', code)
    }
    if (code.startsWith('FLOOD_WAIT')) {
        const waitSeconds = extractFloodWaitSeconds(err)
        if (waitSeconds > 0) {
            return withDiagnosticCode(`TOO MANY ATTEMPTS — RETRY IN ${waitSeconds}S`, code)
        }
        return withDiagnosticCode('TOO MANY ATTEMPTS — TRY LATER', code)
    }
    if (isNetworkTimeoutCode(code)) {
        return withDiagnosticCode('NETWORK TIMEOUT — CHECK INTERNET / VPN / FIREWALL', code)
    }
    if (code.startsWith('CF_') || code.startsWith('HTTP_5')) {
        return withDiagnosticCode('SERVER ERROR — RETRY IN 10-20 SECONDS', code)
    }

    const fallback = compactErrorMessage(err)
    return withDiagnosticCode(fallback || 'TRANSMISSION FAILED — CHECK PHONE NUMBER', code)
}

function resolveSignInError(err) {
    const code = extractAuthErrorCode(err)

    if (code === 'SESSION_PASSWORD_NEEDED') {
        return { nextStage: 'password', text: '' }
    }
    if (code === 'PHONE_CODE_INVALID') {
        return { nextStage: 'code', text: withDiagnosticCode('INVALID CODE — TRY AGAIN', code) }
    }
    if (code === 'PHONE_CODE_EXPIRED') {
        return { nextStage: 'phone', text: withDiagnosticCode('CODE EXPIRED — REQUEST A NEW ONE', code) }
    }
    if (code === 'CALL_SEND_CODE_FIRST' || code === 'AUTH_KEY_UNREGISTERED' || code === 'TWO_FA_SESSION_EXPIRED') {
        return { nextStage: 'phone', text: withDiagnosticCode('LOGIN SESSION EXPIRED — REQUEST A NEW CODE', code) }
    }
    if (code.startsWith('FLOOD_WAIT')) {
        const waitSeconds = extractFloodWaitSeconds(err)
        if (waitSeconds > 0) {
            return { nextStage: 'code', text: withDiagnosticCode(`TOO MANY ATTEMPTS — RETRY IN ${waitSeconds}S`, code) }
        }
        return { nextStage: 'code', text: withDiagnosticCode('TOO MANY ATTEMPTS — TRY LATER', code) }
    }
    if (isNetworkTimeoutCode(code)) {
        return { nextStage: 'code', text: withDiagnosticCode('NETWORK TIMEOUT — CHECK INTERNET / VPN / FIREWALL', code) }
    }
    if (code.startsWith('CF_') || code.startsWith('HTTP_5')) {
        return { nextStage: 'code', text: withDiagnosticCode('SERVER ERROR — RETRY IN 10-20 SECONDS', code) }
    }

    const fallback = compactErrorMessage(err)
    return {
        nextStage: 'code',
        text: withDiagnosticCode(fallback || 'AUTHENTICATION FAILED', code),
    }
}

function resolve2FAError(err) {
    const code = extractAuthErrorCode(err)

    if (code === 'PASSWORD_HASH_INVALID') {
        return { nextStage: 'password', text: withDiagnosticCode('WRONG CLOUD PASSWORD — TRY AGAIN', code) }
    }
    if (code === 'CLOUD_PASSWORD_REQUIRED') {
        return { nextStage: 'password', text: withDiagnosticCode('CLOUD PASSWORD REQUIRED', code) }
    }
    if (code === 'TWO_FA_SESSION_EXPIRED' || code === 'AUTH_KEY_UNREGISTERED' || code === 'CALL_SEND_CODE_FIRST') {
        return { nextStage: 'phone', text: withDiagnosticCode('2FA SESSION EXPIRED — REQUEST A NEW CODE', code) }
    }
    if (code.startsWith('FLOOD_WAIT')) {
        const waitSeconds = extractFloodWaitSeconds(err)
        if (waitSeconds > 0) {
            return { nextStage: 'password', text: withDiagnosticCode(`TOO MANY ATTEMPTS — RETRY IN ${waitSeconds}S`, code) }
        }
        return { nextStage: 'password', text: withDiagnosticCode('TOO MANY ATTEMPTS — TRY LATER', code) }
    }
    if (isNetworkTimeoutCode(code)) {
        return { nextStage: 'password', text: withDiagnosticCode('NETWORK TIMEOUT — CHECK INTERNET / VPN / FIREWALL', code) }
    }
    if (code.startsWith('CF_') || code.startsWith('HTTP_5')) {
        return { nextStage: 'password', text: withDiagnosticCode('SERVER ERROR — RETRY IN 10-20 SECONDS', code) }
    }

    const fallback = compactErrorMessage(err)
    return {
        nextStage: 'password',
        text: withDiagnosticCode(fallback || '2FA VERIFICATION FAILED', code),
    }
}

function formatLogTime(timestamp) {
    const iso = String(timestamp || '')
    if (iso.length >= 19 && iso.includes('T')) return iso.slice(11, 19)
    const date = new Date()
    const hh = String(date.getHours()).padStart(2, '0')
    const mm = String(date.getMinutes()).padStart(2, '0')
    const ss = String(date.getSeconds()).padStart(2, '0')
    return `${hh}:${mm}:${ss}`
}

function toLogMetaText(meta, maxLength = 1800) {
    if (meta === undefined || meta === null || meta === '') return ''
    const raw = typeof meta === 'string'
        ? meta
        : (() => {
            try {
                return JSON.stringify(meta, null, 2)
            } catch {
                return String(meta)
            }
        })()
    const compact = String(raw).trim()
    if (!compact) return ''
    if (compact.length <= maxLength) return compact
    return `${compact.slice(0, maxLength - 3)}...`
}

function maskPhone(value) {
    const digits = String(value || '').replace(/\D/g, '')
    if (!digits) return ''
    if (digits.length <= 4) return `+${digits}`
    const head = digits.slice(0, 3)
    const tail = digits.slice(-2)
    return `+${head}***${tail}`
}

function toLogErrorMeta(err) {
    const details = err?.details
    return {
        code: extractAuthErrorCode(err),
        status: Number.isFinite(Number(err?.status)) ? Number(err.status) : null,
        message: compactErrorMessage(err) || String(err?.message || 'unknown error'),
        details: details === undefined ? null : details,
    }
}

function levelColor(level) {
    const safe = String(level || '').toUpperCase()
    if (safe === 'ERROR') return '#a87979'
    if (safe === 'WARN') return '#9b8d75'
    if (safe === 'OK') return '#7e8d86'
    if (safe === 'NET') return '#798697'
    if (safe === 'STATE') return '#848097'
    if (safe === 'INFO') return '#8b96a8'
    return '#7d8798'
}

function buildLogsExportText(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 'NO LOGS YET.'

    return entries.map(entry => {
        const timestamp = String(entry?.timestamp || '').trim()
        const level = String(entry?.level || 'INFO').trim().toUpperCase()
        const message = String(entry?.message || 'EVENT').trim()
        const header = `[${timestamp}] [${level}] ${message}`
        const meta = String(entry?.metaText || '').trim()
        if (!meta) return header
        return `${header}\n${meta}`
    }).join('\n\n')
}

function safeShortText(value, max = 64) {
    const text = String(value || '').trim()
    if (!text) return '—'
    if (text.length <= max) return text
    return `${text.slice(0, max - 3)}...`
}

function accountInitial(user) {
    const name = String(user?.name || '').trim()
    const email = String(user?.email || '').trim()
    const source = name || email || 'G'
    return source.charAt(0).toUpperCase()
}

/* ─────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────── */

export default function VoidLogin() {
    const { showVoidLogin, setShowVoidLogin } = useStore()
    const activePreset = 'Dark'

    /* stages: 'check-auth' | 'appauth' | 'check' | 'boot' | 'phone' | 'sending' | 'code' | 'verifying' | 'password' | 'verifying2fa' | 'success' */
    const [stage, setStage] = useState('boot')
    const [phone, setPhone] = useState('')
    const [code, setCode] = useState('')
    const [twofa, setTwofa] = useState('')
    const [error, setError] = useState('')
    const [closing, setClosing] = useState(false)
    const [statusMsg, setStatusMsg] = useState('')
    const [logs, setLogs] = useState([])
    const [copyLogsState, setCopyLogsState] = useState('idle')
    const [appUser, setAppUser] = useState(null)
    const [showAccountPanel, setShowAccountPanel] = useState(false)
    const [isSigningOutApp, setIsSigningOutApp] = useState(false)
    const [accountImageFailed, setAccountImageFailed] = useState(false)

    const logIdRef = useRef(0)
    const copyStateTimerRef = useRef(0)

    const phoneRef = useRef(null)
    const codeRef = useRef(null)
    const twofaRef = useRef(null)
    const accountPanelRef = useRef(null)

    const appendLog = useCallback((level, message, meta = null) => {
        const id = ++logIdRef.current
        const entry = {
            id,
            timestamp: new Date().toISOString(),
            level: String(level || 'INFO').toUpperCase(),
            message: String(message || '').trim() || 'EVENT',
            metaText: toLogMetaText(meta),
        }
        setLogs(prev => {
            const next = [...prev, entry]
            return next.length > 120 ? next.slice(next.length - 120) : next
        })
    }, [])

    useEffect(() => {
        return () => {
            if (copyStateTimerRef.current) {
                clearTimeout(copyStateTimerRef.current)
            }
        }
    }, [])

    useEffect(() => {
        setAccountImageFailed(false)
    }, [appUser?.picture])

    useEffect(() => {
        if (!showAccountPanel) return
        const handlePointerDown = (event) => {
            if (!accountPanelRef.current) return
            if (!accountPanelRef.current.contains(event.target)) {
                setShowAccountPanel(false)
            }
        }
        window.addEventListener('mousedown', handlePointerDown)
        window.addEventListener('touchstart', handlePointerDown)
        return () => {
            window.removeEventListener('mousedown', handlePointerDown)
            window.removeEventListener('touchstart', handlePointerDown)
        }
    }, [showAccountPanel])

    /* Auto-focus */
    useEffect(() => {
        if (stage === 'phone') setTimeout(() => phoneRef.current?.focus(), 80)
        if (stage === 'code') setTimeout(() => codeRef.current?.focus(), 80)
        if (stage === 'password') setTimeout(() => twofaRef.current?.focus(), 80)
    }, [stage])

    /* Reset + check existing session on every open */
    useEffect(() => {
        if (!showVoidLogin) return
        logIdRef.current = 0
        setLogs([])
        setCopyLogsState('idle')
        setAppUser(null)
        setShowAccountPanel(false)
        setIsSigningOutApp(false)
        setAccountImageFailed(false)
        setPhone('')
        setCode('')
        setTwofa('')
        setError('')
        setClosing(false)
        setStage('check-auth')
        appendLog('INFO', 'VOID LOGIN OPENED')
    }, [showVoidLogin, appendLog])

    useEffect(() => {
        if (!showVoidLogin) return
        appendLog('STATE', `STAGE -> ${String(stage || '').toUpperCase()}`)
    }, [stage, showVoidLogin, appendLog])

    /* Check Google auth session first */
    useEffect(() => {
        if (stage !== 'check-auth') return
        const startedAt = Date.now()
        appendLog('NET', 'GET /api/auth/me START')
        getAuthMe()
            .then(payload => {
                if (payload?.authenticated) {
                    setAccountImageFailed(false)
                    setAppUser(payload?.user || null)
                    appendLog('OK', 'GET /api/auth/me OK', {
                        durationMs: Date.now() - startedAt,
                        authenticated: true,
                    })
                    setStage('check')
                } else {
                    setAppUser(null)
                    setShowAccountPanel(false)
                    appendLog('WARN', 'GET /api/auth/me OK', {
                        durationMs: Date.now() - startedAt,
                        authenticated: false,
                    })
                    setStage('appauth')
                }
            })
            .catch(err => {
                setAppUser(null)
                setShowAccountPanel(false)
                appendLog('ERROR', 'GET /api/auth/me FAILED', {
                    durationMs: Date.now() - startedAt,
                    ...toLogErrorMeta(err),
                })
                setStage('appauth')
            })
    }, [stage, appendLog])

    /* Check if already authorized */
    useEffect(() => {
        if (stage !== 'check') return
        const startedAt = Date.now()
        appendLog('NET', 'GET /api/tg/authorized START')
        isAuthorized()
            .then(ok => {
                if (ok) {
                    appendLog('OK', 'GET /api/tg/authorized OK', {
                        durationMs: Date.now() - startedAt,
                        authorized: true,
                    })
                    setStage('success')
                } else {
                    appendLog('WARN', 'GET /api/tg/authorized OK', {
                        durationMs: Date.now() - startedAt,
                        authorized: false,
                    })
                    setStage('boot')
                }
            })
            .catch(err => {
                appendLog('ERROR', 'GET /api/tg/authorized FAILED', {
                    durationMs: Date.now() - startedAt,
                    ...toLogErrorMeta(err),
                })
                setStage('boot')
            })
    }, [stage, appendLog])

    /* Handle transition to chats upon success */
    useEffect(() => {
        if (stage === 'success') {
            const timer = setTimeout(() => {
                // Instantly unmount the simulation and mount ChatList behind the login screen
                const state = useStore.getState()
                if (state.selectedChatId) {
                    state.setPostLoginView('dashboard')
                } else {
                    state.setPostLoginView('chats')
                }
                setClosing(true)
                setTimeout(() => {
                    setShowVoidLogin(false)
                }, 600)
            }, 1000) // 1 second showing the success badge, then close and show chats
            return () => clearTimeout(timer)
        }
    }, [stage, setShowVoidLogin])

    const scheduleCopyStateReset = useCallback(() => {
        if (copyStateTimerRef.current) clearTimeout(copyStateTimerRef.current)
        copyStateTimerRef.current = setTimeout(() => {
            setCopyLogsState('idle')
        }, 1800)
    }, [])

    const handleCopyLogs = useCallback(async () => {
        const text = buildLogsExportText(logs)

        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(text)
            } else {
                const textArea = document.createElement('textarea')
                textArea.value = text
                textArea.setAttribute('readonly', '')
                textArea.style.position = 'fixed'
                textArea.style.opacity = '0'
                textArea.style.pointerEvents = 'none'
                document.body.appendChild(textArea)
                textArea.select()
                document.execCommand('copy')
                document.body.removeChild(textArea)
            }
            setCopyLogsState('ok')
        } catch {
            setCopyLogsState('error')
        } finally {
            scheduleCopyStateReset()
        }
    }, [logs, scheduleCopyStateReset])

    const handleAppSignOut = useCallback(async () => {
        if (isSigningOutApp) return
        const startedAt = Date.now()
        setIsSigningOutApp(true)
        appendLog('NET', 'POST /api/auth/logout START')

        try {
            await logoutAppSession()
            appendLog('OK', 'POST /api/auth/logout OK', {
                durationMs: Date.now() - startedAt,
            })
            setShowAccountPanel(false)
            setAppUser(null)
            setAccountImageFailed(false)
            setError('')
            setStage('appauth')
        } catch (err) {
            appendLog('ERROR', 'POST /api/auth/logout FAILED', {
                durationMs: Date.now() - startedAt,
                ...toLogErrorMeta(err),
            })
        } finally {
            setIsSigningOutApp(false)
        }
    }, [appendLog, isSigningOutApp])

    if (!showVoidLogin) return null

    /* ── Helpers ────────────────────────────────────────── */

    const handleGoogleLogin = () => {
        setShowAccountPanel(false)
        appendLog('INFO', 'REDIRECTING TO GOOGLE AUTH')
        const nextUrl = getGoogleLoginStartUrl()
        window.location.href = nextUrl
    }

    /* ── Step 1: Send code ────────────────────────────────── */
    const handlePhoneSubmit = async (e) => {
        e.preventDefault()
        setError('')
        const cleaned = phone.trim()
        if (!cleaned.startsWith('+') || cleaned.replace(/\D/g, '').length < 7) {
            setError('INCLUDE COUNTRY CODE  e.g. +7 999 123 45 67')
            return
        }

        setStage('sending')
        setStatusMsg('TRANSMITTING SIGNAL TO TELEGRAM...')
        const startedAt = Date.now()
        appendLog('NET', 'POST /api/tg/send-code START', { phone: maskPhone(cleaned) })

        try {
            await sendCode(cleaned)
            appendLog('OK', 'POST /api/tg/send-code OK', {
                durationMs: Date.now() - startedAt,
                phone: maskPhone(cleaned),
            })
            setStage('code')
        } catch (err) {
            const code = extractAuthErrorCode(err)
            if (code === 'APP_AUTH_REQUIRED') {
                appendLog('WARN', 'POST /api/tg/send-code REQUIRES APP AUTH', {
                    durationMs: Date.now() - startedAt,
                    ...toLogErrorMeta(err),
                })
                setError('')
                setStage('appauth')
                return
            }
            console.error('[VoidLogin] sendCode error:', err)
            appendLog('ERROR', 'POST /api/tg/send-code FAILED', {
                durationMs: Date.now() - startedAt,
                phone: maskPhone(cleaned),
                ...toLogErrorMeta(err),
            })
            setError(resolveSendCodeError(err))
            setStage('phone')
        }
    }

    /* ── Step 2: Verify code ──────────────────────────────── */
    const handleCodeSubmit = async (e) => {
        e.preventDefault()
        setError('')
        if (code.replace(/\D/g, '').length < 4) {
            setError('CODE TOO SHORT')
            return
        }

        setStage('verifying')
        setStatusMsg('VERIFYING QUANTUM KEY...')
        const startedAt = Date.now()
        appendLog('NET', 'POST /api/tg/sign-in START', {
            phone: maskPhone(phone.trim()),
            codeLength: code.trim().length,
        })

        try {
            await signIn(phone.trim(), code.trim())
            appendLog('OK', 'POST /api/tg/sign-in OK', {
                durationMs: Date.now() - startedAt,
                phone: maskPhone(phone.trim()),
            })
            setStage('success')
        } catch (err) {
            const authCode = extractAuthErrorCode(err)
            if (authCode === 'APP_AUTH_REQUIRED') {
                appendLog('WARN', 'POST /api/tg/sign-in REQUIRES APP AUTH', {
                    durationMs: Date.now() - startedAt,
                    ...toLogErrorMeta(err),
                })
                setError('')
                setStage('appauth')
                return
            }
            console.error('[VoidLogin] signIn error:', err)
            appendLog('ERROR', 'POST /api/tg/sign-in FAILED', {
                durationMs: Date.now() - startedAt,
                phone: maskPhone(phone.trim()),
                ...toLogErrorMeta(err),
            })
            const resolved = resolveSignInError(err)
            if (resolved.nextStage === 'password') {
                // 2FA is enabled — show cloud password input.
                appendLog('INFO', '2FA REQUIRED')
                setError('')
                setStage('password')
                return
            }
            setError(resolved.text)
            setStage(resolved.nextStage || 'code')
        }
    }

    /* ── Step 3: 2FA cloud password ──────────────────────── */
    const handle2FASubmit = async (e) => {
        e.preventDefault()
        setError('')
        if (!twofa.trim()) {
            setError('CLOUD PASSWORD REQUIRED')
            return
        }
        setStage('verifying2fa')
        setStatusMsg('VERIFYING CLOUD PASSWORD...')
        const startedAt = Date.now()
        appendLog('NET', 'POST /api/tg/sign-in-2fa START', { passwordLength: twofa.trim().length })
        try {
            await signInWith2FA(twofa)
            appendLog('OK', 'POST /api/tg/sign-in-2fa OK', {
                durationMs: Date.now() - startedAt,
            })
            setStage('success')
        } catch (err) {
            const authCode = extractAuthErrorCode(err)
            if (authCode === 'APP_AUTH_REQUIRED') {
                appendLog('WARN', 'POST /api/tg/sign-in-2fa REQUIRES APP AUTH', {
                    durationMs: Date.now() - startedAt,
                    ...toLogErrorMeta(err),
                })
                setError('')
                setStage('appauth')
                return
            }
            console.error('[VoidLogin] 2FA error:', err)
            appendLog('ERROR', 'POST /api/tg/sign-in-2fa FAILED', {
                durationMs: Date.now() - startedAt,
                ...toLogErrorMeta(err),
            })
            const resolved = resolve2FAError(err)
            setError(resolved.text)
            setStage(resolved.nextStage || 'password')
        }
    }

    const stageTag = (() => {
        if (stage === 'check-auth') return 'APP AUTH CHECK'
        if (stage === 'appauth') return 'GOOGLE SIGN IN'
        if (stage === 'check') return 'SESSION CHECK'
        if (stage === 'boot') return 'READY'
        if (stage === 'phone') return 'PHONE'
        if (stage === 'sending') return 'SENDING'
        if (stage === 'code') return 'CODE'
        if (stage === 'verifying') return 'VERIFYING'
        if (stage === 'password') return '2FA PASSWORD'
        if (stage === 'verifying2fa') return 'VERIFYING 2FA'
        if (stage === 'success') return 'AUTHORIZED'
        return 'AUTH'
    })()

    /* ── JSX ─────────────────────────────────────────────── */
    return (
        <>
            <style>{`
                :root {
                    --vl-bg-a: #010204;
                    --vl-bg-b: #06080d;
                    --vl-bg-c: #0a0f16;
                    --vl-card: #0c1219;
                    --vl-card-soft: #0f1620;
                    --vl-border: rgba(129, 140, 158, 0.24);
                    --vl-border-strong: rgba(129, 140, 158, 0.34);
                    --vl-text: #d0d5de;
                    --vl-muted: #9aa4b2;
                    --vl-soft: #b1bac8;
                    --vl-accent: #7a8291;
                    --vl-accent-soft: rgba(122, 130, 145, 0.16);
                    --vl-danger: #ff7a7a;
                    --vl-horizon-rgb: 122, 130, 145;
                    --vl-cloud-rgb: 34, 35, 51;
                    --vl-dark-horizon: #4476ff;
                    --vl-dark-cloud: #080810;
                    --vl-dark-core: #000002;
                    --vl-dark-tip: #222233;
                }

                @keyframes vl-blink {
                    0%, 50% { opacity: 1; }
                    51%, 100% { opacity: 0; }
                }
                @keyframes vl-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes vl-orb-float {
                    0%, 100% { transform: translate3d(0, 0, 0); }
                    50% { transform: translate3d(0, -18px, 0); }
                }
                @keyframes vl-scanline {
                    0% { transform: translateY(-40px); opacity: 0; }
                    12% { opacity: .55; }
                    100% { transform: translateY(100vh); opacity: 0; }
                }
                @keyframes vl-glitch-a {
                    0%  { clip-path: inset(37% 0 57% 0); transform: translateX(-2px); }
                    30% { clip-path: inset(78% 0 4% 0); transform: translateX(2px); }
                    60% { clip-path: inset(18% 0 70% 0); transform: translateX(-1px); }
                    100%{ clip-path: inset(37% 0 57% 0); transform: translateX(0); }
                }
                @keyframes vl-glitch-b {
                    0%  { clip-path: inset(58% 0 4% 0); transform: translateX(2px); }
                    45% { clip-path: inset(12% 0 82% 0); transform: translateX(-2px); }
                    100%{ clip-path: inset(58% 0 4% 0); transform: translateX(0); }
                }
                @keyframes vl-success-pulse {
                    0%, 100% { box-shadow: 0 0 0 0 rgba(122, 130, 145, .28); }
                    50% { box-shadow: 0 0 0 12px rgba(122, 130, 145, 0); }
                }
                @keyframes vl-backdrop-in {
                    from { opacity: 0; }
                    to { opacity: .42; }
                }
                @keyframes vl-backdrop-out {
                    from { opacity: .42; }
                    to { opacity: 0; }
                }
                @keyframes vl-ocean-in {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes vl-ocean-out {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes vl-shell-in {
                    from {
                        transform: translate3d(0, 14px, 0);
                        opacity: 0;
                    }
                    to {
                        transform: translate3d(0, 0, 0);
                        opacity: 1;
                    }
                }
                @keyframes vl-shell-out {
                    from {
                        transform: translate3d(0, 0, 0);
                        opacity: 1;
                    }
                    to {
                        transform: translate3d(0, 8px, 0);
                        opacity: 0;
                    }
                }
                .vl-root {
                    position: fixed;
                    inset: 0;
                    z-index: 200;
                    overflow: hidden;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    padding: 24px;
                    isolation: isolate;
                }
                .vl-backdrop {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    background: #000;
                    z-index: 0;
                    animation: vl-backdrop-in .42s ease-out both;
                }
                .vl-root.close .vl-backdrop {
                    animation: vl-backdrop-out .24s ease-in both;
                }
                .vl-root[data-active-preset='Dark'] {
                    --vl-horizon-rgb: 68, 118, 255;
                    --vl-cloud-rgb: 34, 35, 51;
                    --vl-bg-b: var(--vl-dark-cloud);
                    --vl-bg-c: var(--vl-dark-tip);
                    --vl-bg-a: var(--vl-dark-core);
                }
                .vl-ocean-canvas {
                    position: absolute;
                    inset: 0;
                    pointer-events: none;
                    z-index: 1;
                    opacity: 0;
                    will-change: opacity;
                    animation: vl-ocean-in .5s ease-out .06s both;
                }
                .vl-root.close .vl-ocean-canvas {
                    animation: vl-ocean-out .2s ease-in both;
                }
                .vl-shell {
                    width: min(720px, calc(100vw - 24px));
                    min-height: auto;
                    border: 0;
                    border-radius: 0;
                    background: transparent;
                    box-shadow: none;
                    backdrop-filter: none;
                    display: block;
                    overflow: visible;
                    position: relative;
                    z-index: 10;
                    will-change: transform, opacity;
                    animation: vl-shell-in .4s cubic-bezier(.22, .61, .36, 1) .04s both;
                }
                .vl-root.close .vl-shell {
                    animation: vl-shell-out .2s ease-in both;
                }
                .vl-shell::after {
                    display: none;
                }

                .vl-brand {
                    padding: clamp(28px, 5vw, 56px);
                    border-right: 1px solid var(--vl-border);
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 26px;
                    position: relative;
                }
                .vl-brand::before {
                    content: '';
                    position: absolute;
                    inset: 0;
                    background:
                        radial-gradient(500px 360px at 20% 5%, rgba(122, 130, 145, .08), transparent 74%);
                    pointer-events: none;
                }
                .vl-kicker {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.74rem;
                    color: rgba(150, 160, 176, .86);
                    letter-spacing: .17em;
                    text-transform: uppercase;
                    position: relative;
                }
                .vl-brand-title {
                    position: relative;
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: clamp(2.3rem, 5.4vw, 4.4rem);
                    line-height: .95;
                    letter-spacing: .04em;
                    font-weight: 700;
                    color: var(--vl-text);
                    text-shadow: 0 16px 48px rgba(0, 0, 0, .45);
                    user-select: none;
                }
                .vl-brand-title .accent {
                    color: #9fa9ba;
                }
                .vl-brand-copy {
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    color: var(--vl-muted);
                    font-size: 1.02rem;
                    line-height: 1.65;
                    max-width: 42ch;
                    margin: 0;
                }
                .vl-brand-points {
                    display: grid;
                    gap: 12px;
                    max-width: 460px;
                }
                .vl-brand-point {
                    border: 1px solid rgba(148, 163, 184, .2);
                    border-radius: 14px;
                    padding: 12px 14px;
                    background: linear-gradient(120deg, rgba(20, 28, 42, .72), rgba(20, 28, 42, .45));
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.8rem;
                    color: #bcc4cf;
                    letter-spacing: .02em;
                }
                .vl-brand-point strong {
                    color: #9fa9ba;
                    font-weight: 500;
                }

                .vl-main {
                    position: relative;
                    padding: 8px;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    gap: 10px;
                }
                .vl-main.vl-main-only {
                    padding: 8px;
                }
                .vl-main-inner {
                    width: 100%;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }

                .vl-account-anchor {
                    position: absolute;
                    top: 22px;
                    right: 24px;
                    z-index: 16;
                }
                .vl-account-button {
                    border: 1px solid var(--vl-border-strong);
                    border-radius: 14px;
                    height: 52px;
                    min-width: 210px;
                    background: linear-gradient(145deg, rgba(14, 20, 29, .96), rgba(10, 15, 23, .97));
                    padding: 0 12px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    cursor: pointer;
                    color: #c2c9d4;
                    transition: border-color .2s, transform .2s, box-shadow .2s;
                    box-shadow: 0 16px 34px rgba(0, 0, 0, .34);
                }
                .vl-account-button:hover {
                    border-color: rgba(122, 130, 145, .58);
                    transform: translateY(-1px);
                    box-shadow: 0 20px 40px rgba(0, 0, 0, .44);
                }
                .vl-account-mini-avatar {
                    width: 32px;
                    height: 32px;
                    border-radius: 999px;
                    border: 1px solid rgba(255, 255, 255, .22);
                    overflow: hidden;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(130deg, rgba(122, 130, 145, .18), rgba(122, 130, 145, .16));
                }
                .vl-account-avatar {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .vl-account-fallback {
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 0.9rem;
                    font-weight: 700;
                    color: #96a3b8;
                    text-transform: uppercase;
                }
                .vl-account-pill-copy {
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    gap: 1px;
                    text-align: left;
                }
                .vl-account-pill-title {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.62rem;
                    text-transform: uppercase;
                    letter-spacing: .09em;
                    color: #9fa9ba;
                }
                .vl-account-pill-mail {
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 0.77rem;
                    color: #bac2cd;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .vl-account-pill-arrow {
                    margin-left: auto;
                    color: rgba(136, 150, 172, .86);
                    font-size: 0.86rem;
                }
                .vl-account-panel {
                    position: absolute;
                    right: 0;
                    top: calc(100% + 10px);
                    width: min(390px, calc(100vw - 36px));
                    border-radius: 18px;
                    border: 1px solid var(--vl-border-strong);
                    background:
                        radial-gradient(400px 220px at 10% -10%, rgba(122, 130, 145, .09), transparent 76%),
                        linear-gradient(160deg, rgba(12, 18, 28, .99), rgba(8, 12, 19, .99));
                    box-shadow: 0 24px 50px rgba(0, 0, 0, .55);
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .vl-account-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 8px;
                }
                .vl-account-top-title {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.62rem;
                    letter-spacing: .12em;
                    text-transform: uppercase;
                    color: #bec6d1;
                }
                .vl-account-top-status {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.58rem;
                    letter-spacing: .08em;
                    text-transform: uppercase;
                    border-radius: 999px;
                    border: 1px solid rgba(122, 130, 145, .45);
                    background: rgba(122, 130, 145, .13);
                    color: #b8c0ce;
                    padding: 3px 8px;
                }
                .vl-account-body {
                    border-radius: 14px;
                    border: 1px solid rgba(148, 163, 184, .18);
                    background: rgba(8, 13, 20, .72);
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }
                .vl-account-head {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .vl-account-head-avatar {
                    width: 44px;
                    height: 44px;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid rgba(148, 163, 184, .32);
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255, 255, 255, .04);
                }
                .vl-account-name {
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 0.95rem;
                    font-weight: 600;
                    color: #d0d5de;
                    line-height: 1.2;
                }
                .vl-account-mail {
                    margin-top: 2px;
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 0.78rem;
                    color: #afb8c6;
                    line-height: 1.2;
                    word-break: break-word;
                }
                .vl-account-info {
                    border-top: 1px solid rgba(148, 163, 184, .22);
                    padding-top: 10px;
                    display: grid;
                    gap: 7px;
                }
                .vl-account-row {
                    display: grid;
                    grid-template-columns: 92px minmax(0, 1fr);
                    align-items: start;
                    gap: 10px;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.67rem;
                    line-height: 1.35;
                }
                .vl-account-key {
                    color: #aab4c3;
                    text-transform: uppercase;
                    letter-spacing: .03em;
                }
                .vl-account-value {
                    color: #96a3b8;
                    text-align: right;
                    word-break: break-word;
                }
                .vl-account-signout {
                    border: 1px solid rgba(255, 122, 122, .52);
                    border-radius: 12px;
                    background: linear-gradient(145deg, rgba(76, 25, 30, .55), rgba(52, 18, 23, .45));
                    color: #ffd7d7;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.66rem;
                    letter-spacing: .08em;
                    text-transform: uppercase;
                    padding: 10px 12px;
                    cursor: pointer;
                    transition: border-color .2s, background .2s;
                }
                .vl-account-signout:hover {
                    border-color: rgba(255, 163, 163, .8);
                    background: linear-gradient(145deg, rgba(92, 28, 34, .64), rgba(58, 19, 26, .52));
                }
                .vl-account-signout:disabled {
                    opacity: .58;
                    cursor: not-allowed;
                }

                .vl-card {
                    width: 100%;
                    border-radius: 16px;
                    border: 1px solid rgba(129, 140, 158, .28);
                    background:
                        radial-gradient(520px 240px at 20% -10%, rgba(122, 130, 145, .07), transparent 74%),
                        linear-gradient(150deg, rgba(12, 18, 28, .5), rgba(8, 12, 19, .42));
                    box-shadow:
                        0 14px 30px rgba(0, 0, 0, .28),
                        inset 0 1px 0 rgba(255, 255, 255, .02);
                    backdrop-filter: none;
                    padding: 18px;
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }
                .vl-card-head {
                    display: flex;
                    flex-direction: column;
                    gap: 9px;
                }
                .vl-card-tag {
                    width: fit-content;
                    border: 1px solid rgba(122, 130, 145, .4);
                    background: rgba(122, 130, 145, .08);
                    color: #b8c1cf;
                    border-radius: 999px;
                    padding: 4px 10px;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.6rem;
                    letter-spacing: .08em;
                    text-transform: uppercase;
                }
                .vl-card-title {
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 1.55rem;
                    letter-spacing: .01em;
                    color: #d0d5de;
                    font-weight: 700;
                    line-height: 1.1;
                }
                .vl-card-subtitle {
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 0.95rem;
                    color: var(--vl-muted);
                    line-height: 1.55;
                    max-width: 44ch;
                }
                .vl-panel {
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }
                .vl-panel-status {
                    border: 1px solid rgba(148, 163, 184, .22);
                    border-radius: 12px;
                    background: rgba(6, 10, 16, .38);
                    padding: 14px;
                    min-height: 84px;
                    justify-content: center;
                }
                .vl-panel-text {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.79rem;
                    line-height: 1.62;
                    letter-spacing: .02em;
                    color: #bcc4cf;
                }
                .vl-panel-text-soft {
                    color: #a6afbe;
                    font-size: 0.72rem;
                }

                .vl-field {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .vl-label {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.64rem;
                    letter-spacing: .08em;
                    text-transform: uppercase;
                    color: #aab3c2;
                }
                .vl-input {
                    width: 100%;
                    border: 1px solid rgba(148, 163, 184, .3);
                    border-radius: 12px;
                    background: rgba(5, 9, 15, .54);
                    color: #d0d5de;
                    font-family: 'Space Grotesk', 'Segoe UI', sans-serif;
                    font-size: 1.02rem;
                    letter-spacing: .02em;
                    outline: none;
                    padding: 12px 14px;
                    transition: border-color .2s, box-shadow .2s, background .2s;
                    caret-color: #808b9c;
                }
                .vl-input:focus {
                    border-color: rgba(122, 130, 145, .62);
                    box-shadow: 0 0 0 3px rgba(122, 130, 145, .1);
                    background: rgba(6, 11, 18, .62);
                }
                .vl-input::placeholder {
                    color: rgba(122, 136, 156, .55);
                }
                .vl-input-code {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    text-align: center;
                    font-size: 1.12rem;
                    letter-spacing: .34em;
                    text-indent: .34em;
                }

                .vl-btn {
                    width: 100%;
                    border: 1px solid rgba(122, 130, 145, .42);
                    border-radius: 12px;
                    background:
                        linear-gradient(112deg, rgba(156, 170, 198, 0) 18%, rgba(156, 170, 198, .14) 50%, rgba(156, 170, 198, 0) 82%) 0 0 / 230% 100% no-repeat,
                        linear-gradient(145deg, rgba(14, 21, 30, .48), rgba(10, 15, 23, .4));
                    color: #c2c9d4;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.74rem;
                    letter-spacing: .1em;
                    text-transform: uppercase;
                    font-weight: 500;
                    padding: 12px 14px;
                    cursor: pointer;
                    box-shadow:
                        0 0 0 1px rgba(148, 163, 184, .05) inset,
                        0 8px 18px rgba(0, 0, 0, .2);
                    transition:
                        border-color .2s ease,
                        box-shadow .2s ease,
                        background-position .55s cubic-bezier(.22, .61, .36, 1),
                        color .2s ease;
                    will-change: background-position;
                }
                .vl-btn:hover {
                    border-color: rgba(122, 130, 145, .62);
                    background-position: 100% 0, 0 0;
                    box-shadow:
                        0 0 0 1px rgba(148, 163, 184, .1) inset,
                        0 11px 22px rgba(0, 0, 0, .24);
                }
                .vl-btn:active {
                    box-shadow:
                        0 0 0 1px rgba(148, 163, 184, .12) inset,
                        0 3px 10px rgba(0, 0, 0, .22),
                        inset 0 2px 4px rgba(0, 0, 0, .28);
                }
                .vl-btn:focus-visible {
                    outline: none;
                    border-color: rgba(122, 130, 145, .72);
                    box-shadow:
                        0 0 0 2px rgba(122, 130, 145, .24),
                        0 10px 20px rgba(0, 0, 0, .22);
                }
                .vl-btn:disabled {
                    opacity: .55;
                    cursor: not-allowed;
                    background-position: 0 0, 0 0;
                    box-shadow:
                        0 0 0 1px rgba(148, 163, 184, .04) inset,
                        0 4px 10px rgba(0, 0, 0, .14);
                }
                .vl-link-btn {
                    background: transparent;
                    border: 0;
                    color: #adb6c5;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.64rem;
                    letter-spacing: .05em;
                    text-transform: uppercase;
                    cursor: pointer;
                    padding: 3px 0 0;
                    transition: color .2s;
                    width: fit-content;
                }
                .vl-link-btn:hover {
                    color: #c0c8d3;
                }

                .vl-footer-note {
                    margin-top: 2px;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.6rem;
                    color: rgba(115, 128, 147, .72);
                    letter-spacing: .06em;
                    text-transform: uppercase;
                }

                .vl-actions-dock {
                    display: flex;
                    gap: 6px;
                    width: min(260px, 100%);
                    margin: 0 auto;
                }
                .vl-void-cta {
                    flex: 1;
                    border: 1px solid rgba(148, 163, 184, .24);
                    border-radius: 8px;
                    height: 28px;
                    background: linear-gradient(130deg, rgba(22, 30, 44, .24), rgba(16, 23, 35, .2));
                    color: #c2cad5;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.5rem;
                    letter-spacing: .07em;
                    text-transform: uppercase;
                    cursor: pointer;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    transition: border-color .2s, transform .15s, background .2s;
                }
                .vl-void-cta:hover {
                    transform: translateY(-1px);
                    border-color: rgba(122, 130, 145, .36);
                }
                .vl-void-cta.active {
                    border-color: rgba(122, 130, 145, .42);
                    background: linear-gradient(130deg, rgba(17, 24, 38, .34), rgba(11, 17, 27, .3));
                }
                .vl-void-cta-fill,
                .vl-void-cta-corner-tr,
                .vl-void-cta-corner-bl {
                    display: none;
                }
                .vl-void-cta-label {
                    line-height: 1;
                }

                .vl-logs-panel {
                    position: absolute;
                    left: 24px;
                    bottom: 24px;
                    width: min(840px, calc(100vw - 48px));
                    max-height: min(58vh, 520px);
                    border-radius: 18px;
                    border: 1px solid var(--vl-border-strong);
                    background:
                        radial-gradient(500px 220px at 10% -10%, rgba(122, 130, 145, .09), transparent 72%),
                        linear-gradient(160deg, rgba(10, 14, 22, .99), rgba(7, 11, 17, .99));
                    box-shadow: 0 24px 52px rgba(0, 0, 0, .6);
                    z-index: 14;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    backdrop-filter: blur(8px);
                }
                .vl-logs-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 10px;
                    padding: 12px 14px;
                    border-bottom: 1px solid rgba(148, 163, 184, .23);
                }
                .vl-logs-title {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.67rem;
                    letter-spacing: .11em;
                    text-transform: uppercase;
                    color: #bec6d1;
                }
                .vl-logs-actions {
                    display: flex;
                    gap: 8px;
                }
                .vl-log-clear {
                    border: 1px solid rgba(148, 163, 184, .45);
                    border-radius: 10px;
                    background: rgba(19, 28, 42, .72);
                    color: #c0c8d3;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.62rem;
                    letter-spacing: .08em;
                    text-transform: uppercase;
                    padding: 7px 11px;
                    cursor: pointer;
                    transition: border-color .2s, background .2s;
                }
                .vl-log-clear:hover {
                    border-color: rgba(122, 130, 145, .58);
                    background: rgba(16, 24, 34, .7);
                }
                .vl-logs-list {
                    padding: 12px 14px;
                    overflow: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .vl-logs-item {
                    border: 1px solid rgba(148, 163, 184, .18);
                    border-radius: 10px;
                    background: rgba(10, 15, 24, .62);
                    padding: 9px 10px;
                }
                .vl-logs-main {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.79rem;
                    line-height: 1.6;
                    color: #96a3b8;
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                .vl-logs-meta {
                    margin-top: 6px;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.73rem;
                    line-height: 1.6;
                    color: #9aa3b1;
                    white-space: pre-wrap;
                    word-break: break-word;
                }
                .vl-logs-empty {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.76rem;
                    color: #a6afbe;
                    padding: 18px 6px;
                }

                .vl-loading {
                    border: 1px solid rgba(148, 163, 184, .26);
                    border-radius: 14px;
                    background: rgba(8, 12, 20, .56);
                    padding: 20px 16px;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 16px;
                }
                .vl-spinner {
                    width: 34px;
                    height: 34px;
                    border: 2px solid rgba(148, 163, 184, .28);
                    border-top-color: #808b9c;
                    border-radius: 50%;
                    animation: vl-spin .9s linear infinite;
                }
                .vl-loading-text {
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.72rem;
                    color: #aeb7c3;
                    letter-spacing: .06em;
                    text-transform: uppercase;
                    text-align: center;
                    line-height: 1.6;
                }
                .vl-cursor {
                    margin-left: 2px;
                    color: #a2abb9;
                    animation: vl-blink 1s step-end infinite;
                }

                .vl-error-line {
                    border: 1px solid rgba(255, 122, 122, .46);
                    border-radius: 10px;
                    background: rgba(84, 22, 28, .35);
                    color: #ffd0d0;
                    font-family: 'JetBrains Mono', 'Consolas', monospace;
                    font-size: 0.68rem;
                    letter-spacing: .03em;
                    line-height: 1.5;
                    padding: 9px 10px;
                    text-transform: uppercase;
                }
                .vl-success {
                    width: 62px;
                    height: 62px;
                    border-radius: 999px;
                    border: 1px solid rgba(122, 130, 145, .55);
                    background: radial-gradient(circle at 35% 25%, rgba(122, 130, 145, .24), rgba(7, 10, 18, .72));
                    color: #b9c2d0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 1.55rem;
                    animation: vl-success-pulse 1.45s ease infinite;
                }

                .vl-glitch::before,
                .vl-glitch::after {
                    content: attr(data-text);
                    position: absolute;
                    inset: 0;
                }
                .vl-glitch::before {
                    color: rgba(126, 137, 156, .58);
                    text-shadow: 2px 0 rgba(122, 130, 145, .25);
                    animation: vl-glitch-a .14s steps(2) forwards;
                }
                .vl-glitch::after {
                    color: rgba(144, 157, 178, .58);
                    text-shadow: -2px 0 rgba(122, 130, 145, .22);
                    animation: vl-glitch-b .14s steps(2) forwards;
                }

                @media (prefers-reduced-motion: reduce) {
                    .vl-root,
                    .vl-backdrop,
                    .vl-success,
                    .vl-shell,
                    .vl-card,
                    .vl-glitch::before,
                    .vl-glitch::after {
                        animation: none !important;
                    }
                }

                @media (max-width: 1090px) {
                    .vl-shell {
                        grid-template-columns: 1fr;
                        min-height: auto;
                    }
                    .vl-brand {
                        border-right: 0;
                        border-bottom: 1px solid var(--vl-border);
                        gap: 18px;
                    }
                    .vl-account-anchor {
                        top: 18px;
                        right: 18px;
                    }
                    .vl-main {
                        padding-top: 88px;
                    }
                }
                @media (max-width: 760px) {
                    .vl-root {
                        padding: 10px;
                    }
                    .vl-shell {
                        width: calc(100vw - 20px);
                        border-radius: 16px;
                    }
                    .vl-brand {
                        padding: 18px 16px;
                    }
                    .vl-brand-copy {
                        font-size: 0.92rem;
                    }
                    .vl-main {
                        padding: 76px 16px 16px;
                    }
                    .vl-card {
                        border-radius: 16px;
                        padding: 16px;
                    }
                    .vl-card-title {
                        font-size: 1.35rem;
                    }
                    .vl-actions-dock {
                        width: 100%;
                    }
                    .vl-void-cta {
                        height: 38px;
                        font-size: 0.64rem;
                        letter-spacing: .08em;
                    }
                    .vl-account-button {
                        min-width: 54px;
                        width: 54px;
                        border-radius: 12px;
                        justify-content: center;
                        padding: 0;
                    }
                    .vl-account-pill-copy,
                    .vl-account-pill-arrow {
                        display: none;
                    }
                    .vl-logs-panel {
                        left: 10px;
                        right: 10px;
                        width: auto;
                        bottom: 10px;
                        max-height: 62vh;
                    }
                }
            `}</style>

            <div className={`vl-root ${closing ? 'close' : ''}`} data-active-preset={activePreset}>
                <div className="vl-backdrop" />
                <VoidOceanBackground activePreset={activePreset} />

                <div className="vl-shell">
                    <section className="vl-main vl-main-only">

                        <div className="vl-main-inner">
                            <div className="vl-card">
                                <div className="vl-card-head">
                                    <span className="vl-card-tag">{stageTag}</span>
                                    <div className="vl-card-title">Access Gateway</div>
                                    <div className="vl-card-subtitle">
                                        Authenticate your application profile and continue with Telegram secure session.
                                    </div>
                                </div>

                                {(stage === 'check-auth' || stage === 'check' || stage === 'boot') && (
                                    <div className="vl-panel vl-panel-status">
                                        <div className="vl-panel-text">
                                            {stage === 'check-auth' && (
                                                <Typewriter text="> Checking Google identity provider session..." speed={24} />
                                            )}
                                            {stage === 'check' && (
                                                <Typewriter text="> Checking existing Telegram authorization..." speed={24} />
                                            )}
                                            {stage === 'boot' && (
                                                <Typewriter
                                                    text="> No active Telegram session found. Provide phone number to establish secure channel."
                                                    speed={18}
                                                    onDone={() => setTimeout(() => setStage('phone'), 320)}
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {stage === 'appauth' && (
                                    <div className="vl-panel">
                                        <div className="vl-panel-text">
                                            Google sign-in is required before Telegram login.
                                            <br />
                                            <span className="vl-panel-text-soft">
                                                We use Google session to load your encrypted Telegram state from storage.
                                            </span>
                                        </div>

                                        <button type="button" className="vl-btn" onClick={handleGoogleLogin} id="void-google-login">
                                            Continue with Google
                                        </button>
                                    </div>
                                )}

                                {stage === 'phone' && (
                                    <form className="vl-panel" onSubmit={handlePhoneSubmit}>
                                        <div className="vl-field">
                                            <label className="vl-label" htmlFor="void-phone-input">
                                                Telegram phone number
                                            </label>
                                            <input
                                                ref={phoneRef}
                                                className="vl-input"
                                                id="void-phone-input"
                                                type="tel"
                                                value={phone}
                                                onChange={e => { setPhone(e.target.value); setError('') }}
                                                placeholder="+7 999 123 45 67"
                                                autoComplete="tel"
                                            />
                                        </div>

                                        {error && <ErrorLine text={error} />}

                                        <button type="submit" className="vl-btn" id="void-phone-submit">
                                            Send code
                                        </button>
                                    </form>
                                )}

                                {stage === 'sending' && (
                                    <Loading text={statusMsg} />
                                )}

                                {stage === 'code' && (
                                    <form className="vl-panel" onSubmit={handleCodeSubmit}>
                                        <div className="vl-panel-text">
                                            Verification code sent to <strong>{phone}</strong>.
                                            <br />
                                            <span className="vl-panel-text-soft">Open Telegram app or SMS and enter the received code.</span>
                                        </div>

                                        <div className="vl-field">
                                            <label className="vl-label" htmlFor="void-code-input">
                                                One-time code
                                            </label>
                                            <input
                                                ref={codeRef}
                                                className="vl-input vl-input-code"
                                                id="void-code-input"
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={8}
                                                value={code}
                                                onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
                                                placeholder="_ _ _ _ _ _"
                                            />
                                        </div>

                                        {error && <ErrorLine text={error} />}

                                        <button type="submit" className="vl-btn" id="void-code-submit">
                                            Verify code
                                        </button>
                                        <button
                                            type="button"
                                            className="vl-link-btn"
                                            onClick={() => { setStage('phone'); setCode(''); setError('') }}
                                        >
                                            Change phone number
                                        </button>
                                    </form>
                                )}

                                {stage === 'verifying' && (
                                    <Loading text={statusMsg} />
                                )}

                                {stage === 'password' && (
                                    <form className="vl-panel" onSubmit={handle2FASubmit}>
                                        <div className="vl-panel-text">
                                            Two-factor authentication is enabled for this Telegram account.
                                            <br />
                                            <span className="vl-panel-text-soft">Enter your Telegram cloud password to continue.</span>
                                        </div>

                                        <div className="vl-field">
                                            <label className="vl-label" htmlFor="void-2fa-input">
                                                Cloud password
                                            </label>
                                            <input
                                                ref={twofaRef}
                                                className="vl-input"
                                                id="void-2fa-input"
                                                type="password"
                                                value={twofa}
                                                onChange={e => { setTwofa(e.target.value); setError('') }}
                                                placeholder="••••••••"
                                                autoComplete="current-password"
                                            />
                                        </div>

                                        {error && <ErrorLine text={error} />}

                                        <button type="submit" className="vl-btn" id="void-2fa-submit">
                                            Verify and enter
                                        </button>
                                    </form>
                                )}

                                {stage === 'verifying2fa' && (
                                    <Loading text={statusMsg} />
                                )}

                                {stage === 'success' && (
                                    <div className="vl-panel" style={{ alignItems: 'center', textAlign: 'center' }}>
                                        <div className="vl-success">✓</div>
                                        <div className="vl-panel-text">
                                            Connection established.
                                            <br />
                                            <span className="vl-panel-text-soft">Redirecting to your workspace...</span>
                                        </div>
                                    </div>
                                )}

                                {(stage === 'phone' || stage === 'code' || stage === 'password') && (
                                    <div className="vl-footer-note">
                                        Telegram MTProto · End-to-end encrypted
                                    </div>
                                )}
                            </div>

                        </div>
                    </section>
                </div>
            </div>
        </>
    )
}

/* ── Sub-components ───────────────────────────────────────── */

function Loading({ text }) {
    return (
        <div className="vl-loading">
            <div className="vl-spinner" />
            <div className="vl-loading-text">
                <Typewriter text={text} speed={28} />
            </div>
        </div>
    )
}

function ErrorLine({ text }) {
    return (
        <div className="vl-error-line">
            {text}
        </div>
    )
}
