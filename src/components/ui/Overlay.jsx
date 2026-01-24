import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import TerminalPages from './TerminalPages'

export default function Overlay() {
    const { section, setSection, showGame, setShowGame, setCameraAnimation, setIsDiving, setIsExiting } = useStore()
    const [isTransitioning, setIsTransitioning] = useState(true)
    const [fadeOpacity, setFadeOpacity] = useState(1)
    const [transitionDuration, setTransitionDuration] = useState(2500)

    // Intro Fade In
    React.useEffect(() => {
        const timer = setTimeout(() => {
            setFadeOpacity(0)
            setIsTransitioning(false)
        }, 100)
        return () => clearTimeout(timer)
    }, [])

    const handleGameClose = () => {
        setIsTransitioning(true)
        setTransitionDuration(500)
        // Removed setFadeOpacity(1) for transparent transition

        setTimeout(() => {
            setShowGame(false)
            setCameraAnimation('eject')
            setIsExiting(true)
            setTimeout(() => {
                setFadeOpacity(0)
                setIsTransitioning(false)
            }, 50)
        }, 500)
    }

    const handleInitGame = () => {
        setIsTransitioning(true)
        setCameraAnimation('dive')
        setIsDiving(true)
        setTransitionDuration(1000)

        // Removed setFadeOpacity(1)
        setTimeout(() => {
            // No opacity change
        }, 300)

        setTimeout(() => {
            setShowGame(true)
            setTimeout(() => {
                setFadeOpacity(0)
                setIsTransitioning(false)
            }, 800)
        }, 1400)
    }

    return (
        <>
            {/* Fade to Black Overlay (Only for extreme transitions if needed, currently kept transparent) */}
            <div
                className="absolute inset-0 bg-black pointer-events-none z-[100] transition-opacity ease-in-out"
                style={{ opacity: fadeOpacity, transitionDuration: `${transitionDuration}ms` }}
            />

            {/* Terminal Pages (Sphere Content) */}
            <TerminalPages />

            {/* The Void Page (Game Mode) - Transparent now */}
            {showGame && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-[80] flex flex-col items-center justify-center gap-16">
                    <h2 className="text-white/5 font-mono text-5xl md:text-9xl font-bold tracking-[0.2em] select-none pointer-events-none">
                        THE VOID
                    </h2>
                    <button
                        onClick={handleGameClose}
                        className="pointer-events-auto relative px-8 py-4 group overflow-hidden transition-all duration-500"
                    >
                        <div className="absolute inset-0 border border-white/20 group-hover:border-white/60 group-hover:bg-white/5 transition-all duration-500" />
                        <span className="relative text-xs font-mono tracking-[0.4em] text-white/60 group-hover:text-white transition-colors duration-500 uppercase">
                            Return to Reality
                        </span>
                    </button>
                </div>
            )}

            <div className={`absolute inset-0 pointer-events-none z-50 flex flex-col justify-between p-8 transition-opacity duration-500 ${showGame || isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
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

                <div className="flex-1"></div>

                {/* Footer Info */}
                <footer className="flex justify-between items-end pointer-events-none">
                    <div className="flex flex-col gap-4">
                        <div className="text-white/30 font-mono text-[10px] tracking-widest leading-relaxed opacity-50">
                            <div>COORDS: 12.339.992</div>
                            <div>SECTOR: 7G (ORION)</div>
                        </div>

                        {/* Game Launch Button */}
                        <button
                            onClick={handleInitGame}
                            className="pointer-events-auto group relative px-8 py-3 bg-transparent border border-white/20 overflow-hidden hover:border-white/80 transition-colors duration-500"
                        >
                            <div className="absolute inset-0 bg-white translate-y-[100%] group-hover:translate-y-0 transition-transform duration-500 cubic-bezier(0.87, 0, 0.13, 1)" />
                            <div className="relative flex items-center gap-3">
                                <span className="text-[10px] font-mono tracking-[0.3em] text-white/70 group-hover:text-black transition-colors duration-500 uppercase">
                                    [  ENTER THE VOID  ]
                                </span>
                            </div>
                            <div className="absolute top-0 right-0 w-2 h-2 border-t border-r border-white/50 group-hover:border-black transition-colors duration-500" />
                            <div className="absolute bottom-0 left-0 w-2 h-2 border-b border-l border-white/50 group-hover:border-black transition-colors duration-500" />
                        </button>
                    </div>

                    <div className="flex gap-4">
                        {/* Telegram Button */}
                        <a
                            href="http://t.me/mark_asm"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pointer-events-auto group relative px-6 py-3 bg-black/20 border border-white/10 overflow-hidden hover:border-white/60 transition-colors duration-500"
                        >
                            <div className="absolute inset-0 bg-white translate-y-[101%] group-hover:translate-y-0 transition-transform duration-500 cubic-bezier(0.19, 1, 0.22, 1)" />
                            <div className="relative flex items-center gap-4">
                                <div className="text-[10px] font-mono tracking-[0.3em] text-white/80 group-hover:text-black transition-colors duration-500 uppercase">
                                    my telegram
                                </div>
                                <svg className="w-3 h-3 text-white/50 group-hover:text-black transform -rotate-45 group-hover:rotate-0 transition-all duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                            </div>
                        </a>

                        {/* Instagram Button */}
                        <a
                            href="https://www.instagram.com/_mark.asm/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pointer-events-auto group relative px-6 py-3 bg-black/20 border border-white/10 overflow-hidden hover:border-white/60 transition-colors duration-500"
                        >
                            <div className="absolute inset-0 bg-white translate-y-[101%] group-hover:translate-y-0 transition-transform duration-500 cubic-bezier(0.19, 1, 0.22, 1)" />
                            <div className="relative flex items-center gap-4">
                                <div className="text-[10px] font-mono tracking-[0.3em] text-white/80 group-hover:text-black transition-colors duration-500 uppercase">
                                    my instagram
                                </div>
                                <svg className="w-3 h-3 text-white/50 group-hover:text-black transform -rotate-45 group-hover:rotate-0 transition-all duration-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                </svg>
                            </div>
                        </a>
                    </div>
                </footer>
            </div>
        </>
    )
}
