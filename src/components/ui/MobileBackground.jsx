import { motion } from 'framer-motion'
import { useState, useEffect, useRef, useCallback } from 'react'
import MobileBlackHole from './MobileBlackHole'
import { useStore } from '../../store/useStore'

/* ── Typewriter hook ── */
function useTypewriter(text, speed = 50) {
    const [displayed, setDisplayed] = useState('')
    const idx = useRef(0)
    useEffect(() => {
        idx.current = 0
        setDisplayed('')
        const id = setInterval(() => {
            idx.current += 1
            setDisplayed(text.slice(0, idx.current))
            if (idx.current >= text.length) clearInterval(id)
        }, speed)
        return () => clearInterval(id)
    }, [text, speed])
    return displayed
}

/* ── Feature icons (inline SVG) ── */
const IconDistributed = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M5 12h14M12 5l7 7-7 7" />
    </svg>
)
const IconEncrypted = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
)
const IconEdge = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
)
const IconSupport = () => (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
)

const features = [
    {
        title: 'Distributed Core',
        description: 'Multi-region mesh with automatic failover and zero single points of failure.',
        icon: <IconDistributed />,
        iconColor: 'text-blue-400',
        gradient: 'from-blue-500/20 to-cyan-500/5',
        hoverBorder: 'rgba(59,130,246,0.3)',
    },
    {
        title: 'Encrypted Storage',
        description: 'End-to-end encryption. Your data is yours — mathematically guaranteed.',
        icon: <IconEncrypted />,
        iconColor: 'text-purple-400',
        gradient: 'from-purple-500/20 to-purple-500/5',
        hoverBorder: 'rgba(168,85,247,0.3)',
    },
    {
        title: 'Edge Performance',
        description: 'Sub-12ms response times globally. CDN-native, no configuration needed.',
        icon: <IconEdge />,
        iconColor: 'text-amber-400',
        gradient: 'from-amber-500/20 to-amber-500/5',
        hoverBorder: 'rgba(251,191,36,0.3)',
    },
    {
        title: '24/7 Support',
        description: 'Our team is always online to assist with any questions or issues.',
        icon: <IconSupport />,
        iconColor: 'text-emerald-400',
        gradient: 'from-emerald-500/20 to-emerald-500/5',
        hoverBorder: 'rgba(52,211,153,0.3)',
    },
]

const steps = [
    {
        step: '01',
        title: 'Deploy',
        desc: 'Connect your project in minutes. Zero-config setup with any major cloud provider.',
        color: 'from-blue-500/20 to-cyan-500/20',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
        ),
    },
    {
        step: '02',
        title: 'Scale',
        desc: 'Automatic scaling based on traffic. Pay only for what you use.',
        color: 'from-purple-500/20 to-pink-500/20',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
        ),
    },
    {
        step: '03',
        title: 'Relax',
        desc: '99.9% uptime SLA. Automatic failover, backups, and monitoring included.',
        color: 'from-emerald-500/20 to-teal-500/20',
        icon: (
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    },
]

