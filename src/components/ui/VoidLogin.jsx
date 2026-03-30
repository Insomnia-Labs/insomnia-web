import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store/useStore'
import { sendCode, signIn, signInWith2FA, isAuthorized } from '../../services/telegramClient'
import { getAuthMe, getGoogleLoginStartUrl, logoutAppSession } from '../../services/authClient'

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
    if (safe === 'ERROR') return '#f87171'
    if (safe === 'WARN') return '#fbbf24'
    if (safe === 'OK') return '#34d399'
    if (safe === 'NET') return '#7dd3fc'
    if (safe === 'STATE') return '#c4b5fd'
    if (safe === 'INFO') return '#e5e7eb'
    return '#cbd5e1'
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

    /* stages: 'check-auth' | 'appauth' | 'check' | 'boot' | 'phone' | 'sending' | 'code' | 'verifying' | 'password' | 'verifying2fa' | 'success' */
    const [stage, setStage] = useState('boot')
    const [phone, setPhone] = useState('')
    const [code, setCode] = useState('')
    const [twofa, setTwofa] = useState('')
    const [error, setError] = useState('')
    const [glitch, setGlitch] = useState(false)
    const [closing, setClosing] = useState(false)
    const [statusMsg, setStatusMsg] = useState('')
    const [showLogs, setShowLogs] = useState(false)
    const [logs, setLogs] = useState([])
    const [copyLogsState, setCopyLogsState] = useState('idle')
    const [appUser, setAppUser] = useState(null)
    const [showAccountPanel, setShowAccountPanel] = useState(false)
    const [isSigningOutApp, setIsSigningOutApp] = useState(false)

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

    /* Periodic glitch */
    useEffect(() => {
        if (!showVoidLogin) return
        const id = setInterval(() => {
            setGlitch(true)
            setTimeout(() => setGlitch(false), 160)
        }, 3200)
        return () => clearInterval(id)
    }, [showVoidLogin])

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
        setShowLogs(false)
        setCopyLogsState('idle')
        setAppUser(null)
        setShowAccountPanel(false)
        setIsSigningOutApp(false)
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

    const handleClose = () => {
        setShowAccountPanel(false)
        setClosing(true)
        setTimeout(() => setShowVoidLogin(false), 600)
    }

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

    /* ── JSX ─────────────────────────────────────────────── */
    return (
        <>
            <style>{`
                @keyframes vl-scanline {
                    0%   { transform: translateY(-100%); }
                    100% { transform: translateY(100vh); }
                }
                @keyframes vl-flicker {
                    0%,19%,21%,23%,25%,54%,56%,100% { opacity:1; }
                    20%,24%,55% { opacity:.35; }
                }
                @keyframes vl-blink {
                    0%,50%  { opacity:1; }
                    51%,100%{ opacity:0; }
                }
                @keyframes vl-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes vl-fadein {
                    from { opacity:0; transform: translateY(14px); }
                    to   { opacity:1; transform: translateY(0); }
                }
                @keyframes vl-glitch-a {
                    0%  { clip-path:inset(40% 0 61% 0); transform:translateX(-4px); }
                    33% { clip-path:inset(80% 0 5%  0); transform:translateX( 4px); }
                    66% { clip-path:inset(10% 0 80% 0); transform:translateX(-2px); }
                    100%{ clip-path:inset(40% 0 61% 0); transform:translateX(0);   }
                }
                @keyframes vl-glitch-b {
                    0%  { clip-path:inset(60% 0 1%  0); transform:translateX( 4px); }
                    50% { clip-path:inset(10% 0 85% 0); transform:translateX(-4px); }
                    100%{ clip-path:inset(60% 0 1%  0); transform:translateX(0);   }
                }
                @keyframes vl-success-pulse {
                    0%,100%{ opacity:1; transform:scale(1);    }
                    50%    { opacity:.6; transform:scale(1.05); }
                }

                .vl-root       { animation: vl-fadein .5s ease forwards; }
                .vl-root.close { animation: vl-fadein .5s ease reverse forwards; }
                .vl-scanline   { animation: vl-scanline 7s linear infinite; }
                .vl-flicker    { animation: vl-flicker 4s step-end infinite; }
                .vl-cursor     { animation: vl-blink 1s step-end infinite; color:#a78bfa; margin-left:2px; }
                .vl-spinner    { animation: vl-spin 1s linear infinite; }
                .vl-panel      { animation: vl-fadein .35s ease forwards; }
                .vl-success    { animation: vl-success-pulse 1.6s ease infinite; }

                .vl-glitch::before,
                .vl-glitch::after {
                    content: attr(data-text);
                    position: absolute; inset:0;
                }
                .vl-glitch::before { animation: vl-glitch-a .15s steps(3) forwards; color:#60a5fa; text-shadow: 2px 0 #ef4444; }
                .vl-glitch::after  { animation: vl-glitch-b .15s steps(3) forwards; color:#f472b6; text-shadow:-2px 0 #22d3ee; }

                .vl-input {
                    background: transparent;
                    border: none;
                    border-bottom: 1px solid rgba(139,92,246,.5);
                    color: #e2d9f3;
                    font-family: 'Courier New', monospace;
                    font-size: 1.05rem;
                    letter-spacing: .15em;
                    outline: none;
                    width: 100%;
                    padding: 8px 2px;
                    transition: border-color .3s;
                    caret-color: #a78bfa;
                }
                .vl-input:focus { border-bottom-color: rgba(139,92,246,.85); }
                .vl-input::placeholder { color: rgba(139,92,246,.42); }

                .vl-btn {
                    position: relative; overflow: hidden;
                    border: 1px solid rgba(139,92,246,.58);
                    background: transparent;
                    color: rgba(167,139,250,.9);
                    font-family: 'Courier New', monospace;
                    font-size: .68rem;
                    letter-spacing: .35em; text-transform: uppercase;
                    padding: 12px 32px; cursor: pointer;
                    transition: color .4s, border-color .4s;
                    width: 100%;
                }
                .vl-btn::before {
                    content:''; position:absolute; inset:0;
                    background: rgba(139,92,246,.14);
                    transform:scaleX(0); transform-origin:left;
                    transition: transform .4s ease;
                }
                .vl-btn:hover::before { transform:scaleX(1); }
                .vl-btn:hover { color:#e2d9f3; border-color:rgba(139,92,246,.9); }
                .vl-btn:disabled { opacity:.4; cursor:not-allowed; }
                .vl-btn:disabled::before { display:none; }

                .vl-link-btn {
                    background: transparent; border: none;
                    color: rgba(139,92,246,.48); cursor: pointer;
                    font-family: 'Courier New', monospace;
                    font-size: .6rem; letter-spacing: .3em; text-transform: uppercase;
                    padding: 8px 0; transition: color .3s; width: 100%;
                }
                .vl-link-btn:hover { color: rgba(139,92,246,.75); }

                .vl-actions-dock {
                    position: absolute;
                    left: 24px;
                    bottom: 24px;
                    z-index: 12;
                    display: flex;
                    gap: 6px;
                    flex-wrap: wrap;
                }
                .vl-void-cta {
                    pointer-events: auto;
                    position: relative;
                    padding: 7px 20px;
                    background: transparent;
                    border: 1px solid rgba(255,255,255,.2);
                    overflow: hidden;
                    cursor: pointer;
                    transition: border-color .5s;
                    min-width: 188px;
                }
                .vl-void-cta-fill {
                    position: absolute;
                    inset: 0;
                    background: rgba(255,255,255,1);
                    transform: translateY(100%);
                    transition: transform .5s cubic-bezier(0.87, 0, 0.13, 1);
                }
                .vl-void-cta:hover,
                .vl-void-cta.active {
                    border-color: rgba(255,255,255,.82);
                }
                .vl-void-cta:hover .vl-void-cta-fill {
                    transform: translateY(0);
                }
                .vl-void-cta-label {
                    position: relative;
                    font-family: 'Courier New', monospace;
                    font-size: 12px;
                    font-weight: 400;
                    letter-spacing: .18em;
                    color: rgba(255,255,255,.86);
                    line-height: 1.15;
                    text-transform: uppercase;
                    transition: color .5s;
                    white-space: nowrap;
                }
                .vl-void-cta:hover .vl-void-cta-label {
                    color: rgba(0,0,0,.95);
                }
                .vl-void-cta-corner-tr,
                .vl-void-cta-corner-bl {
                    position: absolute;
                    width: 8px;
                    height: 8px;
                    transition: border-color .5s;
                }
                .vl-void-cta-corner-tr {
                    top: 0;
                    right: 0;
                    border-top: 1px solid rgba(255,255,255,.5);
                    border-right: 1px solid rgba(255,255,255,.5);
                }
                .vl-void-cta-corner-bl {
                    bottom: 0;
                    left: 0;
                    border-bottom: 1px solid rgba(255,255,255,.5);
                    border-left: 1px solid rgba(255,255,255,.5);
                }
                .vl-void-cta:hover .vl-void-cta-corner-tr,
                .vl-void-cta:hover .vl-void-cta-corner-bl {
                    border-color: rgba(0,0,0,.95);
                }

                .vl-logs-panel {
                    position: absolute;
                    left: 24px;
                    bottom: 90px;
                    width: min(680px, calc(100vw - 88px));
                    max-height: min(58vh, 540px);
                    border: 1px solid rgba(255,255,255,.24);
                    background: linear-gradient(180deg, rgba(6,10,20,.96) 0%, rgba(3,5,12,.97) 100%);
                    box-shadow: 0 24px 50px rgba(0,0,0,.5);
                    backdrop-filter: blur(6px);
                    z-index: 11;
                    display: flex;
                    flex-direction: column;
                }
                .vl-logs-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 11px 12px;
                    border-bottom: 1px solid rgba(255,255,255,.15);
                    font-family: 'Courier New', monospace;
                    font-size: .68rem;
                    letter-spacing: .14em;
                    text-transform: uppercase;
                    color: rgba(255,255,255,.9);
                }
                .vl-logs-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .vl-log-clear {
                    background: transparent;
                    border: 1px solid rgba(255,255,255,.25);
                    color: rgba(255,255,255,.78);
                    cursor: pointer;
                    font-family: 'Courier New', monospace;
                    font-size: .62rem;
                    letter-spacing: .1em;
                    text-transform: uppercase;
                    padding: 5px 10px;
                    transition: border-color .2s, color .2s, background .2s;
                }
                .vl-log-clear:hover {
                    border-color: rgba(255,255,255,.62);
                    color: #fff;
                    background: rgba(255,255,255,.08);
                }
                .vl-logs-list {
                    padding: 12px;
                    overflow: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 11px;
                }
                .vl-logs-item {
                    border-left: 2px solid rgba(255,255,255,.25);
                    padding-left: 10px;
                }
                .vl-logs-main {
                    font-family: 'Courier New', monospace;
                    font-size: .74rem;
                    letter-spacing: .02em;
                    color: rgba(255,255,255,.92);
                    line-height: 1.6;
                    white-space: pre-wrap;
                }
                .vl-logs-meta {
                    margin-top: 5px;
                    font-family: 'Courier New', monospace;
                    font-size: .68rem;
                    letter-spacing: .01em;
                    color: rgba(189,225,255,.94);
                    white-space: pre-wrap;
                    word-break: break-word;
                    line-height: 1.62;
                }

                .vl-account-anchor {
                    position: absolute;
                    top: 20px;
                    right: 20px;
                    z-index: 14;
                }
                .vl-account-button {
                    width: 42px;
                    height: 42px;
                    border-radius: 999px;
                    border: 1px solid rgba(255,255,255,.34);
                    background: rgba(15,20,35,.66);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    overflow: hidden;
                    transition: border-color .2s, box-shadow .2s, transform .2s;
                    box-shadow: 0 8px 20px rgba(0,0,0,.35);
                }
                .vl-account-button:hover {
                    border-color: rgba(255,255,255,.68);
                    box-shadow: 0 10px 24px rgba(0,0,0,.45);
                    transform: translateY(-1px);
                }
                .vl-account-avatar {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }
                .vl-account-fallback {
                    font-family: 'Courier New', monospace;
                    font-size: .92rem;
                    color: rgba(255,255,255,.92);
                    letter-spacing: .08em;
                    text-transform: uppercase;
                }
                .vl-account-panel {
                    position: absolute;
                    top: calc(100% + 10px);
                    right: 0;
                    width: min(320px, calc(100vw - 34px));
                    border: 1px solid rgba(255,255,255,.24);
                    background: linear-gradient(180deg, rgba(8,14,30,.98) 0%, rgba(4,7,18,.98) 100%);
                    box-shadow: 0 20px 42px rgba(0,0,0,.5);
                    padding: 12px;
                    display: flex;
                    flex-direction: column;
                    gap: 10px;
                }
                .vl-account-head {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .vl-account-head-avatar {
                    width: 36px;
                    height: 36px;
                    border-radius: 999px;
                    overflow: hidden;
                    border: 1px solid rgba(255,255,255,.3);
                    flex-shrink: 0;
                    background: rgba(255,255,255,.08);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .vl-account-name {
                    font-family: 'Courier New', monospace;
                    font-size: .72rem;
                    color: rgba(255,255,255,.95);
                    letter-spacing: .08em;
                    line-height: 1.35;
                    text-transform: uppercase;
                }
                .vl-account-mail {
                    font-family: 'Courier New', monospace;
                    font-size: .62rem;
                    color: rgba(208,227,255,.92);
                    letter-spacing: .02em;
                    line-height: 1.3;
                    word-break: break-word;
                }
                .vl-account-info {
                    border-top: 1px solid rgba(255,255,255,.14);
                    border-bottom: 1px solid rgba(255,255,255,.14);
                    padding: 8px 0;
                    display: flex;
                    flex-direction: column;
                    gap: 5px;
                }
                .vl-account-row {
                    display: flex;
                    justify-content: space-between;
                    gap: 12px;
                    font-family: 'Courier New', monospace;
                    font-size: .58rem;
                    letter-spacing: .04em;
                    line-height: 1.35;
                }
                .vl-account-key {
                    color: rgba(182,202,245,.74);
                    text-transform: uppercase;
                }
                .vl-account-value {
                    color: rgba(255,255,255,.92);
                    text-align: right;
                    word-break: break-word;
                }
                .vl-account-signout {
                    border: 1px solid rgba(255,255,255,.28);
                    background: transparent;
                    color: rgba(255,255,255,.9);
                    font-family: 'Courier New', monospace;
                    font-size: .62rem;
                    letter-spacing: .12em;
                    text-transform: uppercase;
                    cursor: pointer;
                    padding: 8px 10px;
                    transition: border-color .2s, background .2s, color .2s;
                }
                .vl-account-signout:hover {
                    border-color: rgba(248,113,113,.72);
                    color: rgba(254,202,202,.95);
                    background: rgba(248,113,113,.12);
                }
                .vl-account-signout:disabled {
                    opacity: .55;
                    cursor: not-allowed;
                }
                @media (min-width: 768px) {
                    .vl-actions-dock {
                        left: 32px;
                        bottom: 32px;
                    }
                    .vl-logs-panel {
                        left: 32px;
                        bottom: 98px;
                    }
                    .vl-account-anchor {
                        top: 24px;
                        right: 24px;
                    }
                }
            `}</style>

            {/* ── Backdrop ──────────────────────────────────────── */}
            <div
                className={`vl-root ${closing ? 'close' : ''}`}
                style={{
                    position: 'fixed', inset: 0, zIndex: 200,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'radial-gradient(ellipse at 50% 40%, #0d0618 0%, #020408 70%, #000 100%)',
                    overflow: 'hidden',
                }}
            >
                {/* Grid */}
                <div style={{
                    position: 'absolute', inset: 0, opacity: .035, pointerEvents: 'none',
                    backgroundImage: `
                        linear-gradient(rgba(139,92,246,1) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(139,92,246,1) 1px, transparent 1px)`,
                    backgroundSize: '60px 60px',
                }} />

                {/* Scanline */}
                <div className="vl-scanline" style={{
                    position: 'absolute', left: 0, right: 0, height: '2px',
                    background: 'linear-gradient(to right, transparent, rgba(139,92,246,.12), transparent)',
                    pointerEvents: 'none',
                }} />

                {/* Corner marks */}
                {[
                    { top: 20, left: 20, borderTop: '1px solid', borderLeft: '1px solid' },
                    { top: 20, right: 20, borderTop: '1px solid', borderRight: '1px solid' },
                    { bottom: 20, left: 20, borderBottom: '1px solid', borderLeft: '1px solid' },
                    { bottom: 20, right: 20, borderBottom: '1px solid', borderRight: '1px solid' },
                ].map((s, i) => (
                    <div key={i} style={{ position: 'absolute', width: 40, height: 40, borderColor: 'rgba(139,92,246,.28)', ...s }} />
                ))}

                {appUser && (
                    <div className="vl-account-anchor" ref={accountPanelRef}>
                        <button
                            type="button"
                            className="vl-account-button"
                            id="void-google-account-toggle"
                            onClick={() => setShowAccountPanel(prev => !prev)}
                            title="Google account"
                        >
                            {appUser.picture ? (
                                <img className="vl-account-avatar" src={appUser.picture} alt="Google account avatar" />
                            ) : (
                                <span className="vl-account-fallback">{accountInitial(appUser)}</span>
                            )}
                        </button>

                        {showAccountPanel && (
                            <div className="vl-account-panel" id="void-google-account-panel">
                                <div className="vl-account-head">
                                    <div className="vl-account-head-avatar">
                                        {appUser.picture ? (
                                            <img className="vl-account-avatar" src={appUser.picture} alt="Google account avatar" />
                                        ) : (
                                            <span className="vl-account-fallback">{accountInitial(appUser)}</span>
                                        )}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div className="vl-account-name">{safeShortText(appUser.name || 'Google User', 42)}</div>
                                        <div className="vl-account-mail">{safeShortText(appUser.email, 64)}</div>
                                    </div>
                                </div>

                                <div className="vl-account-info">
                                    <div className="vl-account-row">
                                        <span className="vl-account-key">User ID</span>
                                        <span className="vl-account-value">{safeShortText(appUser.id, 18)}</span>
                                    </div>
                                    <div className="vl-account-row">
                                        <span className="vl-account-key">Google Sub</span>
                                        <span className="vl-account-value">{safeShortText(appUser.googleSub, 26)}</span>
                                    </div>
                                    <div className="vl-account-row">
                                        <span className="vl-account-key">Status</span>
                                        <span className="vl-account-value">AUTHORIZED</span>
                                    </div>
                                </div>

                                <button
                                    type="button"
                                    className="vl-account-signout"
                                    id="void-google-account-signout"
                                    onClick={handleAppSignOut}
                                    disabled={isSigningOutApp}
                                >
                                    {isSigningOutApp ? '[ SIGNING OUT... ]' : '[ SIGN OUT GOOGLE ]'}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="vl-actions-dock">
                    <button
                        type="button"
                        className={`vl-void-cta ${showLogs ? 'active' : ''}`}
                        id="void-logs-toggle"
                        onClick={() => setShowLogs(prev => !prev)}
                    >
                        <div className="vl-void-cta-fill" />
                        <span className="vl-void-cta-label">[{showLogs ? '  HIDE LOGS  ' : '  LOGS  '}]</span>
                        <div className="vl-void-cta-corner-tr" />
                        <div className="vl-void-cta-corner-bl" />
                    </button>
                    <button
                        type="button"
                        className="vl-void-cta"
                        onClick={handleClose}
                    >
                        <div className="vl-void-cta-fill" />
                        <span className="vl-void-cta-label">[  ESC  ]</span>
                        <div className="vl-void-cta-corner-tr" />
                        <div className="vl-void-cta-corner-bl" />
                    </button>
                </div>

                {showLogs && (
                    <div className="vl-logs-panel" id="void-logs-panel">
                        <div className="vl-logs-head">
                            <span>SESSION DIAGNOSTICS</span>
                            <div className="vl-logs-actions">
                                <button
                                    type="button"
                                    className="vl-log-clear"
                                    id="void-logs-copy"
                                    onClick={handleCopyLogs}
                                >
                                    {copyLogsState === 'ok'
                                        ? '[ COPIED ]'
                                        : copyLogsState === 'error'
                                            ? '[ COPY FAILED ]'
                                            : '[ COPY ALL ]'}
                                </button>
                                <button
                                    type="button"
                                    className="vl-log-clear"
                                    onClick={() => {
                                        logIdRef.current = 0
                                        setLogs([])
                                        setCopyLogsState('idle')
                                        appendLog('INFO', 'LOG BUFFER CLEARED')
                                    }}
                                >
                                    [ CLEAR ]
                                </button>
                            </div>
                        </div>
                        <div className="vl-logs-list">
                            {logs.length === 0 && (
                                <div className="vl-logs-main" style={{ color: 'rgba(255,255,255,.6)' }}>
                                    NO LOGS YET.
                                </div>
                            )}

                            {logs.slice().reverse().map(entry => (
                                <div key={entry.id} className="vl-logs-item">
                                    <div className="vl-logs-main">
                                        <span style={{ color: levelColor(entry.level), marginRight: 10 }}>
                                            [{entry.level}]
                                        </span>
                                        <span style={{ color: 'rgba(255,255,255,.55)', marginRight: 10 }}>
                                            {formatLogTime(entry.timestamp)}
                                        </span>
                                        <span>{entry.message}</span>
                                    </div>
                                    {entry.metaText && (
                                        <div className="vl-logs-meta">{entry.metaText}</div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Content ───────────────────────────────────── */}
                <div style={{
                    width: '100%', maxWidth: 420, padding: '0 32px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 40,
                }}>

                    {/* Title */}
                    <div style={{ textAlign: 'center' }}>
                        <div
                            className={glitch ? 'vl-glitch' : ''}
                            data-text="THE VOID"
                            style={{
                                position: 'relative',
                                fontFamily: 'Courier New, monospace',
                                fontSize: 'clamp(2.4rem, 7vw, 3.8rem)',
                                fontWeight: 700,
                                letterSpacing: '.35em',
                                color: 'rgba(167,139,250,.2)',
                                textShadow: '0 0 80px rgba(139,92,246,.22)',
                                userSelect: 'none', lineHeight: 1,
                            }}
                        >
                            THE VOID
                        </div>
                        <div className="vl-flicker" style={{
                            fontFamily: 'Courier New, monospace',
                            fontSize: '.58rem', letterSpacing: '.5em',
                            color: 'rgba(139,92,246,.62)', marginTop: 12,
                            textTransform: 'uppercase',
                        }}>
                            SECURE ACCESS TERMINAL
                        </div>
                    </div>

                    {/* ── check / boot ───────────────────────────── */}
                    {(stage === 'check-auth' || stage === 'check' || stage === 'boot') && (
                        <div className="vl-panel" style={{
                            fontFamily: 'Courier New, monospace', fontSize: '.7rem',
                            color: 'rgba(139,92,246,.75)', letterSpacing: '.1em', lineHeight: 1.8,
                            width: '100%',
                        }}>
                            {stage === 'check-auth' && (
                                <Typewriter text="> CHECKING IDENTITY PROVIDER SESSION..." speed={25} />
                            )}
                            {stage === 'check' && (
                                <Typewriter text="> CHECKING EXISTING TELEGRAM SESSION..." speed={25} />
                            )}
                            {stage === 'boot' && (
                                <Typewriter
                                    text="> NO TELEGRAM SESSION FOUND. IDENTITY VERIFICATION REQUIRED. PROVIDE YOUR TELEGRAM NUMBER TO ESTABLISH SECURE CHANNEL."
                                    speed={18}
                                    onDone={() => setTimeout(() => setStage('phone'), 350)}
                                />
                            )}
                        </div>
                    )}

                    {/* ── app auth gate ───────────────────────────── */}
                    {stage === 'appauth' && (
                        <div className="vl-panel" style={{
                            width: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 24,
                        }}>
                            <div style={{
                                fontFamily: 'Courier New, monospace', fontSize: '.62rem',
                                color: 'rgba(139,92,246,.7)', letterSpacing: '.09em', lineHeight: 1.8,
                            }}>
                                &gt; GOOGLE AUTHORIZATION REQUIRED
                                <br />
                                <span style={{ fontSize: '.55rem', color: 'rgba(139,92,246,.46)' }}>
                                    SIGN IN WITH GOOGLE TO LOAD YOUR CLOUD TELEGRAM SESSION FROM SECURE STORAGE
                                </span>
                            </div>

                            <button type="button" className="vl-btn" onClick={handleGoogleLogin} id="void-google-login">
                                CONTINUE WITH GOOGLE
                            </button>
                        </div>
                    )}

                    {/* ── phone ──────────────────────────────────── */}
                    {stage === 'phone' && (
                        <form className="vl-panel" onSubmit={handlePhoneSubmit}
                            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>

                            <div>
                                <div style={{
                                    fontFamily: 'Courier New, monospace', fontSize: '.58rem',
                                    color: 'rgba(139,92,246,.62)', letterSpacing: '.4em',
                                    textTransform: 'uppercase', marginBottom: 10,
                                }}>
                                    &gt; SIGNAL FREQUENCY (PHONE NUMBER)
                                </div>
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
                                TRANSMIT
                            </button>
                        </form>
                    )}

                    {/* ── sending ────────────────────────────────── */}
                    {stage === 'sending' && (
                        <Loading text={statusMsg} />
                    )}

                    {/* ── code ───────────────────────────────────── */}
                    {stage === 'code' && (
                        <form className="vl-panel" onSubmit={handleCodeSubmit}
                            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>

                            <div style={{
                                fontFamily: 'Courier New, monospace', fontSize: '.63rem',
                                color: 'rgba(139,92,246,.66)', letterSpacing: '.08em', lineHeight: 1.7,
                            }}>
                                &gt; CODE SENT TO <span style={{ color: '#a78bfa' }}>{phone}</span>
                                <br />
                                <span style={{ fontSize: '.55rem', color: 'rgba(139,92,246,.46)' }}>
                                    CHECK TELEGRAM APP OR SMS
                                </span>
                            </div>

                            <div>
                                <div style={{
                                    fontFamily: 'Courier New, monospace', fontSize: '.58rem',
                                    color: 'rgba(139,92,246,.62)', letterSpacing: '.4em',
                                    textTransform: 'uppercase', marginBottom: 10,
                                }}>
                                    &gt; ENTER QUANTUM KEY
                                </div>
                                <input
                                    ref={codeRef}
                                    className="vl-input"
                                    id="void-code-input"
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={8}
                                    value={code}
                                    onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError('') }}
                                    placeholder="_ _ _ _ _ _"
                                    style={{ letterSpacing: '.55em', fontSize: '1.35rem', textAlign: 'center' }}
                                />
                            </div>

                            {error && <ErrorLine text={error} />}

                            <button type="submit" className="vl-btn" id="void-code-submit">
                                AUTHENTICATE
                            </button>
                            <button type="button" className="vl-link-btn"
                                onClick={() => { setStage('phone'); setCode(''); setError('') }}>
                                ← CHANGE FREQUENCY
                            </button>
                        </form>
                    )}

                    {/* ── verifying ──────────────────────────────── */}
                    {stage === 'verifying' && (
                        <Loading text={statusMsg} />
                    )}

                    {/* ── 2FA password ────────────────────────────── */}
                    {stage === 'password' && (
                        <form className="vl-panel" onSubmit={handle2FASubmit}
                            style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 24 }}>

                            <div style={{
                                fontFamily: 'Courier New, monospace', fontSize: '.63rem',
                                color: 'rgba(139,92,246,.66)', letterSpacing: '.08em', lineHeight: 1.7,
                            }}>
                                &gt; TWO-FACTOR AUTHENTICATION ENABLED
                                <br />
                                <span style={{ fontSize: '.55rem', color: 'rgba(139,92,246,.46)' }}>
                                    ENTER YOUR TELEGRAM CLOUD PASSWORD
                                </span>
                            </div>

                            <div>
                                <div style={{
                                    fontFamily: 'Courier New, monospace', fontSize: '.58rem',
                                    color: 'rgba(139,92,246,.62)', letterSpacing: '.4em',
                                    textTransform: 'uppercase', marginBottom: 10,
                                }}>
                                    &gt; CLOUD PASSWORD
                                </div>
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
                                VERIFY &amp; ENTER
                            </button>
                        </form>
                    )}

                    {/* ── verifying 2FA ───────────────────────────── */}
                    {stage === 'verifying2fa' && (
                        <Loading text={statusMsg} />
                    )}

                    {/* ── success ────────────────────────────────── */}
                    {stage === 'success' && (
                        <div className="vl-panel" style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24,
                            width: '100%',
                        }}>
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                            }}>
                                <div className="vl-success" style={{
                                    width: 56, height: 56,
                                    border: '1px solid rgba(139,92,246,.6)', borderRadius: '50%',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    color: '#a78bfa', fontSize: '1.5rem',
                                    boxShadow: '0 0 30px rgba(139,92,246,.3)',
                                }}>
                                    ✦
                                </div>
                                <div style={{
                                    fontFamily: 'Courier New, monospace', fontSize: '.7rem',
                                    color: 'rgba(167,139,250,.85)', letterSpacing: '.38em',
                                    textTransform: 'uppercase', textAlign: 'center', lineHeight: 1.9,
                                }}>
                                    CONNECTION ESTABLISHED
                                    <br />
                                    <span style={{ color: 'rgba(139,92,246,.4)', fontSize: '.55rem', letterSpacing: '.2em' }}>
                                        WARPING INTO THE VOID...
                                    </span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Footer */}
                    {(stage === 'phone' || stage === 'code' || stage === 'password') && (
                        <div style={{
                            fontFamily: 'Courier New, monospace', fontSize: '.52rem',
                            color: 'rgba(139,92,246,.32)', letterSpacing: '.18em',
                            textTransform: 'uppercase', textAlign: 'center',
                        }}>
                            TELEGRAM MTProto · END-TO-END ENCRYPTED
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

/* ── Sub-components ───────────────────────────────────────── */

function Loading({ text }) {
    return (
        <div className="vl-panel" style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22,
        }}>
            <div className="vl-spinner" style={{
                width: 36, height: 36,
                border: '1px solid rgba(139,92,246,.15)',
                borderTop: '1px solid rgba(139,92,246,.85)',
                borderRadius: '50%',
            }} />
            <div style={{
                fontFamily: 'Courier New, monospace', fontSize: '.63rem',
                color: 'rgba(139,92,246,.6)', letterSpacing: '.28em', textTransform: 'uppercase',
                textAlign: 'center',
            }}>
                <Typewriter text={text} speed={30} />
            </div>
        </div>
    )
}

function ErrorLine({ text }) {
    return (
        <div style={{
            fontFamily: 'Courier New, monospace', fontSize: '.6rem',
            color: '#f87171', letterSpacing: '.15em', textTransform: 'uppercase',
            borderLeft: '2px solid rgba(248,113,113,.4)', paddingLeft: 10,
        }}>
            ! {text}
        </div>
    )
}
