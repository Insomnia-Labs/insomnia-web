import React from 'react'
import { useStore } from '../../store/useStore'
import { Home, FlaskConical, Cpu, ShieldAlert } from 'lucide-react'

export default function BottomNav() {
    const section = useStore((state) => state.section)
    const setSection = useStore((state) => state.setSection)

    const navItems = [
        { id: 'home', icon: Home, label: 'BASE' },
        { id: 'lab', icon: FlaskConical, label: 'R&D' },
        { id: 'info', icon: Cpu, label: 'SYSTEM' },
        { id: 'products', icon: ShieldAlert, label: 'ARMORY' },
    ]

    return (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden pb-safe">
            {/* Glass Background */}
            <div className="absolute inset-0 bg-black/80 backdrop-blur-xl border-t border-white/10" />

            <div className="relative flex justify-around items-center px-2 py-4">
                {navItems.map((item) => {
                    const isActive = section === item.id
                    const Icon = item.icon

                    return (
                        <button
                            key={item.id}
                            onClick={() => setSection(item.id)}
                            className={`
                                flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all duration-300
                                ${isActive ? 'text-white' : 'text-white/40 hover:text-white/70'}
                            `}
                        >
                            <div className={`
                                relative p-2 rounded-lg overflow-hidden transition-all duration-300
                                ${isActive ? 'bg-white/10' : 'bg-transparent'}
                            `}>
                                <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                                {isActive && (
                                    <div className="absolute inset-0 bg-blue-500/20 blur-md" />
                                )}
                            </div>
                            <span className="text-[9px] font-mono tracking-widest uppercase">
                                {item.label}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
