import React, { useState, useEffect } from 'react'
import { Zap, Target, Shield, X } from 'lucide-react'

export default function GameMenu({ onStart, onClose }) {
    const [difficulty, setDifficulty] = useState('normal')
    const [isVisible, setIsVisible] = useState(false)

    useEffect(() => {
        // Trigger fade-in animation after mount
        const timer = setTimeout(() => setIsVisible(true), 50)
        return () => clearTimeout(timer)
    }, [])

    const difficulties = [
        {
            id: 'easy',
            label: 'TRAINING',
            icon: Shield,
            description: 'Slower enemies, more time to react',
            color: 'from-green-500/20 to-green-900/20 border-green-500/30 hover:border-green-500/60',
            activeColor: 'from-green-500/30 to-green-900/30 border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.3)]'
        },
        {
            id: 'normal',
            label: 'OPERATIVE',
            icon: Target,
            description: 'Balanced challenge for regular agents',
            color: 'from-blue-500/20 to-blue-900/20 border-blue-500/30 hover:border-blue-500/60',
            activeColor: 'from-blue-500/30 to-blue-900/30 border-blue-500 shadow-[0_0_30px_rgba(59,130,246,0.3)]'
        },
        {
            id: 'hard',
            label: 'NIGHTMARE',
            icon: Zap,
            description: 'Overwhelming odds, only for veterans',
            color: 'from-red-500/20 to-red-900/20 border-red-500/30 hover:border-red-500/60',
            activeColor: 'from-red-500/30 to-red-900/30 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]'
        }
    ]

    const handleStart = () => {
        onStart({ difficulty })
    }

    return (
        <div className={`fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center font-mono transition-opacity duration-700 ${isVisible ? 'opacity-100' : 'opacity-0'}`}>
            {/* Scanlines effect */}
            <div className="absolute inset-0 opacity-10 pointer-events-none bg-[repeating-linear-gradient(0deg,transparent,transparent_2px,rgba(255,255,255,0.03)_2px,rgba(255,255,255,0.03)_4px)]" />

            {/* Grid background */}
            <div className="absolute inset-0 opacity-5 pointer-events-none bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:50px_50px]" />

            <div className={`relative max-w-4xl w-full px-8 transition-transform duration-700 ${isVisible ? 'translate-y-0' : 'translate-y-8'}`}>
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="absolute -top-4 right-8 text-white/50 hover:text-white transition-colors group"
                >
                    <X size={24} className="group-hover:rotate-90 transition-transform duration-300" />
                </button>

                {/* Header */}
                <div className="text-center mb-12">
                    <h1 className="text-6xl font-black text-white mb-4 tracking-[0.3em] drop-shadow-[0_0_30px_rgba(255,255,255,0.3)]">
                        VOID_RUNNER
                    </h1>
                    <div className="flex items-center justify-center gap-3 text-sm text-white/50 tracking-[0.5em]">
                        <div className="h-[1px] w-12 bg-white/20" />
                        <span>INITIALIZATION PROTOCOL</span>
                        <div className="h-[1px] w-12 bg-white/20" />
                    </div>
                </div>

                {/* Difficulty Selection */}
                <div className="mb-12">
                    <h2 className="text-xs text-white/40 uppercase tracking-[0.3em] mb-6 text-center">
                        SELECT THREAT TIER
                    </h2>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {difficulties.map((diff) => {
                            const Icon = diff.icon
                            const isActive = difficulty === diff.id

                            return (
                                <button
                                    key={diff.id}
                                    onClick={() => setDifficulty(diff.id)}
                                    className={`
                    relative group p-6 rounded-none border-2 
                    bg-gradient-to-br transition-all duration-300
                    ${isActive ? diff.activeColor : diff.color}
                  `}
                                >
                                    {/* Corner accents */}
                                    <div className={`absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 transition-colors ${isActive ? 'border-white' : 'border-white/20'}`} />
                                    <div className={`absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 transition-colors ${isActive ? 'border-white' : 'border-white/20'}`} />

                                    {/* Active indicator */}
                                    {isActive && (
                                        <div className="absolute top-3 right-3 w-2 h-2 bg-white rounded-full animate-pulse" />
                                    )}

                                    <div className="flex flex-col items-center gap-4">
                                        <Icon
                                            size={40}
                                            className={`transition-all duration-300 ${isActive ? 'text-white scale-110' : 'text-white/60 group-hover:text-white/80'}`}
                                        />

                                        <div className="text-center">
                                            <h3 className={`text-xl font-bold tracking-widest mb-2 transition-colors ${isActive ? 'text-white' : 'text-white/70'}`}>
                                                {diff.label}
                                            </h3>
                                            <p className={`text-xs leading-relaxed transition-colors ${isActive ? 'text-white/80' : 'text-white/40'}`}>
                                                {diff.description}
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                </div>

                {/* Stats Preview */}
                <div className="mb-12 p-6 border border-white/10 bg-black/40 backdrop-blur-sm">
                    <div className="grid grid-cols-3 gap-6 text-center">
                        <div>
                            <div className="text-2xl font-bold text-white mb-1">
                                {difficulty === 'easy' ? '70' : difficulty === 'normal' ? '50' : '30'}
                            </div>
                            <div className="text-xs text-white/50 uppercase tracking-widest">Spawn Rate</div>
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-white mb-1">
                                {difficulty === 'easy' ? '0.7x' : difficulty === 'normal' ? '1.0x' : '1.5x'}
                            </div>
                            <div className="text-xs text-white/50 uppercase tracking-widest">Enemy Speed</div>
                        </div>
                        <div>
                            <div className="text-2xl font-bold text-white mb-1">
                                {difficulty === 'easy' ? 'Low' : difficulty === 'normal' ? 'Med' : 'High'}
                            </div>
                            <div className="text-xs text-white/50 uppercase tracking-widest">Intensity</div>
                        </div>
                    </div>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-6 justify-center">
                    <button
                        onClick={handleStart}
                        className="group relative px-12 py-4 bg-white text-black font-bold tracking-[0.3em] uppercase overflow-hidden transition-all duration-300 hover:scale-105"
                    >
                        {/* Animated background */}
                        <div className="absolute inset-0 bg-gradient-to-r from-white via-blue-100 to-white bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite]" />

                        <span className="relative flex items-center gap-3">
                            <Target size={20} />
                            Initialize
                        </span>
                    </button>

                    <button
                        onClick={onClose}
                        className="px-12 py-4 border-2 border-white/20 text-white font-bold tracking-[0.3em] uppercase hover:bg-white/10 hover:border-white/40 transition-all duration-300"
                    >
                        Abort
                    </button>
                </div>

                {/* Footer hint */}
                <div className="mt-8 text-center text-white/30 text-xs tracking-[0.5em]">
                    <div className="mb-2">CONTROLS: MOUSE MOVE + HOLD CLICK</div>
                    <div>ESC TO EXIT ANYTIME</div>
                </div>
            </div>
        </div>
    )
}
