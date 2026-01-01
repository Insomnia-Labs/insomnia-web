import React, { useState } from 'react'
import { useStore } from '../../store/useStore'
import { Disc, Info, Download } from 'lucide-react'

export default function OrbitalNav() {
    const { section, setSection } = useStore()
    const [hoveredIndex, setHoveredIndex] = useState(null)

    const navItems = [
        { id: 'login', label: 'Login', icon: Disc, angle: 0 },
        { id: 'about', label: 'About', icon: Info, angle: 120 },
        { id: 'download', label: 'Get App', icon: Download, angle: 240 },
    ]

    return (
        <div className="fixed inset-0 pointer-events-none z-50 flex items-center justify-center">
            {/* Orbital Ring Container */}
            <div className="relative w-[500px] h-[500px]">
                {/* Central Void Indicator */}
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 rounded-full bg-white/20 animate-pulse shadow-[0_0_20px_rgba(255,255,255,0.3)]" />
                </div>

                {/* Orbital Ring */}
                <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                    <circle
                        cx="50"
                        cy="50"
                        r="45"
                        fill="none"
                        stroke="rgba(255,255,255,0.1)"
                        strokeWidth="0.1"
                        strokeDasharray="2 2"
                        className="animate-[spin_60s_linear_infinite]"
                    />
                    <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth="0.05"
                        className="animate-[spin_90s_linear_infinite_reverse]"
                    />
                </svg>

                {/* Navigation Buttons */}
                {navItems.map((item, index) => {
                    const isActive = section === item.id
                    const isHovered = hoveredIndex === index
                    const angleRad = (item.angle * Math.PI) / 180
                    const radius = 250 // pixels
                    const x = Math.cos(angleRad) * radius
                    const y = Math.sin(angleRad) * radius

                    return (
                        <div
                            key={item.id}
                            className="absolute top-1/2 left-1/2 pointer-events-auto"
                            style={{
                                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                            }}
                        >
                            <button
                                onClick={() => setSection(item.id)}
                                onMouseEnter={() => setHoveredIndex(index)}
                                onMouseLeave={() => setHoveredIndex(null)}
                                className={`
                                    relative group
                                    ${isActive ? 'scale-110' : 'scale-100'}
                                    ${isHovered ? 'scale-105' : ''}
                                    transition-all duration-300
                                `}
                            >
                                {/* Glow Effect */}
                                {isActive && (
                                    <div className="absolute inset-0 rounded-full bg-white/20 blur-xl animate-pulse" />
                                )}

                                {/* Button Container */}
                                <div
                                    className={`
                                        relative
                                        w-16 h-16
                                        rounded-full
                                        border
                                        backdrop-blur-xl
                                        flex items-center justify-center
                                        transition-all duration-300
                                        ${isActive
                                            ? 'bg-white/10 border-white/40 shadow-[0_0_30px_rgba(255,255,255,0.3)]'
                                            : 'bg-black/40 border-white/10 hover:bg-white/5 hover:border-white/20'
                                        }
                                    `}
                                >
                                    <item.icon
                                        size={24}
                                        className={`
                                            transition-all duration-300
                                            ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white/80'}
                                        `}
                                    />
                                </div>

                                {/* Label */}
                                <div
                                    className={`
                                        absolute top-full mt-3 left-1/2 -translate-x-1/2
                                        whitespace-nowrap
                                        text-xs font-mono uppercase tracking-widest
                                        transition-all duration-300
                                        ${isActive || isHovered
                                            ? 'opacity-100 translate-y-0'
                                            : 'opacity-0 translate-y-2'
                                        }
                                        ${isActive ? 'text-white font-semibold' : 'text-white/60'}
                                    `}
                                >
                                    {item.label}
                                </div>

                                {/* Orbital Trail */}
                                {isActive && (
                                    <div
                                        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full border border-white/20 animate-ping"
                                        style={{ animationDuration: '2s' }}
                                    />
                                )}
                            </button>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
