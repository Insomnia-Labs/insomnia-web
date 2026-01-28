import React, { useState, useEffect, useRef } from 'react'
import { useStore } from '../../store/useStore'

// --- REUSABLE UI COMPONENTS ---

const GlassCard = ({ children, className = "", hover = false, noPadding = false }) => (
    <div className={`
        relative overflow-hidden
        bg-black/60 border border-white/10
        ${hover ? 'hover:bg-white/10 hover:border-white/30 transition-colors duration-300 group' : ''}
        ${noPadding ? '' : 'p-6'}
        ${className}
    `}>
        {children}
        {/* Technical Corner Accents */}
        <div className="absolute top-0 left-0 w-2 h-2 border-t border-l border-white/20" />
        <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/20" />
        <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/20" />
        <div className="absolute bottom-0 right-0 w-2 h-2 border-b border-r border-white/20" />

        {/* Scanline Effect (subtle) */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.1)_50%),linear-gradient(90deg,rgba(255,0,0,0.03),rgba(0,255,0,0.01),rgba(0,0,255,0.03))] z-0 pointer-events-none bg-[length:100%_4px,6px_100%] opacity-20" />
    </div>
)

const SectionHeader = ({ index, title, subtitle }) => (
    <div className="mb-12 relative">
        <div className="text-[10px] font-mono text-blue-400 mb-2 tracking-[0.2em] opacity-80">
            {index} // SYSTEM_DIRECTORY
        </div>
        <h2 className="text-4xl md:text-6xl lg:text-7xl font-light text-white mb-4 tracking-tighter uppercase relative z-10">
            {title}
        </h2>
        <div className="flex items-center gap-4">
            <div className="h-px w-12 bg-gradient-to-r from-blue-500 to-transparent" />
            <p className="font-mono text-xs text-white/40 tracking-[0.3em] uppercase">{subtitle}</p>
        </div>
    </div>
)

const StatusFooter = ({ status = "STANDING BY", memory = "OPTIMAL" }) => (
    <div className="mt-auto pt-8 border-t border-white/5 flex justify-between items-end relative">
        {/* Animated Progress Line */}
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-blue-500/50 to-transparent opacity-30" />

        <div className="flex flex-col gap-2">
            <span className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">Net_Status</span>
            <div className="flex items-center gap-3">
                <div className="relative w-2 h-2">
                    <span className="absolute inset-0 rounded-full bg-green-500 animate-ping opacity-75" />
                    <span className="relative block w-2 h-2 rounded-full bg-green-500" />
                </div>
                <span className="text-xs font-mono text-green-400/90 tracking-widest uppercase text-shadow-glow">
                    {status}
                </span>
            </div>
        </div>
        <div className="flex flex-col gap-2 text-right">
            <span className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">Integrity</span>
            <span className="text-xs font-mono text-white/40 tracking-widest uppercase">{memory}</span>
        </div>
    </div>
)

// --- PANELS ---

const PanelWrapper = ({ children, active }) => (
    <div
        className={`w-full h-full absolute inset-0 pointer-events-none ${active ? 'z-10' : 'z-0'}`}
        style={{ gridArea: '1 / 1' }}
    >
        {children}
    </div>
)

const LabPanel = ({ active }) => {
    return (
        <div className={`h-full flex flex-col transition-opacity duration-500 ease-out ${active ? 'opacity-100' : 'opacity-0'}`}>
            <SectionHeader index="01" title="Research" subtitle="Experimental Data Analysis" />

            <div className="flex-1 flex flex-col gap-6">
                <GlassCard className="flex-1 flex flex-col gap-6">
                    <div className="relative group">
                        <div className="flex justify-between items-center mb-2">
                            <label className="text-[10px] font-mono text-blue-300/60 uppercase tracking-widest">Input Sequence</label>
                            <span className="text-[10px] font-mono text-white/20">READY</span>
                        </div>
                        <div className={`relative overflow-hidden bg-black/40 border border-white/10 group-hover:border-white/30 transition-colors duration-300 ${active ? 'pointer-events-auto' : ''}`}>
                            <input
                                type="text"
                                placeholder="AWAITING_COMMAND..."
                                className="w-full bg-transparent border-none py-6 px-6 text-lg text-white font-mono placeholder:text-white/10 focus:ring-0 focus:outline-none"
                                tabIndex={active ? 0 : -1}
                            />
                            {/* Animated Cursor */}
                            <div className="absolute right-4 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-blue-500 animate-pulse pointer-events-none" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <button className={`h-14 border border-white/20 bg-white/5 hover:bg-white hover:text-black hover:border-transparent transition-all duration-300 font-mono text-xs tracking-[0.2em] uppercase flex items-center justify-center gap-3 group ${active ? 'pointer-events-auto' : ''}`} tabIndex={active ? 0 : -1}>
                            <span className="w-1.5 h-1.5 bg-green-500 group-hover:bg-black rounded-full transition-colors" />
                            Run_Sim
                        </button>
                        <button className={`h-14 border border-white/10 hover:border-red-500/50 hover:text-red-400 transition-all duration-300 font-mono text-xs tracking-[0.2em] uppercase ${active ? 'pointer-events-auto' : ''}`} tabIndex={active ? 0 : -1}>
                            Reset
                        </button>
                    </div>
                </GlassCard>

                {/* Decorative Data Stream */}
                <div className="grid grid-cols-3 gap-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                        <GlassCard key={i} className="py-4 flex flex-col gap-1 items-center justify-center hover:bg-white/5">
                            <span className="text-[9px] font-mono text-white/30 tracking-widest">NODE_{'0' + (i + 1)}</span>
                            <span className="text-xs font-mono text-blue-200/80">{Math.floor(Math.random() * 999)} MS</span>
                        </GlassCard>
                    ))}
                </div>
            </div>

            <StatusFooter status="AWAITING INPUT" />
        </div>
    )
}

