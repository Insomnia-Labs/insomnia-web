import React, { useState, useEffect, useRef, useMemo } from 'react'
import { Html, Billboard } from '@react-three/drei'
import { useStore } from '../../store/useStore'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// --- TEXT SCRAMMBLE HOOK ---
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*'

const useScramble = (text, speed = 40, active = false) => {
    const [displayText, setDisplayText] = useState('')
    const iteration = useRef(0)

    useEffect(() => {
        if (!active) {
            setDisplayText('')
            iteration.current = 0
            return
        }

        let timer = null

        const startScramble = () => {
            timer = setInterval(() => {
                setDisplayText(prev => {
                    return text
                        .split('')
                        .map((letter, index) => {
                            if (index < iteration.current) {
                                return text[index]
                            }
                            return chars[Math.floor(Math.random() * chars.length)]
                        })
                        .join('')
                })

                if (iteration.current >= text.length) {
                    clearInterval(timer)
                }

                iteration.current += 1 / 2 // Slower reveal
            }, speed)
        }

        startScramble()

        return () => clearInterval(timer)
    }, [text, active, speed])

    return displayText
}

// --- CONTENT PANELS ---

const LabPanel = ({ active }) => {
    const title = useScramble('RESEARCH LAB', 30, active)
    const sub = useScramble('ANALYZING SYSTEM', 20, active)

    return (
        <div className="w-[480px] p-8 border-l-2 border-white/40 bg-black/60 backdrop-blur-md relative overflow-hidden group">
            {/* Scanline effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-2 animate-scan" style={{ top: '50%' }} />

            <h2 className="text-4xl font-bold font-mono tracking-tighter text-white mb-2">{title}</h2>
            <p className="text-blue-200/70 font-mono text-xs tracking-[0.2em] mb-8">{sub}</p>

            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
                <div className="relative">
                    <input
                        type="text"
                        placeholder="SEARCH_QUERY"
                        className="w-full bg-transparent border-b border-white/20 py-2 text-white font-mono focus:outline-none focus:border-white transition-colors placeholder:text-white/20"
                    />
                </div>
                <div className="flex gap-2">
                    <button className="flex-1 mt-4 px-6 py-2 bg-white/10 hover:bg-white text-black hover:text-black hover:font-bold transition-all border border-white/20 font-mono text-sm uppercase">
                        Run
                    </button>
                    <button className="flex-1 mt-4 px-6 py-2 bg-transparent text-white hover:bg-white/10 transition-all border border-white/20 font-mono text-sm uppercase">
                        Clear
                    </button>
                </div>
            </form>
        </div>
    )
}

const InfoPanel = ({ active }) => {
    const header = useScramble('SYSTEM STATUS: ONLINE', 30, active)

    // Fixed text blocks for better readability, only headers scramble
    const blocks = [
        "CAUTION: SOLO HUMAN AT WORK",
        "Desktop apps born from: 'Fine, I'll code it myself.'",
        "THE NO-BS POLICY: No trackers, no ads, no junk.",
        "Last update: whenever inspiration struck."
    ]

    return (
        <div className="w-[500px] text-left">
            <div className="mb-6 border-b border-white/20 pb-2">
                <h3 className="text-xs text-white/40 font-mono">{header}</h3>
            </div>

            <div className="space-y-6">
                {blocks.map((text, i) => (
                    <div
                        key={i}
                        className={`transition-all duration-700 delay-${i * 200}`}
                        style={{
                            opacity: active ? 1 : 0,
                            transform: active ? 'translateX(0)' : 'translateX(-20px)'
                        }}
                    >
                        {i === 0 ? (
                            <h2 className="text-3xl font-bold text-white mb-2 leading-tight glitch-text" data-text={text}>{text}</h2>
                        ) : (
                            <p className="text-lg text-blue-100/80 font-light leading-relaxed border-l border-white/20 pl-4">{text}</p>
                        )}
                    </div>
                ))}
            </div>

            <div className="mt-8 flex gap-4 opacity-50">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <div className="w-2 h-2 bg-white/20 rounded-full" />
                <div className="w-2 h-2 bg-white/20 rounded-full" />
            </div>
        </div>
    )
}

const ProductsPanel = ({ active }) => {
    const title = useScramble('AVAILABLE PRODUCTS', 30, active)
    const sub = useScramble('SELECT PACKAGE', 20, active)

    return (
        <div className="w-[480px] p-8 border-l-2 border-white/40 bg-black/60 backdrop-blur-md relative overflow-hidden group">
            {/* Scanline effect */}
            <div className="absolute inset-0 bg-gradient-to-b from-transparent via-white/5 to-transparent h-2 animate-scan" style={{ top: '50%' }} />

            <h2 className="text-4xl font-bold font-mono tracking-tighter text-white mb-2">{title}</h2>
            <p className="text-blue-200/70 font-mono text-xs tracking-[0.2em] mb-8">{sub}</p>

            {/* Status Line */}
            <div className="w-full flex items-center gap-3 mb-8">
                <div className="h-[1px] flex-1 bg-white/20 relative overflow-hidden">
                    <div className="absolute inset-y-0 left-0 w-1/3 bg-white/60 animate-[shimmer_2s_infinite]" />
                </div>
                <span className="text-[10px] font-mono text-green-400 animate-pulse">● LIVE</span>
            </div>

            <div className="space-y-3">
                <button className="w-full px-6 py-4 bg-white/5 hover:bg-white hover:text-black transition-all border border-white/20 font-mono text-sm uppercase flex justify-between items-center group/btn">
                    <span className="tracking-widest">INSOMNIA PRO</span>
                    <span className="opacity-0 group-hover/btn:opacity-100 transition-opacity -translate-x-2 group-hover/btn:translate-x-0">GET</span>
                </button>

                <button className="w-full px-6 py-4 bg-transparent hover:bg-white hover:text-black transition-all border border-white/20 font-mono text-sm uppercase flex justify-between items-center group/btn opacity-80 hover:opacity-100">
                    <span className="tracking-widest">INSOMNIA CORE</span>
                    <span className="opacity-0 group-hover/btn:opacity-100 transition-opacity -translate-x-2 group-hover/btn:translate-x-0">FREE</span>
                </button>
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 flex justify-between items-center text-[10px] font-mono text-white/30 uppercase tracking-widest">
                <span>BUILD: v.0.4.2</span>
                <span>HASH: 7f8a...9c2b</span>
            </div>
        </div>
    )
}


