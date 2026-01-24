import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'

// --- REUSABLE COMPONENTS ---

const SectionHeader = ({ title, subtitle }) => (
    <div className="mb-16">
        <h2 className="text-5xl font-light text-white mb-2 tracking-tighter">{title}</h2>
        <div className="flex items-center gap-3">
            <div className="h-px w-8 bg-blue-500" />
            <p className="font-mono text-xs text-blue-200/60 tracking-[0.3em] uppercase">{subtitle}</p>
        </div>
    </div>
)

const StatusFooter = ({ status = "STANDING BY", memory = "OPTIMAL" }) => (
    <div className="mt-auto pt-8 border-t border-white/5 flex justify-between items-end">
        <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">System Status</span>
            <span className="text-xs font-mono text-green-400/80 tracking-widest uppercase flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {status}
            </span>
        </div>
        <div className="flex flex-col gap-1 text-right">
            <span className="text-[10px] font-mono text-white/20 uppercase tracking-widest">Memory Integrity</span>
            <span className="text-xs font-mono text-white/40 tracking-widest uppercase">{memory}</span>
        </div>
    </div>
)

// --- PANELS ---

const LabPanel = ({ active }) => {
    return (
        <div className={`h-full flex flex-col transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${active ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
            <SectionHeader title="Research Lab" subtitle="Experimental Data Analysis" />

            <div className="flex-1 flex flex-col gap-8">
                <div className="relative group">
                    <label className="text-[10px] font-mono text-white/30 uppercase tracking-widest mb-3 block ml-1">Input Parameters</label>
                    <div className="relative overflow-hidden bg-white/5 border border-white/10 group-hover:border-white/20 transition-colors duration-300 pointer-events-auto">
                        <input
                            type="text"
                            placeholder="ENTER_SEQUENCE..."
                            className="w-full bg-transparent border-none py-6 px-6 text-lg text-white font-mono placeholder:text-white/10 focus:ring-0 focus:outline-none"
                        />
                        {/* Animated Bottom Bar */}
                        <div className="absolute bottom-0 left-0 h-[2px] w-full bg-blue-500 transform scale-x-0 group-hover:scale-x-100 transition-transform duration-500 origin-left" />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button className="h-16 border border-white/20 hover:bg-white hover:text-black hover:border-transparent transition-all duration-300 font-mono text-xs tracking-[0.2em] uppercase flex items-center justify-center gap-2 group pointer-events-auto">
                        <span className="w-1 h-1 bg-white group-hover:bg-black rounded-full" />
                        Execute
                    </button>
                    <button className="h-16 border border-white/10 hover:border-white/30 text-white/40 hover:text-white transition-all duration-300 font-mono text-xs tracking-[0.2em] uppercase pointer-events-auto">
                        Clear Buffer
                    </button>
                </div>

                {/* Decorative Data Block */}
                <div className="mt-8 p-6 bg-black/40 border border-white/5 font-mono text-[10px] text-blue-200/40 leading-relaxed tracking-wide">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex justify-between border-b border-white/5 py-2 last:border-0">
                            <span>SECTION_{'0' + (i + 1)}</span>
                            <span>{Math.random().toString(36).substring(7).toUpperCase()}</span>
                        </div>
                    ))}
                </div>
            </div>

            <StatusFooter status="AWAITING INPUT" />
        </div>
    )
}

const InfoPanel = ({ active }) => {
    return (
        <div className={`h-full flex flex-col transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${active ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
            <SectionHeader title="System Info" subtitle="Operational Status & Logs" />

            <div className="space-y-12">
                <div className="space-y-6">
                    <h3 className="text-xl font-light text-white tracking-wide">Manifesto</h3>
                    <p className="text-sm text-white/60 font-light leading-7 tracking-wide">
                        Built on the principles of absolute minimalism and user sovereignty.
                        No tracking scripts. No advertising algorithms. Just pure, unadulterated code
                        designed to solve problems.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="flex items-baseline justify-between py-4 border-b border-white/10">
                        <span className="font-mono text-xs text-blue-400 tracking-widest uppercase">Developer</span>
                        <span className="font-light text-sm text-white">Solo Human</span>
                    </div>
                    <div className="flex items-baseline justify-between py-4 border-b border-white/10">
                        <span className="font-mono text-xs text-blue-400 tracking-widest uppercase">Location</span>
                        <span className="font-light text-sm text-white">Earth / Grid 7</span>
                    </div>
                    <div className="flex items-baseline justify-between py-4 border-b border-white/10">
                        <span className="font-mono text-xs text-blue-400 tracking-widest uppercase">stack</span>
                        <span className="font-light text-sm text-white">React Three Fiber</span>
                    </div>
                </div>
            </div>

            <StatusFooter status="SYSTEM ONLINE" memory="STABLE" />
        </div>
    )
}

const ProductsPanel = ({ active }) => {
    return (
        <div className={`h-full flex flex-col transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${active ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-8'}`}>
            <SectionHeader title="Products" subtitle="Available Software Packages" />

            <div className="flex-1 space-y-4">
                {/* Pro Tier */}
                <button className="w-full text-left group relative overflow-hidden bg-white/5 border border-white/10 hover:border-white/30 transition-all duration-500 p-8 pointer-events-auto">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="white"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2-1 8 4-8 4-8-4 8-4-2-1z" /></svg>
                    </div>

                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="font-mono text-[10px] text-blue-400 tracking-widest uppercase border border-blue-500/30 px-2 py-1 rounded-sm">Enterprise</span>
                        </div>
                        <h3 className="text-3xl font-light text-white mb-2 group-hover:text-blue-200 transition-colors">Insomnia Pro</h3>
                        <p className="text-sm text-white/40 font-light leading-relaxed max-w-[80%]">
                            Unrestricted access to the void. Total data dominance.
                        </p>
                    </div>

                    <div className="absolute bottom-0 left-0 h-[1px] w-full bg-gradient-to-r from-blue-500/50 to-transparent transform scale-x-0 group-hover:scale-x-100 transition-transform duration-700 origin-left" />
                </button>

                {/* Core Tier */}
                <button className="w-full text-left group relative overflow-hidden bg-transparent border border-white/10 hover:bg-white/5 transition-all duration-500 p-8 opacity-60 hover:opacity-100 pointer-events-auto">
                    <div className="relative z-10">
                        <div className="flex items-center gap-3 mb-3">
                            <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase border border-white/10 px-2 py-1 rounded-sm">Standard</span>
                        </div>
                        <h3 className="text-2xl font-light text-white mb-2">Insomnia Core</h3>
                        <p className="text-sm text-white/40 font-light leading-relaxed">
                            Essential tools for the modern explorer.
                        </p>
                    </div>
                </button>
            </div>

            <StatusFooter status="STORE ACTIVE" />
        </div>
    )
}

export default function TerminalPages() {
    const section = useStore((state) => state.section)
    const showGame = useStore((state) => state.showGame)

    if (section === 'home' || showGame) return null

    return (
        <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
            <div className="w-full h-full flex justify-end">
                {/* Sidebar Container with Smooth Gradient Transition */}
                <div
                    className="
                        relative w-[60%] min-w-[600px] h-full 
                        bg-gradient-to-l from-[#050505] via-[#050505] via-60% to-transparent
                        pointer-events-none
                        flex flex-col
                    "
                >
                    {/* Noise Overlay (kept subtle) */}
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />

                    {/* Content Container - Pushed to the right to sit in the solid part of gradient */}
                    <div className="relative flex-1 pl-32 pr-16 md:pr-24 py-20 overflow-y-auto flex flex-col justify-center">
                        {section === 'lab' && <LabPanel active={true} />}
                        {section === 'info' && <InfoPanel active={true} />}
                        {section === 'products' && <ProductsPanel active={true} />}
                    </div>
                </div>
            </div>
        </div>
    )
}
