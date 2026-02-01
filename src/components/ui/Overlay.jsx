import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import TerminalPages from './TerminalPages'
import StaggeredMenu from './StaggeredMenu'
import { useIsMobile } from '../../hooks/useIsMobile'

export default function Overlay() {
    const { section, setSection, showVoid, setShowVoid, setCameraAnimation, setIsDiving, setIsExiting, isMenuOpen } = useStore()
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

    const handleExitVoid = () => {
        setIsTransitioning(true)
        setTransitionDuration(500)

        setTimeout(() => {
            setShowVoid(false)
            setCameraAnimation('eject')
            setIsExiting(true)
            setTimeout(() => {
                setFadeOpacity(0)
                setIsTransitioning(false)
            }, 50)
        }, 500)
    }

    const handleEnterVoid = () => {
        setIsTransitioning(true)
        setCameraAnimation('dive')
        setIsDiving(true)
        setTransitionDuration(1000)

        // Initializing VOID transition
        setTimeout(() => {
            // Animation timing
        }, 300)

        setTimeout(() => {
            setShowVoid(true)
            setTimeout(() => {
                setFadeOpacity(0)
                setIsTransitioning(false)
            }, 800)
        }, 1400)
    }

    const isMobile = useIsMobile()

    return (
        <>
            {/* Fade to Black Overlay (Only for extreme transitions if needed, currently kept transparent) */}
            <div
                className="absolute inset-0 bg-black pointer-events-none z-[100] transition-opacity ease-in-out"
                style={{ opacity: fadeOpacity, transitionDuration: `${transitionDuration}ms` }}
            />

            {/* Terminal Pages (Sphere Content) */}
            <TerminalPages />

            {/* The Void Experience - Visual Feature */}
            {showVoid && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-[80] flex flex-col items-center justify-center gap-16">
                    <h2 className="text-white/5 font-mono text-5xl md:text-9xl font-bold tracking-[0.2em] select-none pointer-events-none text-center">
                        THE VOID
                    </h2>
                    <button
                        onClick={handleExitVoid}
                        className="pointer-events-auto relative px-8 py-4 group overflow-hidden transition-all duration-500"
                    >
                        <div className="absolute inset-0 border border-white/20 group-hover:border-white/60 group-hover:bg-white/5 transition-all duration-500" />
                        <span className="relative text-xs font-mono tracking-[0.4em] text-white/60 group-hover:text-white transition-colors duration-500 uppercase">
                            Return to Reality
                        </span>
                    </button>
                </div>
            )}

            <div className={`absolute inset-0 pointer-events-none z-50 flex flex-col justify-between p-6 md:p-8 transition-opacity duration-500 ${showVoid || isTransitioning ? 'opacity-0' : 'opacity-100'}`}>
                {/* Header - Visible on desktop, and on mobile when NOT on home section */}
                <header className={`justify-between items-start pointer-events-none transition-opacity duration-500 ${isMobile && section === 'home' ? 'hidden' : 'flex'} ${isMobile ? 'absolute top-6 left-6 z-50' : 'relative'}`}>
                    <div
                        className="pointer-events-auto cursor-pointer transition-transform hover:scale-105"
                        onClick={() => setSection('home')}
                    >
                        <div className="relative group">
                            <h1 className="text-2xl md:text-6xl font-extralight tracking-[0.15em] text-white uppercase relative leading-tight">
                                INSOMNIA
                            </h1>
                            <div className="mt-4 text-center">
                                <p className={`text-[9px] md:text-xs text-blue-200/40 tracking-[0.3em] md:tracking-[0.5em] uppercase font-light italic transition-opacity duration-300 ${isMobile && isMenuOpen ? 'opacity-0' : 'opacity-100'}`}>
                                    Cloud Architecture
                                </p>
                            </div>
                        </div>
                    </div>
                </header>

                <div className="flex-1"></div>

                {/* Footer Info - Hidden on Mobile */}
                <footer className="hidden md:flex justify-between items-end pointer-events-none">
                    <div className="flex flex-col gap-4">
                        <div className="text-white/30 font-mono text-[10px] tracking-widest leading-relaxed opacity-50">
                            <div>COORDS: 12.339.992</div>
                            <div>SECTOR: 7G (ORION)</div>
                        </div>

                        {/* Social Buttons */}
                        <div className="flex gap-4 pointer-events-auto">
                            <a href="http://t.me/mark_asm" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono tracking-widest text-white/70 hover:text-blue-400 transition-colors uppercase">
                                [ MY TELEGRAM ]
                            </a>
                            <a href="https://www.instagram.com/_mark.asm/" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono tracking-widest text-white/70 hover:text-blue-400 transition-colors uppercase">
                                [ INSTAGRAM ]
                            </a>
                        </div>

                        {/* VOID Experience Button */}
                        <button
                            onClick={handleEnterVoid}
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
                </footer>
            </div>
            {/* Staggered Menu Navigation - ONLY Render on Mobile */}
            {isMobile && (
                <StaggeredMenu
                    isFixed={true}
                    items={[
                        { label: 'HOME', ariaLabel: 'Go to home', link: '#home', id: 'home' },
                        { label: 'LAB', ariaLabel: 'Research and Development', link: '#lab', id: 'lab' },
                        { label: 'ABOUT', ariaLabel: 'System Information', link: '#info', id: 'info' },
                        { label: 'PRODUCTS', ariaLabel: 'Product Catalogue', link: '#products', id: 'products' }
                    ]}
                    socialItems={[
                        { label: 'Telegram', link: 'http://t.me/mark_asm' },
                        { label: 'Instagram', link: 'https://www.instagram.com/_mark.asm/' }
                    ]}
                    displaySocials={true}
                    displayItemNumbering={true}
                    menuButtonColor="#ffffff"
                    openMenuButtonColor="#ffffff"
                    accentColor="#5227FF"
                    colors={['#050505', '#16161e', '#2d1b4e', '#102a43']}
                />
            )}
        </>
    )
}