// --- MAIN 3D COMPONENT ---

export default function SpatialContent() {
    const section = useStore((state) => state.section)
    const groupRef = useRef()

    useFrame((state) => {
        if (!groupRef.current) return

        // 1. Get Camera Position & Rotation
        const camera = state.camera
        const targetPos = camera.position.clone()
        const targetQuat = camera.quaternion.clone()

        // 2. Calculate "Heads-Up" position: Offset to top-right
        // Right (+X), Up (+Y), Forward (-Z)
        const offset = new THREE.Vector3(2.5, 0.9, -4.5)
        offset.applyQuaternion(targetQuat)
        targetPos.add(offset)

        // 3. Smoothly Lerp the group to this position (Drone-follow effect)
        groupRef.current.position.lerp(targetPos, 0.1)
        groupRef.current.quaternion.slerp(targetQuat, 0.1)
    })

    return (
        <group ref={groupRef}>
            {/* LAB CONTENT */}
            <Html
                transform
                sprite
                isObject={false}
                distanceFactor={1.5}
                zIndexRange={[100, 0]}
                style={{
                    opacity: section === 'lab' ? 1 : 0,
                    transition: 'opacity 0.5s',
                    pointerEvents: section === 'lab' ? 'auto' : 'none',
                    transform: 'scale(1)' // Ensure no accidental scaling
                }}
            >
                <LabPanel active={section === 'lab'} />
            </Html>

            {/* INFO CONTENT */}
            <Html
                transform
                sprite
                isObject={false}
                distanceFactor={1.5}
                zIndexRange={[100, 0]}
                position={[0, 0.2, 0]} // Slight vertical adjustment for text
                style={{
                    opacity: section === 'info' ? 1 : 0,
                    transition: 'opacity 0.5s',
                    pointerEvents: section === 'info' ? 'auto' : 'none',
                }}
            >
                <InfoPanel active={section === 'info'} />
            </Html>

            {/* PRODUCTS CONTENT */}
            <Html
                transform
                sprite
                isObject={false}
                distanceFactor={1.5}
                zIndexRange={[100, 0]}
                style={{
                    opacity: section === 'products' ? 1 : 0,
                    transition: 'opacity 0.5s',
                    pointerEvents: section === 'products' ? 'auto' : 'none'
                }}
            >
                <ProductsPanel active={section === 'products'} />
            </Html>
        </group>
    )
}