const InfoPanel = ({ active }) => {
    return (
        <div className={`h-full flex flex-col transition-opacity duration-500 ease-out ${active ? 'opacity-100' : 'opacity-0'}`}>
            <SectionHeader index="02" title="System Info" subtitle="Operational Logs" />

            <div className="space-y-8">
                {/* Manifesto Card */}
                <GlassCard className="relative overflow-visible">
                    <div className="absolute -top-3 left-6 px-2 bg-[#050505] text-[10px] font-mono text-white/40 tracking-widest border border-white/10">
                        MANIFESTO.TXT
                    </div>
                    <p className="text-sm md:text-base text-white/70 font-light leading-8 tracking-wide font-sans">
                        <span className="text-blue-400/60 font-mono text-xs mr-2">0x01</span>
                        Built on the principles of <span className="text-white border-b border-white/20 pb-0.5">absolute minimalism</span>.
                        <br />
                        <span className="text-blue-400/60 font-mono text-xs mr-2">0x02</span>
                        No tracking scripts. No advertising algorithms.
                        <br />
                        <span className="text-blue-400/60 font-mono text-xs mr-2">0x03</span>
                        Just pure, unadulterated code designed to solve problems.
                    </p>
                </GlassCard>

                {/* Data Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <GlassCard hover className={`flex flex-col justify-between h-32 group ${active ? 'pointer-events-auto' : ''}`}>
                        <div className="flex justify-between items-start">
                            <span className="font-mono text-[10px] text-blue-400 tracking-widest uppercase opacity-70">Creator</span>
                            <div className="w-1.5 h-1.5 bg-white/20 rounded-full group-hover:bg-blue-400 transition-colors" />
                        </div>
                        <div className="text-2xl font-light text-white group-hover:translate-x-1 transition-transform duration-300">
                            Solo Human
                        </div>
                    </GlassCard>

                    <GlassCard hover className={`flex flex-col justify-between h-32 group ${active ? 'pointer-events-auto' : ''}`}>
                        <div className="flex justify-between items-start">
                            <span className="font-mono text-[10px] text-blue-400 tracking-widest uppercase opacity-70">Location</span>
                            <div className="w-1.5 h-1.5 bg-white/20 rounded-full group-hover:bg-blue-400 transition-colors" />
                        </div>
                        <div className="text-2xl font-light text-white group-hover:translate-x-1 transition-transform duration-300">
                            Earth / Grid 7
                        </div>
                    </GlassCard>

                    <GlassCard hover className={`col-span-1 md:col-span-2 flex items-center justify-between group ${active ? 'pointer-events-auto' : ''}`}>
                        <div className="flex flex-col gap-1">
                            <span className="font-mono text-[10px] text-blue-400 tracking-widest uppercase opacity-70">Tech Stack</span>
                            <span className="text-white font-light group-hover:text-blue-200 transition-colors">React Three Fiber + Zustand + Tailwind</span>
                        </div>
                        <div className="h-full flex items-center gap-1 opacity-20 group-hover:opacity-60 transition-opacity">
                            {[1, 2, 3, 4].map(i => <div key={i} className="w-1 h-8 bg-white/50 skew-x-12" />)}
                        </div>
                    </GlassCard>
                </div>
            </div>

            <StatusFooter status="SYSTEM ONLINE" memory="STABLE" />
        </div>
    )
}

const ProductsPanel = ({ active }) => {
    return (
        <div className={`h-full flex flex-col transition-opacity duration-500 ease-out ${active ? 'opacity-100' : 'opacity-0'}`}>
            <SectionHeader index="03" title="Armory" subtitle="Available Upgrades" />

            <div className="flex-1 space-y-6">
                {/* Pro Tier */}
                <button className={`w-full text-left group relative outline-none focus:outline-none ${active ? 'pointer-events-auto' : ''}`} tabIndex={active ? 0 : -1}>
                    <GlassCard hover noPadding className="p-8 border-white/10 group-hover:border-blue-500/50 transition-colors duration-500">
                        <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:opacity-100 group-hover:text-blue-400 transition-all duration-500 transform group-hover:scale-110">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2-1 8 4-8 4-8-4 8-4-2-1z" /></svg>
                        </div>

                        <div className="relative z-10 flex flex-col gap-4">
                            <div className="inline-flex">
                                <span className="font-mono text-[9px] text-blue-400 tracking-[0.2em] uppercase border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 rounded-sm">Enterprise Edition</span>
                            </div>
                            <div>
                                <h3 className="text-4xl font-light text-white mb-2 group-hover:text-blue-100 transition-colors">Insomnia Pro</h3>
                                <p className="text-sm text-white/50 font-light leading-relaxed max-w-[80%]">
                                    Unrestricted access to the void geometry. Total data dominance.
                                </p>
                            </div>
                            <div className="pt-4 flex items-center gap-2 text-xs font-mono text-white/40 group-hover:text-white transition-colors">
                                <span>[ UPGRADE NOW ]</span>
                                <div className="w-8 h-px bg-white/20 group-hover:bg-white transition-colors" />
                            </div>
                        </div>
                    </GlassCard>
                </button>

                {/* Core Tier */}
                <button className={`w-full text-left group relative outline-none focus:outline-none ${active ? 'pointer-events-auto' : ''}`} tabIndex={active ? 0 : -1}>
                    <GlassCard hover noPadding className="p-8 bg-transparent border-white/5 group-hover:border-white/20 opacity-60 hover:opacity-100">
                        <div className="relative z-10">
                            <div className="flex items-center gap-3 mb-3">
                                <span className="font-mono text-[9px] text-white/30 tracking-[0.2em] uppercase border border-white/10 px-2 py-1 rounded-sm">Standard</span>
                            </div>
                            <h3 className="text-2xl font-light text-white mb-2">Insomnia Core</h3>
                            <p className="text-sm text-white/40 font-light leading-relaxed">
                                Essential tools for the modern explorer.
                            </p>
                        </div>
                    </GlassCard>
                </button>
            </div>

            <StatusFooter status="STORE ACTIVE" />
        </div>
    )
}

