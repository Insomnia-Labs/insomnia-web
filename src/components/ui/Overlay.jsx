import React from 'react'
import { useStore } from '../../store/useStore'

export default function Overlay() {
    const { section, setSection } = useStore()

    return (
        <div className="absolute inset-0 pointer-events-none z-50 flex flex-col justify-between p-8">
            {/* Header */}
            <header className="flex justify-between items-start">
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
            <div className="flex-1 flex items-center justify-center">
            </div>

            {/* Footer Info */}
            <footer className="flex justify-between items-end">
                <div className="text-white/30 text-xs max-w-xs font-mono">
                    Coordinates: 12.339.992<br />
                    Sector: 7G (Orion Arm)
                </div>
            </footer>
        </div>
    )
}
