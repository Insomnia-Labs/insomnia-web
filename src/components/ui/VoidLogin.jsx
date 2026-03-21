import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'
import { sendCode, signIn, signInWith2FA, isAuthorized, clearSession } from '../../services/telegramClient'

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

/* ─────────────────────────────────────────────────────────────
   Main component
───────────────────────────────────────────────────────────── */

export default function VoidLogin() {
    const { showVoidLogin, setShowVoidLogin, setSection } = useStore()

    /* stages: 'boot' | 'check' | 'phone' | 'sending' | 'code' | 'verifying' | 'password' | 'verifying2fa' | 'success' | 'error' */
    const [stage, setStage] = useState('boot')
    const [phone, setPhone] = useState('')
    const [code, setCode] = useState('')
    const [twofa, setTwofa] = useState('')
    const [error, setError] = useState('')
    const [glitch, setGlitch] = useState(false)
    const [closing, setClosing] = useState(false)
    const [statusMsg, setStatusMsg] = useState('')

    const phoneRef = useRef(null)
    const codeRef = useRef(null)
    const twofaRef = useRef(null)

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
        setPhone('')
        setCode('')
        setTwofa('')
        setError('')
        setClosing(false)
        setStage('check')
    }, [showVoidLogin])

    /* Check if already authorized */
    useEffect(() => {
        if (stage !== 'check') return
        isAuthorized()
            .then(ok => {
                if (ok) {
                    setStage('success')
                } else {
                    setStage('boot')
                }
            })
            .catch(() => setStage('boot'))
    }, [stage])

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

    if (!showVoidLogin) return null

    /* ── Helpers ────────────────────────────────────────── */

    const handleLogout = () => {
        clearSession()
        setPhone('')
        setCode('')
        setTwofa('')
        setError('')
        setStage('boot')
    }

    const handleClose = () => {
        setClosing(true)
        setTimeout(() => setShowVoidLogin(false), 600)
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

        try {
            await sendCode(cleaned)
            setStage('code')
        } catch (err) {
            console.error('[VoidLogin] sendCode error:', err)
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

        try {
            await signIn(phone.trim(), code.trim())
            setStage('success')
        } catch (err) {
            console.error('[VoidLogin] signIn error:', err)
            const resolved = resolveSignInError(err)
            if (resolved.nextStage === 'password') {
                // 2FA is enabled — show cloud password input.
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
        try {
            await signInWith2FA(twofa)
            setStage('success')
        } catch (err) {
            console.error('[VoidLogin] 2FA error:', err)
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

                {/* ESC */}
                <button
                    onClick={handleClose}
                    style={{
                        position: 'absolute', top: 24, right: 24, zIndex: 10,
                        background: 'transparent', border: 'none',
                        color: 'rgba(139,92,246,.35)', cursor: 'pointer',
                        fontFamily: 'Courier New, monospace', fontSize: '.62rem',
                        letterSpacing: '.3em', textTransform: 'uppercase',
                        padding: '4px 8px', transition: 'color .3s',
                    }}
                    onMouseEnter={e => e.target.style.color = 'rgba(167,139,250,.9)'}
                    onMouseLeave={e => e.target.style.color = 'rgba(139,92,246,.35)'}
                >
                    [ ESC ]
                </button>

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
                    {(stage === 'check' || stage === 'boot') && (
                        <div className="vl-panel" style={{
                            fontFamily: 'Courier New, monospace', fontSize: '.7rem',
                            color: 'rgba(139,92,246,.75)', letterSpacing: '.1em', lineHeight: 1.8,
                            width: '100%',
                        }}>
                            {stage === 'check'
                                ? <Typewriter text="> CHECKING EXISTING SESSION..." speed={25} />
                                : <Typewriter
                                    text="> NO SESSION FOUND. IDENTITY VERIFICATION REQUIRED. PROVIDE YOUR TELEGRAM NUMBER TO ESTABLISH SECURE CHANNEL."
                                    speed={18}
                                    onDone={() => setTimeout(() => setStage('phone'), 350)}
                                />
                            }
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
