import { motion } from 'framer-motion'

export default function MobileBackground() {
    return (
        <div className="min-h-screen w-full overflow-y-auto" style={{ background: '#000510' }}>

            {/* BRIGHT Multi-layer Gradient Background - NO BLUR */}
            <div className="fixed inset-0 -z-10">

                {/* Layer 1 - Purple to blue base */}
                <div
                    className="absolute inset-0"
                    style={{
                        background: 'linear-gradient(180deg, #1a0033 0%, #0a0520 30%, #000510 50%, #0a0033 70%, #050515 100%)',
                    }}
                />

                {/* Layer 2 - Diagonal color sweep */}
                <div
                    className="absolute inset-0 opacity-50"
                    style={{
                        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.4) 0%, transparent 30%, rgba(59, 130, 246, 0.5) 50%, transparent 70%, rgba(6, 182, 212, 0.4) 100%)',
                    }}
                />

                {/* Layer 3 - Radial color spots */}
                <div
                    className="absolute inset-0 opacity-60"
                    style={{
                        background: `
                            radial-gradient(circle at 20% 15%, rgba(139, 92, 246, 0.5) 0%, transparent 35%),
                            radial-gradient(circle at 80% 85%, rgba(59, 130, 246, 0.6) 0%, transparent 40%),
                            radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.4) 0%, transparent 45%)
                        `,
                    }}
                />

                {/* Layer 4 - Animated moving gradient */}
                <div
                    className="absolute inset-0 opacity-30"
                    style={{
                        background: 'linear-gradient(60deg, #8b5cf6 0%, transparent 30%, #3b82f6 50%, transparent 70%, #06b6d4 100%)',
                        backgroundSize: '200% 200%',
                        animation: 'gradientSlide 12s ease-in-out infinite'
                    }}
                />

                {/* Layer 5 - Horizontal bands */}
                <div
                    className="absolute inset-0 opacity-20"
                    style={{
                        background: `
                            linear-gradient(0deg, 
                                transparent 0%, 
                                rgba(139, 92, 246, 0.3) 20%, 
                                transparent 40%,
                                rgba(59, 130, 246, 0.3) 60%,
                                transparent 80%,
                                rgba(6, 182, 212, 0.3) 100%
                            )
                        `,
                    }}
                />
            </div>

            <style>{`
                @keyframes gradientSlide {
                    0%, 100% { 
                        background-position: 0% 50%;
                        opacity: 0.3;
                    }
                    50% { 
                        background-position: 100% 50%;
                        opacity: 0.5;
                    }
                }
            `}</style>

            {/* Scrollable Content */}
            <div className="relative z-10">

                {/* Fixed Header */}
                <header className="fixed top-0 left-0 right-0 z-50 p-6 backdrop-blur-sm bg-black/10">
                    <div>
                        <h1 className="text-2xl font-extralight tracking-[0.15em] text-white uppercase leading-tight">
                            INSOMNIA
                        </h1>
                        <p className="text-[8px] text-blue-200/50 tracking-[0.5em] uppercase mt-1 font-light italic">
                            Cloud Architecture
                        </p>
                    </div>
                </header>

                {/* Hero Section - Compact */}
                <section className="flex flex-col items-center justify-center p-6 pt-32 pb-16 relative overflow-hidden">

                    <motion.h1
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2, duration: 1 }}
                        className="text-3xl sm:text-5xl font-extralight tracking-[0.08em] sm:tracking-[0.15em] text-white uppercase text-center mb-3 px-4 z-10"
                    >
                        INSOMNIA
                    </motion.h1>

                    <motion.div
                        initial={{ opacity: 0, scaleX: 0 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        transition={{ delay: 0.6, duration: 0.8 }}
                        className="w-12 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent mb-3 z-10"
                    />

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.9, duration: 1 }}
                        className="text-[10px] text-blue-200/40 tracking-[0.5em] uppercase font-light italic mb-12 z-10"
                    >
                        Cloud Architecture
                    </motion.p>

                    {/* Live Stats Grid */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 1.2, duration: 0.8 }}
                        className="grid grid-cols-3 gap-3 w-full max-w-[400px] px-4 mb-12 z-10"
                    >
                        {[
                            { label: 'NODES', value: '12.4K', pulse: true },
                            { label: 'UPTIME', value: '99.9%', pulse: false },
                            { label: 'SPEED', value: '1.2GB/s', pulse: true },
                        ].map((stat, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: 1.4 + i * 0.1 }}
                                className="relative bg-black/40 border border-white/5 backdrop-blur-sm p-3 hover:border-white/20 transition-colors"
                            >
                                <div className="text-[8px] text-white/30 font-mono tracking-widest mb-1">{stat.label}</div>
                                <div className="text-base sm:text-lg font-light text-white/90">{stat.value}</div>
                                {stat.pulse && (
                                    <motion.div
                                        animate={{ opacity: [0.3, 0.7, 0.3] }}
                                        transition={{ duration: 2, repeat: Infinity }}
                                        className="absolute top-2 right-2 w-1 h-1 bg-green-500 rounded-full"
                                    />
                                )}
                            </motion.div>
                        ))}
                    </motion.div>

                    {/* Quick Actions */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.8 }}
                        className="flex gap-3 w-full max-w-[400px] px-4 z-10"
                    >
                        <button className="flex-1 py-3 px-4 bg-white text-black text-xs font-mono tracking-[0.15em] uppercase hover:bg-white/90 transition-colors">
                            Start Free
                        </button>
                        <button className="flex-1 py-3 px-4 border border-white/20 text-white text-xs font-mono tracking-[0.15em] uppercase hover:bg-white/5 transition-colors">
                            Learn More
                        </button>
                    </motion.div>
                </section>

                {/* Features Section */}
                <section className="min-h-screen px-6 py-20">
                    <div className="max-w-[500px] mx-auto space-y-8">
                        <div className="text-center mb-12">
                            <h2 className="text-3xl font-light text-white mb-2 tracking-tight">Features</h2>
                            <div className="w-12 h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent mx-auto" />
                        </div>

                        {[
                            { title: "Secure Storage", desc: "End-to-end encryption with military-grade security", icon: "🔒" },
                            { title: "Infinite Space", desc: "Never worry about storage limits again", icon: "∞" },
                            { title: "Lightning Fast", desc: "Optimized performance for instant access", icon: "⚡" }
                        ].map((feature, i) => (
                            <motion.div
                                key={i}
                                initial={{ opacity: 0, y: 30 }}
                                whileInView={{ opacity: 1, y: 0 }}
                                viewport={{ once: true }}
                                transition={{ delay: i * 0.2, duration: 0.6 }}
                                className="bg-black/40 border border-white/10 p-6 backdrop-blur-sm"
                            >
                                <div className="text-3xl mb-3">{feature.icon}</div>
                                <h3 className="text-xl font-light text-white mb-2">{feature.title}</h3>
                                <p className="text-sm text-white/50 leading-relaxed">{feature.desc}</p>
                            </motion.div>
                        ))}
                    </div>
                </section>

                {/* CTA Section */}
                <section className="min-h-[60vh] px-6 py-20 flex flex-col items-center justify-center">
                    <motion.div
                        initial={{ opacity: 0 }}
                        whileInView={{ opacity: 1 }}
                        viewport={{ once: true }}
                        className="text-center max-w-[400px]"
                    >
                        <h2 className="text-4xl font-light text-white mb-6 tracking-tight">
                            Ready to begin?
                        </h2>
                        <p className="text-white/40 text-sm mb-8 leading-relaxed">
                            Experience the future of decentralized storage. No compromises.
                        </p>

                        <button className="w-full px-8 py-4 bg-white/5 border border-white/20 text-white font-mono text-xs tracking-[0.2em] uppercase hover:bg-white hover:text-black transition-all duration-300">
                            Get Started
                        </button>

                        <div className="mt-12 pt-8 border-t border-white/5 flex gap-6 justify-center">
                            <a href="http://t.me/mark_asm" target="_blank" rel="noopener noreferrer"
                                className="text-[10px] font-mono text-white/40 hover:text-blue-400 transition-colors uppercase tracking-widest">
                                Telegram
                            </a>
                            <a href="https://www.instagram.com/_mark.asm/" target="_blank" rel="noopener noreferrer"
                                className="text-[10px] font-mono text-white/40 hover:text-blue-400 transition-colors uppercase tracking-widest">
                                Instagram
                            </a>
                        </div>
                    </motion.div>
                </section>

                {/* Footer */}
                <footer className="px-6 py-8 border-t border-white/5">
                    <div className="max-w-[500px] mx-auto">
                        <div className="flex items-center justify-center gap-2 mb-4">
                            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                            <span className="text-[10px] font-mono text-white/30 tracking-widest uppercase">
                                System Online
                            </span>
                        </div>
                        <p className="text-center text-[10px] font-mono text-white/20 tracking-wider">
                            © 2026 INSOMNIA LABS
                        </p>
                    </div>
                </footer>
            </div>
        </div>
    )
}
