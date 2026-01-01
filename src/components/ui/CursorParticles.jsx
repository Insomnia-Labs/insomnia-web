import { useEffect, useRef } from 'react'
import './CursorParticles.css'

export default function CursorParticles() {
    const containerRef = useRef(null)
    const particlesRef = useRef([])
    const mousePos = useRef({ x: 0, y: 0 })
    const lastEmitTime = useRef(0)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        // Update mouse position
        const handleMouseMove = (e) => {
            mousePos.current = { x: e.clientX, y: e.clientY }

            const now = Date.now()
            // Emit particles more frequently when mouse moves
            if (now - lastEmitTime.current > 30) { // Emit every 30ms
                emitParticles(e.clientX, e.clientY)
                lastEmitTime.current = now
            }
        }

        const emitParticles = (x, y) => {
            const count = Math.random() * 3 + 2 // 2-5 particles per emit

            for (let i = 0; i < count; i++) {
                const particle = document.createElement('div')
                particle.className = 'cursor-particle'

                // Random angle for emission
                const angle = Math.random() * Math.PI * 2
                const speed = Math.random() * 100 + 50 // 50-150px
                const lifetime = Math.random() * 1000 + 800 // 800-1800ms

                // Velocity
                const vx = Math.cos(angle) * speed
                const vy = Math.sin(angle) * speed

                // Size variation (matching ring particles)
                const size = Math.random() * 4 + 2 // 2-6px

                particle.style.left = x + 'px'
                particle.style.top = y + 'px'
                particle.style.width = size + 'px'
                particle.style.height = size + 'px'
                particle.style.setProperty('--vx', vx + 'px')
                particle.style.setProperty('--vy', vy + 'px')
                particle.style.setProperty('--lifetime', lifetime + 'ms')

                container.appendChild(particle)
                particlesRef.current.push(particle)

                // Remove particle after animation
                setTimeout(() => {
                    particle.remove()
                    particlesRef.current = particlesRef.current.filter(p => p !== particle)
                }, lifetime)
            }
        }

        window.addEventListener('mousemove', handleMouseMove)

        return () => {
            window.removeEventListener('mousemove', handleMouseMove)
            // Clean up all particles
            particlesRef.current.forEach(p => p.remove())
            particlesRef.current = []
        }
    }, [])

    return <div ref={containerRef} className="cursor-particles-container" />
}