export default function TerminalPages() {
    const section = useStore((state) => state.section)
    const showGame = useStore((state) => state.showGame)

    const isVisible = section !== 'home' && !showGame

    return (
        <div className={`fixed inset-0 pointer-events-none z-40 overflow-hidden transition-opacity duration-700 ${isVisible ? 'opacity-100' : 'opacity-0 delay-300'}`}>
            <div className={`w-full h-full flex justify-end pointer-events-none`}>
                {/* Sidebar Container */}
                <div
                    className="
                        relative w-full md:w-[60%] md:min-w-[600px] h-full 
                        pointer-events-none
                        flex flex-col isolation-isolate
                    "
                >
                    {/* Separate Gradient Background Layer - Mobile: Solid Black, Desktop: Smooth Leftward Fade */}
                    <div className="absolute inset-0 bg-black/90 md:bg-transparent md:bg-gradient-to-l md:from-black/80 md:to-transparent -z-10 transition-all duration-500" />

                    {/* Noise Overlay */}
                    <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')] -z-10" />

                    {/* Content Container */}
                    <div className="relative flex-1 px-6 pt-24 pb-32 md:pl-32 md:pr-24 md:py-20 overflow-y-auto flex flex-col justify-center pointer-events-none">
                        <div className="grid w-full h-full items-center pointer-events-none relative transform-gpu">
                            <PanelWrapper active={section === 'lab'}>
                                <LabPanel active={section === 'lab'} />
                            </PanelWrapper>
                            <PanelWrapper active={section === 'info'}>
                                <InfoPanel active={section === 'info'} />
                            </PanelWrapper>
                            <PanelWrapper active={section === 'products'}>
                                <ProductsPanel active={section === 'products'} />
                            </PanelWrapper>
                        </div>
                    </div>
                </div>
            </div>
        </div >
    )
}