/* ── Main component ── */
export default function MobileBackground() {
    const headline = useTypewriter('Cloud infrastructure,\nwithout limits.', 48)
    const scrollProgress = useRef(0)
    const containerRef = useRef()
    const isMenuOpen = useStore((s) => s.isMenuOpen)
    const setShowVoidLogin = useStore((s) => s.setShowVoidLogin)

    const handleScroll = useCallback(() => {
        const el = containerRef.current
        if (!el) return
        const max = el.scrollHeight - el.clientHeight
        scrollProgress.current = max > 0 ? el.scrollTop / max : 0
    }, [])

    const handleGetStarted = useCallback(() => {
        setShowVoidLogin(true)
    }, [setShowVoidLogin])

    return (
        <div
            className="mobile-background-scroll"
            ref={containerRef}
            onScroll={handleScroll}
            style={{
                width: '100%', overflowY: 'auto',
                overscrollBehavior: 'contain',
                WebkitOverflowScrolling: 'touch',
                background: '#050505',
                color: '#EDEDED',
                fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
                position: 'relative',
                isolation: 'isolate',
            }}
        >
            {/* ── Full-screen fixed black hole background ── */}
            <div style={{
                position: 'fixed', inset: 0,
                zIndex: 0,
                background: 'radial-gradient(120% 80% at 50% 10%, #080a11 0%, #04050a 45%, #020203 100%)',
                pointerEvents: 'none',
                transform: 'translateZ(0)',
                willChange: 'transform',
            }}>
                <MobileBlackHole scrollProgress={scrollProgress} isMenuOpen={isMenuOpen} />
            </div>
            <div style={{
                position: 'fixed', inset: 0,
                zIndex: 1,
                background: 'rgba(2, 3, 8, 0.46)',
                pointerEvents: 'none',
            }} />

            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

                .mb-cursor {
                    display: inline-block;
                    width: 2px; height: 0.85em;
                    background: white;
                    margin-left: 3px;
                    vertical-align: middle;
                    animation: mb-blink .75s step-end infinite;
                }
                @keyframes mb-blink {
                    0%,100% { opacity:1; }
                    50% { opacity:0; }
                }
                .mb-card {
                    background: #1a1b26;
                    border: 1px solid rgba(255,255,255,0.05);
                    border-radius: 24px;
                    transform: translateZ(0);
                    will-change: transform;
                    transition: transform 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
                }
                .mb-card:hover {
                    border-color: rgba(255,255,255,0.12);
                    transform: translateY(-4px) translateZ(0);
                    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
                }
                .mb-icon-box {
                    width: 56px; height: 56px;
                    border-radius: 14px;
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .mb-pill {
                    display: inline-block;
                    padding: 6px 16px;
                    border-radius: 999px;
                    border: 1px solid rgba(255,255,255,0.1);
                    background: rgba(255,255,255,0.05);
                    color: rgba(255,255,255,0.7);
                    font-size: 13px;
                    font-weight: 500;
                    /* NO backdrop-filter — too expensive on mobile */
                }
                .mb-gradient-text {
                    background: linear-gradient(135deg, #60a5fa, #a78bfa);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    background-clip: text;
                }
                .mb-cta-primary {
                    display: block; width: 100%;
                    padding: 16px;
                    background: linear-gradient(135deg, #2563eb, #7c3aed);
                    border: none; border-radius: 14px;
                    color: white; font-size: 15px; font-weight: 600;
                    letter-spacing: -0.01em; cursor: pointer;
                    transition: transform 0.2s ease, box-shadow 0.2s ease;
                    box-shadow: 0 0 40px rgba(99,102,241,0.25);
                    will-change: transform;
                }
                .mb-cta-primary:hover {
                    box-shadow: 0 0 60px rgba(99,102,241,0.45);
                    transform: translateY(-1px);
                }
                .mb-cta-secondary {
                    display: block; width: 100%;
                    padding: 16px;
                    background: transparent;
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 14px;
                    color: rgba(255,255,255,0.7); font-size: 15px; font-weight: 500;
                    cursor: pointer;
                    transition: border-color 0.2s ease, color 0.2s ease;
                }
                .mb-cta-secondary:hover {
                    border-color: rgba(255,255,255,0.25);
                    color: white;
                }
            `}</style>

            {/* ══ HERO ══════════════════════════════════════════ */}
            <section className="mobile-hero-section" style={{
                display: 'flex', flexDirection: 'column',
                justifyContent: 'center', padding: '88px 24px 48px',
                position: 'relative', overflow: 'hidden',
                zIndex: 1,
                /* Bottom gradient fade into next section */
                background: 'linear-gradient(to bottom, transparent 60%, rgba(10,10,15,0.85) 100%)',
            }}>
                {/* Background glow */}
                <div style={{
                    position: 'absolute', top: '-10%', right: '-30%',
                    width: 400, height: 400, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
                    filter: 'blur(60px)', pointerEvents: 'none',
                }} />
                <div style={{
                    position: 'absolute', bottom: '0', left: '-20%',
                    width: 300, height: 300, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(124,58,237,0.1) 0%, transparent 70%)',
                    filter: 'blur(50px)', pointerEvents: 'none',
                }} />

                <div style={{ position: 'relative', zIndex: 1 }}>
                    {/* Pill badge */}
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: 'easeOut' }}
                        style={{ marginBottom: 24, willChange: 'transform, opacity' }}
                    >
                        <span className="mb-pill">Cloud Architecture</span>
                    </motion.div>

                    {/* Headline */}
                    <motion.h1
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1, duration: 0.55, ease: 'easeOut' }}
                        style={{
                            fontSize: 'clamp(2.4rem, 10vw, 3.5rem)',
                            fontWeight: 700,
                            lineHeight: 1.08,
                            letterSpacing: '-0.035em',
                            marginBottom: 20,
                            whiteSpace: 'pre-line',
                            minHeight: '2.3em',
                            willChange: 'transform, opacity',
                        }}
                    >
                        {headline.split('\n').map((line, i, arr) => {
                            const isLast = i === arr.length - 1
                            const cursor = isLast ? <span className="mb-cursor" /> : null
                            if (i === 1) {
                                const words = line.split(' ')
                                const lastWord = words.at(-1)
                                const rest = words.slice(0, -1).join(' ')
                                return (
                                    <span key={i} style={{ display: 'block' }}>
                                        {rest}{rest ? ' ' : ''}
                                        <span className="mb-gradient-text">{lastWord}</span>
                                        {cursor}
                                    </span>
                                )
                            }
                            return (
                                <span key={i} style={{ display: 'block' }}>
                                    {line}{cursor}
                                </span>
                            )
                        })}
                    </motion.h1>

                    {/* Subtext */}
                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4, duration: 0.5, ease: 'easeOut' }}
                        style={{
                            fontSize: 16, color: 'rgba(237,237,237,0.5)',
                            lineHeight: 1.65, marginBottom: 32, maxWidth: 340,
                            willChange: 'opacity',
                        }}
                    >
                        Decentralized infrastructure that scales with you. No compromises on speed, security, or control.
                    </motion.p>

                    {/* CTAs */}
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.6, duration: 0.45, ease: 'easeOut' }}
                        style={{ display: 'flex', flexDirection: 'column', gap: 10, willChange: 'transform, opacity' }}
                    >
                        <button className="mb-cta-primary" type="button" onClick={handleGetStarted}>
                            Get Started — It's Free
                        </button>
                        <button className="mb-cta-secondary">View Documentation</button>
                    </motion.div>

                    {/* Stats row */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.9, duration: 0.5, ease: 'easeOut' }}
                        style={{
                            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
                            marginTop: 48,
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                            padding: '20px 0',
                            willChange: 'opacity',
                        }}
                    >
                        {[
                            { value: '99.9%', label: 'Uptime SLA' },
                            { value: '<12ms', label: 'Latency' },
                            { value: '12.4K', label: 'Active Nodes' },
                        ].map((s, i) => (
                            <div key={i} style={{
                                textAlign: 'center',
                                borderRight: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                                padding: '0 8px',
                            }}>
                                <div style={{
                                    fontSize: 'clamp(1.2rem, 5vw, 1.6rem)',
                                    fontWeight: 700, letterSpacing: '-0.03em',
                                    marginBottom: 4,
                                    background: 'linear-gradient(135deg, #60a5fa, #a78bfa)',
                                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                                    backgroundClip: 'text',
                                }}>{s.value}</div>
                                <div style={{
                                    fontSize: 11, color: 'rgba(237,237,237,0.35)',
                                    fontWeight: 500,
                                }}>{s.label}</div>
                            </div>
                        ))}
                    </motion.div>
                </div>
            </section>

            {/* ══ VALUE PROP ════════════════════════════════════ */}
            <section style={{
                padding: '80px 24px',
                position: 'relative', zIndex: 1,
                borderTop: '1px solid rgba(255,255,255,0.05)',
                background: 'rgba(10,10,15,0.7)',
            }}>
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{ textAlign: 'center', willChange: 'transform, opacity' }}
                >
                    <h2 style={{
                        fontSize: 'clamp(2rem, 8vw, 3rem)', fontWeight: 700,
                        letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 16,
                    }}>
                        Premium infrastructure.{' '}
                        <span style={{ color: 'rgba(237,237,237,0.35)' }}>Fraction of the cost.</span>
                    </h2>
                    <p style={{
                        fontSize: 16, color: 'rgba(237,237,237,0.5)',
                        lineHeight: 1.65, maxWidth: 340, margin: '0 auto 24px',
                    }}>
                        We handle the hard parts so you can focus on what matters.{' '}
                        <span style={{
                            color: 'white',
                            borderBottom: '1px solid rgba(255,255,255,0.2)',
                            paddingBottom: 1,
                        }}>Reliable, scalable, secure.</span>
                    </p>
                    <div style={{
                        display: 'flex', justifyContent: 'center',
                        alignItems: 'center', gap: 12, marginTop: 24,
                    }}>
                        <div style={{ height: 1, width: 40, background: 'rgba(255,255,255,0.15)' }} />
                        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.3)' }} />
                        <div style={{ height: 1, width: 40, background: 'rgba(255,255,255,0.15)' }} />
                    </div>
                </motion.div>
            </section>

            {/* ══ FEATURES GRID ════════════════════════════════ */}
            <section style={{ padding: '0 16px 80px', position: 'relative', zIndex: 1, background: 'rgba(10,10,15,0.8)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
                    {features.map((f, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true, margin: '-30px' }}
                            transition={{ duration: 0.35, delay: i * 0.06, ease: 'easeOut' }}
                            className="mb-card"
                            style={{ padding: 28, position: 'relative', overflow: 'hidden' }}
                        >
                            <div className="mb-icon-box" style={{ marginBottom: 20 }}>
                                <span className={f.iconColor}>{f.icon}</span>
                            </div>

                            <h3 style={{
                                fontSize: 20, fontWeight: 700, color: 'white',
                                letterSpacing: '-0.02em', marginBottom: 10,
                            }}>{f.title}</h3>

                            <p style={{
                                fontSize: 14, color: 'rgba(237,237,237,0.5)',
                                lineHeight: 1.65, margin: 0,
                            }}>{f.description}</p>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ══ HOW IT WORKS ═════════════════════════════════ */}
            <section style={{
                padding: '80px 16px',
                position: 'relative', zIndex: 1,
                background: 'rgba(10,10,15,0.8)',
                borderTop: '1px solid rgba(255,255,255,0.05)',
            }}>
                <div style={{ textAlign: 'center', marginBottom: 48 }}>
                    <motion.div
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                        style={{ marginBottom: 16, willChange: 'transform, opacity' }}
                    >
                        <span className="mb-pill">How It Works</span>
                    </motion.div>
                    <h2 style={{
                        fontSize: 'clamp(2rem, 8vw, 3rem)', fontWeight: 700,
                        letterSpacing: '-0.03em', lineHeight: 1.1,
                    }}>
                        Simple as{' '}
                        <span className="mb-gradient-text">1, 2, 3</span>.
                    </h2>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {steps.map((s, i) => (
                        <motion.div
                            key={i}
                            initial={{ opacity: 0 }}
                            whileInView={{ opacity: 1 }}
                            viewport={{ once: true, margin: '-30px' }}
                            transition={{ duration: 0.35, delay: i * 0.07, ease: 'easeOut' }}
                            className="mb-card"
                            style={{ padding: 28, position: 'relative', overflow: 'hidden' }}
                        >
                            <div style={{
                                display: 'flex', justifyContent: 'space-between',
                                alignItems: 'flex-start', marginBottom: 20,
                            }}>
                                <div className="mb-icon-box">{s.icon}</div>
                                <span style={{
                                    fontSize: 48, fontWeight: 700,
                                    color: 'rgba(255,255,255,0.05)',
                                    fontVariantNumeric: 'tabular-nums',
                                    lineHeight: 1,
                                }}>{s.step}</span>
                            </div>
                            <h3 style={{
                                fontSize: 22, fontWeight: 700, color: 'white',
                                letterSpacing: '-0.02em', marginBottom: 10,
                            }}>{s.title}</h3>
                            <p style={{
                                fontSize: 14, color: 'rgba(237,237,237,0.5)',
                                lineHeight: 1.65, margin: 0,
                            }}>{s.desc}</p>
                        </motion.div>
                    ))}
                </div>
            </section>

            {/* ══ COMMUNITY BANNER ═════════════════════════════ */}
            <section style={{ padding: '80px 16px', position: 'relative', zIndex: 1 }}>
                <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{
                        willChange: 'transform, opacity',
                        position: 'relative', overflow: 'hidden',
                        background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                        borderRadius: 28, padding: '48px 28px',
                        textAlign: 'center',
                        boxShadow: '0 25px 80px rgba(79,70,229,0.35)',
                    }}
                >
                    {/* Orbs */}
                    <div style={{
                        position: 'absolute', top: '-30%', right: '-20%',
                        width: 200, height: 200, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.1)', filter: 'blur(40px)',
                        pointerEvents: 'none',
                    }} />
                    <div style={{
                        position: 'absolute', bottom: '-20%', left: '-15%',
                        width: 160, height: 160, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.2)', filter: 'blur(40px)',
                        pointerEvents: 'none',
                    }} />

                    <h2 style={{
                        fontSize: 'clamp(1.8rem, 7vw, 2.5rem)', fontWeight: 700,
                        color: 'white', letterSpacing: '-0.03em', lineHeight: 1.1,
                        marginBottom: 14, position: 'relative', zIndex: 1,
                    }}>
                        Join the community
                    </h2>
                    <p style={{
                        fontSize: 15, color: 'rgba(255,255,255,0.75)',
                        lineHeight: 1.6, marginBottom: 32,
                        position: 'relative', zIndex: 1,
                    }}>
                        Get exclusive deals and connect with other users on our Telegram channel.
                    </p>
                    <a
                        href="http://t.me/mark_asm"
                        target="_blank" rel="noopener noreferrer"
                        style={{
                            display: 'inline-block',
                            padding: '14px 32px',
                            background: 'white', color: '#2563eb',
                            borderRadius: 999, fontWeight: 700, fontSize: 15,
                            textDecoration: 'none',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                            position: 'relative', zIndex: 1,
                            transition: 'transform 0.2s',
                        }}
                    >
                        Join Telegram
                    </a>
                </motion.div>
            </section>

            {/* ══ FOOTER ═══════════════════════════════════════ */}
            <footer style={{
                padding: '20px 24px',
                borderTop: '1px solid rgba(255,255,255,0.05)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                position: 'relative', zIndex: 1,
                background: 'rgba(10,10,15,0.9)',
            }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 2 }}>
                        INSOMNIA
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(237,237,237,0.3)', fontWeight: 400 }}>
                        © 2026 Insomnia Labs
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                    <a href="http://t.me/mark_asm" target="_blank" rel="noopener noreferrer"
                        style={{
                            fontSize: 13, color: 'rgba(237,237,237,0.4)', textDecoration: 'none',
                            borderBottom: '1px solid rgba(237,237,237,0.1)', paddingBottom: 1
                        }}>
                        Telegram
                    </a>
                    <a href="https://github.com/mioruno" target="_blank" rel="noopener noreferrer"
                        style={{
                            fontSize: 13, color: 'rgba(237,237,237,0.4)', textDecoration: 'none',
                            borderBottom: '1px solid rgba(237,237,237,0.1)', paddingBottom: 1
                        }}>
                        GitHub
                    </a>
                </div>
            </footer>
        </div>
    )
}
