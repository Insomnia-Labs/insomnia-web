import React, { useEffect, useRef, useState } from 'react'

export default function VoidGame({ onClose, settings = { difficulty: 'normal' } }) {
    const canvasRef = useRef(null)
    const [score, setScore] = useState(0)
    const [level, setLevel] = useState(1)
    const [gameOver, setGameOver] = useState(false)
    const [highScore, setHighScore] = useState(() => parseInt(localStorage.getItem('void_game_highscore') || '0'))

    // Game state refs (for performance in loop)
    const gameState = useRef({
        player: { x: 0, y: 0, angle: 0 },
        bullets: [], // { x, y, vx, vy }
        enemies: [], // { x, y, vx, vy, size, hp, type, color }
        particles: [], // { x, y, vx, vy, life, color }
        message: null, // { text, life }
        lastShot: 0,
        score: 0,
        level: 1,
        active: true,
        frameCount: 0
    })

    const mouse = useRef({ x: 0, y: 0, down: false })

    useEffect(() => {
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        let animationFrameId

        // Resize handler
        const resize = () => {
            canvas.width = window.innerWidth
            canvas.height = window.innerHeight
            gameState.current.player.x = canvas.width / 2
            gameState.current.player.y = canvas.height / 2

            // Initialize mouse to center to prevent teleporting
            if (mouse.current.x === 0 && mouse.current.y === 0) {
                mouse.current.x = canvas.width / 2
                mouse.current.y = canvas.height / 2
            }
        }
        window.addEventListener('resize', resize)
        resize()

        // Input handlers
        const onMouseMove = (e) => {
            mouse.current.x = e.clientX
            mouse.current.y = e.clientY
        }
        const onMouseDown = () => { mouse.current.down = true }
        const onMouseUp = () => { mouse.current.down = false }

        // ESC key handler
        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                onClose()
            }
        }

        window.addEventListener('mousemove', onMouseMove)
        window.addEventListener('mousedown', onMouseDown)
        window.addEventListener('mouseup', onMouseUp)
        window.addEventListener('keydown', onKeyDown)

        // Game Constants - Adjusted by difficulty
        const PLAYER_SPEED = 0.12
        const BULLET_SPEED = 18

        // Difficulty multipliers
        const difficultySettings = {
            easy: { spawnRate: 70, speedMultiplier: 0.7 },
            normal: { spawnRate: 50, speedMultiplier: 1.0 },
            hard: { spawnRate: 30, speedMultiplier: 1.5 }
        }

        const currentDifficulty = difficultySettings[settings.difficulty] || difficultySettings.normal


        // Helper: Draw glowing circle
        const drawCircle = (x, y, radius, color = 'white', fill = false) => {
            ctx.shadowBlur = fill ? 15 : 5
            ctx.shadowColor = color
            ctx[fill ? 'fillStyle' : 'strokeStyle'] = color
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(x, y, radius, 0, Math.PI * 2)
            ctx[fill ? 'fill' : 'stroke']()
            ctx.shadowBlur = 0
        }

        // Helper: Draw Enemy
        const drawEnemy = (e) => {
            ctx.shadowBlur = 10
            ctx.shadowColor = e.color
            ctx.strokeStyle = e.color
            ctx.lineWidth = 2

            ctx.save()
            ctx.translate(e.x, e.y)

            if (e.type === 'chaser') {
                // Triangle for chaser
                ctx.rotate(Math.atan2(e.vy, e.vx))
                ctx.beginPath()
                ctx.moveTo(e.size, 0)
                ctx.lineTo(-e.size, -e.size / 1.5)
                ctx.lineTo(-e.size, e.size / 1.5)
                ctx.closePath()
                ctx.stroke()
            } else if (e.type === 'tank') {
                // Square for tank
                ctx.rotate(gameState.current.frameCount * 0.02)
                ctx.strokeRect(-e.size, -e.size, e.size * 2, e.size * 2)
                // Inner core
                ctx.fillStyle = e.color
                ctx.globalAlpha = 0.5
                ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size)
                ctx.globalAlpha = 1.0
            } else {
                // Spikey Circle for basic
                const points = 3 + Math.floor(e.size / 5)
                ctx.beginPath()
                for (let k = 0; k <= points; k++) {
                    const ang = (k / points) * Math.PI * 2 + gameState.current.frameCount * 0.05
                    const px = Math.cos(ang) * e.size
                    const py = Math.sin(ang) * e.size
                    if (k === 0) ctx.moveTo(px, py)
                    else ctx.lineTo(px, py)
                }
                ctx.closePath()
                ctx.stroke()
            }

            ctx.restore()
            ctx.shadowBlur = 0
        }

        // Game Loop
        const loop = () => {
            if (!ctx || !canvas) return

            const state = gameState.current
            if (!state.active) return

            state.frameCount++

            // Dynamic Difficulty
            const newLevel = Math.floor(state.score / 1000) + 1
            if (newLevel > state.level) {
                state.level = newLevel
                setLevel(newLevel)
                state.message = { text: `LEVEL ${newLevel}`, life: 120 }
            }

            const SPAWN_RATE = Math.max(20, currentDifficulty.spawnRate - state.level * 5)

            // Clear screen
            ctx.fillStyle = 'rgba(5, 5, 5, 0.25)' // Slightly faster fade
            ctx.fillRect(0, 0, canvas.width, canvas.height)

            // Update Player
            state.player.x += (mouse.current.x - state.player.x) * PLAYER_SPEED
            state.player.y += (mouse.current.y - state.player.y) * PLAYER_SPEED

            // Draw Player
            const pSize = 12
            ctx.save()
            ctx.translate(state.player.x, state.player.y)

            drawCircle(0, 0, pSize, '#fff')
            drawCircle(0, 0, 4, '#fff', true)

            // Crosshair rings
            const ringSize = 25 + Math.sin(state.frameCount * 0.15) * 3
            ctx.strokeStyle = 'rgba(255,255,255,0.4)'
            ctx.beginPath()
            ctx.arc(0, 0, ringSize, 0, Math.PI * 2)
            ctx.stroke()

            ctx.restore()

            // Shooting Logic
            if (mouse.current.down && state.frameCount - state.lastShot > 7) {
                // Auto-aim at nearest
                let nearest = null;
                let minDist = Infinity;
                state.enemies.forEach(e => {
                    const dist = Math.hypot(e.x - state.player.x, e.y - state.player.y)
                    if (dist < minDist) { minDist = dist; nearest = e; }
                })

                if (nearest && nearest.itemType !== 'particle') { // Simple check
                    // Predict aim? Nah, too op.
                    const angle = Math.atan2(nearest.y - state.player.y, nearest.x - state.player.x)
                    const variance = (Math.random() - 0.5) * 0.1 // Slight spread

                    state.bullets.push({
                        x: state.player.x,
                        y: state.player.y,
                        vx: Math.cos(angle + variance) * BULLET_SPEED,
                        vy: Math.sin(angle + variance) * BULLET_SPEED
                    })
                    state.lastShot = state.frameCount
                } else if (!nearest) {
                    // Random spread spray when no enemies
                    const angle = state.frameCount * 0.2
                    for (let i = 0; i < 3; i++) {
                        const a = angle + (i * 2.09); // 120 deg
                        state.bullets.push({ x: state.player.x, y: state.player.y, vx: Math.cos(a) * BULLET_SPEED, vy: Math.sin(a) * BULLET_SPEED })
                    }
                    state.lastShot = state.frameCount
                }
            }

            // Spawn Enemies
            if (state.frameCount % SPAWN_RATE === 0) {
                const side = Math.floor(Math.random() * 4)
                let x, y
                if (side === 0) { x = Math.random() * canvas.width; y = -50 }
                else if (side === 1) { x = canvas.width + 50; y = Math.random() * canvas.height }
                else if (side === 2) { x = Math.random() * canvas.width; y = canvas.height + 50 }
                else { x = -50; y = Math.random() * canvas.height }

                // Determine Type
                let type = 'basic'
                let size = 15 + Math.random() * 10
                let hp = 1
                let speed = (2 + state.level * 0.2) * currentDifficulty.speedMultiplier
                let color = '#ff5555'

                const roll = Math.random()

                // Level 2+: Chasers allowed (20% chance + level scaling)
                if (state.level >= 2 && roll < 0.3) {
                    type = 'chaser'
                    speed = (4 + state.level * 0.3) * currentDifficulty.speedMultiplier
                    color = '#55ff55'
                    size = 12
                    hp = 2
                }

                // Level 3+: Tanks allowed (10% chance)
                if (state.level >= 3 && roll > 0.85) {
                    type = 'tank'
                    speed = (1 + state.level * 0.1) * currentDifficulty.speedMultiplier
                    color = '#5555ff'
                    size = 30
                    hp = 10 + state.level * 2
                }

                const angle = Math.atan2(state.player.y - y, state.player.x - x)
                state.enemies.push({
                    x, y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    size, hp, type, color
                })
            }

            // Update Bullets
            for (let i = state.bullets.length - 1; i >= 0; i--) {
                const b = state.bullets[i];
                b.x += b.vx;
                b.y += b.vy;

                drawCircle(b.x, b.y, 3, '#fff', true)

                if (b.x < 0 || b.x > canvas.width || b.y < 0 || b.y > canvas.height) {
                    state.bullets.splice(i, 1)
                    continue
                }

                // Collision
                let hit = false
                for (let j = state.enemies.length - 1; j >= 0; j--) {
                    const e = state.enemies[j]
                    // Box collision roughly or circle
                    const dist = Math.hypot(b.x - e.x, b.y - e.y)
                    if (dist < e.size + 10) {
                        // Hit check
                        e.hp--
                        hit = true

                        // Flash effect?

                        if (e.hp <= 0) {
                            state.enemies.splice(j, 1)

                            // Explosion
                            const particleCount = e.type === 'tank' ? 30 : 10
                            for (let k = 0; k < particleCount; k++) {
                                state.particles.push({
                                    x: e.x, y: e.y,
                                    vx: (Math.random() - 0.5) * 8,
                                    vy: (Math.random() - 0.5) * 8,
                                    life: 40 + Math.random() * 20,
                                    color: e.color
                                })
                            }

                            const scoreAdd = e.type === 'tank' ? 500 : (e.type === 'chaser' ? 200 : 100)
                            state.score += scoreAdd
                            setScore(state.score)
                        } else {
                            // Hit effect (sparks)
                            for (let k = 0; k < 3; k++) {
                                state.particles.push({
                                    x: b.x, y: b.y,
                                    vx: (Math.random() - 0.5) * 5,
                                    vy: (Math.random() - 0.5) * 5,
                                    life: 10,
                                    color: '#fff'
                                })
                            }
                        }
                        break
                    }
                }
                if (hit) state.bullets.splice(i, 1) // Remove bullet on hit
            }

            // Update Enemies
            for (let i = state.enemies.length - 1; i >= 0; i--) {
                const e = state.enemies[i]

                // AI Movement
                if (e.type === 'chaser') {
                    // Home in on player
                    const angle = Math.atan2(state.player.y - e.y, state.player.x - e.x)
                    // Lerp velocity for smoother turning
                    e.vx = e.vx * 0.9 + Math.cos(angle) * 0.5
                    e.vy = e.vy * 0.9 + Math.sin(angle) * 0.5
                    // Normalize to max speed? Nah physics feel implies drift
                }

                e.x += e.vx
                e.y += e.vy

                drawEnemy(e)

                // Collision with player
                const dist = Math.hypot(e.x - state.player.x, e.y - state.player.y)
                if (dist < e.size + 8) {
                    state.active = false
                    setGameOver(true)
                    if (state.score > highScore) {
                        setHighScore(state.score)
                        localStorage.setItem('void_game_highscore', state.score.toString())
                    }
                }
            }

            // Update Particles
            for (let i = state.particles.length - 1; i >= 0; i--) {
                const p = state.particles[i]
                p.x += p.vx
                p.y += p.vy
                p.life--
                p.vx *= 0.95
                p.vy *= 0.95

                ctx.globalAlpha = p.life / 60
                ctx.fillStyle = p.color
                ctx.fillRect(p.x, p.y, 3, 3)
                ctx.globalAlpha = 1.0

                if (p.life <= 0) state.particles.splice(i, 1)
            }

            // Floating Messages
            if (state.message) {
                state.message.life--
                ctx.font = 'bold 40px "Space Grotesk", sans-serif'
                ctx.textAlign = 'center'
                ctx.fillStyle = `rgba(255, 255, 255, ${state.message.life / 30})`
                ctx.fillText(state.message.text, canvas.width / 2, canvas.height / 3)
                if (state.message.life <= 0) state.message = null
            }

            animationFrameId = requestAnimationFrame(loop)
        }

        loop()

        return () => {
            window.removeEventListener('resize', resize)
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mousedown', onMouseDown)
            window.removeEventListener('mouseup', onMouseUp)
            window.removeEventListener('keydown', onKeyDown)
            cancelAnimationFrame(animationFrameId)
        }
    }, [gameOver])

    // Restart handler
    const handleRestart = () => {
        gameState.current = {
            player: { x: window.innerWidth / 2, y: window.innerHeight / 2, angle: 0 },
            bullets: [],
            enemies: [],
            particles: [],
            message: { text: "SYSTEM REBOOTED", life: 60 },
            lastShot: 0,
            score: 0,
            level: 1,
            active: true,
            frameCount: 0
        }
        setScore(0)
        setLevel(1)
        setGameOver(false)
    }

    return (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center font-mono">
            <canvas ref={canvasRef} className="absolute inset-0 block cursor-none" />

            {/* UI Overlay */}
            <div className="absolute top-8 left-0 right-0 flex justify-between items-start px-12 pointer-events-none select-none z-10">
                <div className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
                    <h2 className="text-xl opacity-50">SCORE</h2>
                    <div className="text-4xl font-bold tracking-widest">{score.toString().padStart(6, '0')}</div>
                </div>

                <div className="text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] text-center">
                    <h2 className="text-xl opacity-50">THREAT LEVEL</h2>
                    <div className="text-4xl font-bold tracking-widest text-red-500">{level}</div>
                </div>

                <div className="text-right text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)] flex flex-col gap-4">
                    <button
                        onClick={onClose}
                        className="self-end text-white/50 hover:text-white transition-colors text-sm font-bold pointer-events-auto px-3 py-1 border border-white/20 hover:border-white/60"
                    >
                        [ESC]
                    </button>

                    <div>
                        <h2 className="text-xl opacity-50">HI-SCORE</h2>
                        <div className="text-4xl font-bold tracking-widest">{highScore.toString().padStart(6, '0')}</div>
                    </div>
                </div>
            </div>

            {gameOver && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 pointer-events-auto z-30">
                    <h1 className="text-8xl font-black text-red-600 tracking-[0.2em] mb-4 drop-shadow-[0_0_50px_rgba(255,0,0,0.6)] animate-pulse">
                        TERMINATED
                    </h1>
                    <p className="text-white/70 mb-12 text-2xl font-light tracking-widest">
                        SCORE: <span className="text-white font-bold">{score}</span>
                    </p>
                    <div className="flex gap-6">
                        <button
                            onClick={handleRestart}
                            className="px-12 py-4 bg-white text-black text-xl font-bold tracking-[0.2em] hover:scale-105 hover:bg-red-500 hover:text-white transition-all duration-300"
                        >
                            REBOOT SYSTEM
                        </button>
                        <button
                            onClick={onClose}
                            className="px-12 py-4 border border-white/20 text-white text-xl font-bold tracking-[0.2em] hover:bg-white/10 transition-colors"
                        >
                            ABORT
                        </button>
                    </div>
                </div>
            )}

            <div className="absolute bottom-12 text-white/20 text-xs tracking-[0.5em] pointer-events-none w-full text-center">
                MOUSE TO NAVIGATE // HOLD CLICK TO ENGAGE
            </div>
        </div>
    )
}
