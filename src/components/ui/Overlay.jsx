import React from 'react'
import { useStore } from '../../store/useStore'

export default function Overlay() {
    const { section, setSection } = useStore()

    return (
        <div className="absolute inset-0 pointer-events-none z-50 flex flex-col justify-between p-8">
            {/* Header */}
            <header className="flex justify-between items-start pointer-events-none">
                <div
                    className="pointer-events-auto cursor-pointer transition-transform hover:scale-105"
                    onClick={() => setSection('home')}
                >
                    <h1 className="text-5xl font-bold tracking-widest bg-clip-text text-transparent bg-gradient-to-b from-white to-white/40 font-heading drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
                        INSOMNIA
                    </h1>
                    <p className="text-sm text-blue-200/60 tracking-[0.3em] uppercase mt-2 font-mono">
                        Infinite Cloud Storage
                    </p>
                </div>
            </header>

            {/* Main Content Area (Dynamic) */}
            <div className="flex-1 flex items-center justify-center pointer-events-none">
            </div>

            {/* Footer Info */}
            <footer className="flex justify-between items-end pointer-events-none">
                <div className="text-white/30 font-mono text-[10px] tracking-widest leading-relaxed opacity-50">
                    <div>COORDS: 12.339.992</div>
                    <div>SECTOR: 7G (ORION)</div>
                </div>

                <div className="flex gap-4">
                    {/* Telegram Button */}
                    <a
                        href="http://t.me/mark_asm"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto group relative px-6 py-3 bg-black/20 border border-white/10 overflow-hidden hover:border-white/60 transition-colors duration-500"
                    >
                        {/* Hover Fill */}
                        <div className="absolute inset-0 bg-white translate-y-[101%] group-hover:translate-y-0 transition-transform duration-500 cubic-bezier(0.19, 1, 0.22, 1)" />

                        <div className="relative flex items-center gap-4">
                            {/* Status Dot */}
                            <div className="flex flex-col gap-[2px]">
                                <div className="w-[2px] h-[2px] bg-white/40 group-hover:bg-black group-hover:opacity-100 opacity-0 transition-all duration-300 delay-100" />
                                <div className="w-[2px] h-[2px] bg-white/40 group-hover:bg-black group-hover:opacity-100 opacity-0 transition-all duration-300 delay-75" />
                                <div className="w-[2px] h-[2px] bg-white/40 group-hover:bg-black group-hover:opacity-100 opacity-0 transition-all duration-300 delay-0" />
                            </div>

                            <div className="text-[10px] font-mono tracking-[0.3em] text-white/80 group-hover:text-black transition-colors duration-500 uppercase">
                                my telegram
                            </div>

                            {/* Arrow Icon */}
                            <svg className="w-3 h-3 text-white/50 group-hover:text-black transform -rotate-45 group-hover:rotate-0 transition-all duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        </div>

                        {/* Decorative Corners */}
                        <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-white/50 group-hover:border-black transition-colors duration-500" />
                        <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-white/50 group-hover:border-black transition-colors duration-500" />
                    </a>

                    {/* Instagram Button */}
                    <a
                        href="https://www.instagram.com/_mark.asm/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="pointer-events-auto group relative px-6 py-3 bg-black/20 border border-white/10 overflow-hidden hover:border-white/60 transition-colors duration-500"
                    >
                        {/* Hover Fill */}
                        <div className="absolute inset-0 bg-white translate-y-[101%] group-hover:translate-y-0 transition-transform duration-500 cubic-bezier(0.19, 1, 0.22, 1)" />

                        <div className="relative flex items-center gap-4">
                            {/* Status Dot */}
                            <div className="flex flex-col gap-[2px]">
                                <div className="w-[2px] h-[2px] bg-white/40 group-hover:bg-black group-hover:opacity-100 opacity-0 transition-all duration-300 delay-100" />
                                <div className="w-[2px] h-[2px] bg-white/40 group-hover:bg-black group-hover:opacity-100 opacity-0 transition-all duration-300 delay-75" />
                                <div className="w-[2px] h-[2px] bg-white/40 group-hover:bg-black group-hover:opacity-100 opacity-0 transition-all duration-300 delay-0" />
                            </div>

                            <div className="text-[10px] font-mono tracking-[0.3em] text-white/80 group-hover:text-black transition-colors duration-500 uppercase">
                                my instagram
                            </div>

                            {/* Arrow Icon */}
                            <svg className="w-3 h-3 text-white/50 group-hover:text-black transform -rotate-45 group-hover:rotate-0 transition-all duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                            </svg>
                        </div>

                        {/* Decorative Corners */}
                        <div className="absolute top-0 left-0 w-1 h-1 border-t border-l border-white/50 group-hover:border-black transition-colors duration-500" />
                        <div className="absolute bottom-0 right-0 w-1 h-1 border-b border-r border-white/50 group-hover:border-black transition-colors duration-500" />
                    </a>
                </div>
            </footer>
        </div>
    )
}
