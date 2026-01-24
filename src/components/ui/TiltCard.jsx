import React, { useRef, useMemo, useEffect, useCallback } from 'react'
import './ProfileCard.css'

const clamp = (v, min = 0, max = 100) => Math.min(Math.max(v, min), max)
const round = (v, precision = 3) => parseFloat(v.toFixed(precision))
const adjust = (v, fMin, fMax, tMin, tMax) => round(tMin + ((tMax - tMin) * (v - fMin)) / (fMax - fMin))

const TiltCard = ({
    children,
    className = '',
    active = true,
    enableTilt = true
}) => {
    const wrapRef = useRef(null)
    const shellRef = useRef(null)
    const leaveRafRef = useRef(null)

    const tiltEngine = useMemo(() => {
        if (!enableTilt) return null

        let rafId = null
        let running = false
        let lastTs = 0
        let currentX = 0
        let currentY = 0
        let targetX = 0
        let targetY = 0

        const DEFAULT_TAU = 0.14

        const setVarsFromXY = (x, y) => {
            const shell = shellRef.current
            const wrap = wrapRef.current
            if (!shell || !wrap) return

            const width = shell.clientWidth || 1
            const height = shell.clientHeight || 1

            const percentX = clamp((100 / width) * x)
            const percentY = clamp((100 / height) * y)

            const centerX = percentX - 50
            const centerY = percentY - 50

            const vars = {
                '--pointer-x': `${percentX}%`,
                '--pointer-y': `${percentY}%`,
                '--background-x': `${adjust(percentX, 0, 100, 35, 65)}%`,
                '--background-y': `${adjust(percentY, 0, 100, 35, 65)}%`,
                '--pointer-from-center': `${clamp(Math.hypot(percentY - 50, percentX - 50) / 50, 0, 1)}`,
                '--pointer-from-top': `${percentY / 100}`,
                '--pointer-from-left': `${percentX / 100}`,
                '--rotate-x': `${round(-(centerX / 5))}deg`,
                '--rotate-y': `${round(centerY / 4)}deg`
            }

            for (const [k, v] of Object.entries(vars)) {
                wrap.style.setProperty(k, v)
            }
        }

        const step = (ts) => {
            if (!running) return
            if (lastTs === 0) lastTs = ts
            const dt = (ts - lastTs) / 1000
            lastTs = ts

            const k = 1 - Math.exp(-dt / DEFAULT_TAU)

            currentX += (targetX - currentX) * k
            currentY += (targetY - currentY) * k

            setVarsFromXY(currentX, currentY)

            const stillFar = Math.abs(targetX - currentX) > 0.05 || Math.abs(targetY - currentY) > 0.05

            if (stillFar || document.hasFocus()) {
                rafId = requestAnimationFrame(step)
            } else {
                running = false
                lastTs = 0
                if (rafId) {
                    cancelAnimationFrame(rafId)
                    rafId = null
                }
            }
        }

        const start = () => {
            if (running) return
            running = true
            lastTs = 0
            rafId = requestAnimationFrame(step)
        }

        return {
            setTarget(x, y) {
                targetX = x
                targetY = y
                start()
            },
            toCenter() {
                if (!shellRef.current) return
                // Send to center
                const w = shellRef.current.clientWidth
                const h = shellRef.current.clientHeight
                this.setTarget(w / 2, h / 2)
            },
            getCurrent() {
                return { x: currentX, y: currentY, tx: targetX, ty: targetY }
            },
            cancel() {
                if (rafId) cancelAnimationFrame(rafId)
                rafId = null
                running = false
            }
        }
    }, [enableTilt])

    const handlePointerMove = useCallback((e) => {
        if (!shellRef.current || !tiltEngine) return
        const rect = shellRef.current.getBoundingClientRect()
        const x = e.clientX - rect.left
        const y = e.clientY - rect.top
        tiltEngine.setTarget(x, y)
    }, [tiltEngine])

    const handlePointerLeave = useCallback(() => {
        if (!shellRef.current || !tiltEngine) return

        tiltEngine.toCenter()

        const checkSettle = () => {
            const { x, y, tx, ty } = tiltEngine.getCurrent()
            const settled = Math.hypot(tx - x, ty - y) < 0.6
            if (settled) {
                shellRef.current?.classList.remove('active')
                leaveRafRef.current = null
            } else {
                leaveRafRef.current = requestAnimationFrame(checkSettle)
            }
        }
        if (leaveRafRef.current) cancelAnimationFrame(leaveRafRef.current)
        leaveRafRef.current = requestAnimationFrame(checkSettle)
    }, [tiltEngine])

    const handlePointerEnter = useCallback((e) => {
        if (!shellRef.current) return
        shellRef.current.classList.add('active')
        handlePointerMove(e)
    }, [handlePointerMove])

    useEffect(() => {
        // Initial center
        if (tiltEngine && shellRef.current) {
            const w = shellRef.current.clientWidth || 300
            const h = shellRef.current.clientHeight || 300
            tiltEngine.setTarget(w / 2, h / 2)
        }
        return () => tiltEngine?.cancel()
    }, [tiltEngine])

    return (
        <div
            ref={wrapRef}
            className={`pc-card-wrapper ${className} ${active ? 'pointer-events-auto' : 'pointer-events-none'}`}
            style={{ opacity: active ? 1 : 0, transition: 'opacity 0.5s' }}
        >
            <div className="pc-behind" />

            <div
                ref={shellRef}
                className="pc-card-shell"
                onPointerMove={active ? handlePointerMove : undefined}
                onPointerEnter={active ? handlePointerEnter : undefined}
                onPointerLeave={active ? handlePointerLeave : undefined}
            >
                <div className="pc-card">
                    <div className="pc-inside">
                        <div className="pc-shine" />
                        <div className="pc-glare" />
                        <div className="pc-content-container">
                            {children}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default TiltCard
