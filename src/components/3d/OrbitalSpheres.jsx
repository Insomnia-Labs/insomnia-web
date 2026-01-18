import { useRef, useState, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { useStore } from '../../store/useStore'
import { FlaskConical, Info, Package } from 'lucide-react'
import gsap from 'gsap'

// Create circular particle texture
const createCircleTexture = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    const ctx = canvas.getContext('2d')

    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
    gradient.addColorStop(0.85, 'rgba(255, 255, 255, 1)')  // Solid until 85%
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')     // Quick fade

    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)

    const texture = new THREE.CanvasTexture(canvas)
    texture.needsUpdate = true
    return texture
}

const circleTexture = createCircleTexture()

// Reusable objects to prevent GC thrashing
const _orbitalPos = new THREE.Vector3()
const _targetPos = new THREE.Vector3()
const _inverseMatrix = new THREE.Matrix4()
const _rayOrigin = new THREE.Vector3()
const _rayDir = new THREE.Vector3()
const _localRay = new THREE.Ray()
const _closestPoint = new THREE.Vector3()

const SphereButton = ({ baseAngle, radius, icon: Icon, label, id, isActive }) => {
    const { raycaster, pointer, camera } = useThree()
    const section = useStore((state) => state.section)
    const setSection = useStore((state) => state.setSection)
    const pointsRef = useRef()
    const hitboxRef = useRef()
    const basePositionsRef = useRef()
    const explosionRef = useRef(0)
    const [hovered, setHovered] = useState(false)
    const [position, setPosition] = useState([0, 0, 0])

    // Magnetic position state
    const visualPosRef = useRef(new THREE.Vector3())
    const initializedRef = useRef(false)

    // Create particle positions for sphere
    const { positions, count } = useMemo(() => {
        const particleCount = 80 // Reduced from 120 for better performance
        const positions = new Float32Array(particleCount * 3)
        const sphereRadius = 0.15

        for (let i = 0; i < particleCount; i++) {
            // Fibonacci sphere distribution
            const phi = Math.acos(1 - 2 * (i + 0.5) / particleCount)
            const theta = Math.PI * (1 + Math.sqrt(5)) * i

            const x = sphereRadius * Math.sin(phi) * Math.cos(theta)
            const y = sphereRadius * Math.sin(phi) * Math.sin(theta)
            const z = sphereRadius * Math.cos(phi)

            positions[i * 3] = x
            positions[i * 3 + 1] = y
            positions[i * 3 + 2] = z
        }

        return { positions, count: particleCount }
    }, [])

    // Store base positions
    if (!basePositionsRef.current) {
        basePositionsRef.current = new Float32Array(positions)
    }

    // Cache Vector3 for scale lerping to avoid GC
    const targetVec = useMemo(() => new THREE.Vector3(), [])

    const handleClick = () => {
        // Don't trigger if already active
        if (!isActive) {
            setSection(id)
            // Kill any existing explosion animation first
            gsap.killTweensOf(explosionRef)
            // Smoothly animate explosion start
            gsap.to(explosionRef, {
                current: 1.0,
                duration: 0.6,
                ease: 'power2.out',
                overwrite: 'auto'
            })
        }
    }
    useFrame((state, delta) => {
        // Clamp delta to prevent huge jumps/overshoot when returning to tab
        const dt = Math.min(delta, 0.1)

        if (pointsRef.current) {
            // Calculate ideal orbital position
            const angle = baseAngle + state.clock.elapsedTime * 0.15

            _orbitalPos.set(
                radius * Math.cos(angle),
                radius * Math.sin(angle),
                0
            )

            if (!initializedRef.current) {
                visualPosRef.current.copy(_orbitalPos)
                initializedRef.current = true
            }

            // Magnetic attraction logic (only for non-active spheres)
            _targetPos.copy(_orbitalPos)

            if (!isActive && pointsRef.current.parent) {
                const parent = pointsRef.current.parent
                // Update inverse matrix
                _inverseMatrix.copy(parent.matrixWorld).invert()

                // Calculate ray in local space
                state.raycaster.setFromCamera(state.pointer, state.camera)

                // Transform ray origin and direction to local space optimize
                _rayOrigin.copy(state.raycaster.ray.origin).applyMatrix4(_inverseMatrix)
                _rayDir.copy(state.raycaster.ray.direction).transformDirection(_inverseMatrix).normalize()

                _localRay.set(_rayOrigin, _rayDir)

                // Find closest point on ray to the orbital position
                _localRay.closestPointToPoint(_orbitalPos, _closestPoint)

                const dist = _orbitalPos.distanceTo(_closestPoint)
                const outerThreshold = 2.0
                const innerThreshold = 1.2

                if (dist < outerThreshold) {
                    let strength = 0
                    if (dist < innerThreshold) {
                        // Perfect lock when close
                        strength = 1.0
                    } else {
                        // Linear fade out at the edges
                        strength = 1 - (dist - innerThreshold) / (outerThreshold - innerThreshold)
                    }

                    _targetPos.lerp(_closestPoint, strength)
                }
            }

            // Smoothly interpolate visual position - ultra smooth
            // Use clamped dt to avoid shooting off into space on tab switch
            visualPosRef.current.lerp(_targetPos, dt * 3.0)

            // Apply position
            pointsRef.current.position.copy(visualPosRef.current)

            // Only update React state if position changed significantly to avoid re-renders (optimization)
            // Actually setPosition is only used for HTML overlay, maybe throttle it?
            // For now, let's just keep it but note it could be optimized further.
            setPosition([visualPosRef.current.x, visualPosRef.current.y, visualPosRef.current.z])

            // Sync hitbox position
            if (hitboxRef.current) {
                hitboxRef.current.position.copy(visualPosRef.current)
            }

            // Scale: active is larger, hover adds extra size
            let targetScale = 1.0
            if (isActive) {
                targetScale = hovered ? 1.7 : 1.5  // Active: 1.5, active+hover: 1.7
            } else {
                targetScale = hovered ? 1.3 : 1.0  // Normal: 1.0, hover: 1.3
            }

            targetVec.set(targetScale, targetScale, targetScale)
            pointsRef.current.scale.lerp(targetVec, 0.1)

            // Smooth explosion animation with gentle easing
            if (explosionRef.current > 0) {
                explosionRef.current -= dt * 0.8 // Much faster return (was ~0.003/frame)

                // Easing function for ultra-smooth start (easeOutQuint)
                const t = 1 - explosionRef.current
                const eased = 1 - Math.pow(1 - t, 5) // Very gentle start, smooth throughout
                const explosionAmount = (1 - eased) * 0.2 // Very gentle distance

                const posAttr = pointsRef.current.geometry.attributes.position

                for (let i = 0; i < count; i++) {
                    const baseX = basePositionsRef.current[i * 3]
                    const baseY = basePositionsRef.current[i * 3 + 1]
                    const baseZ = basePositionsRef.current[i * 3 + 2]

                    const len = Math.sqrt(baseX * baseX + baseY * baseY + baseZ * baseZ)
                    const dirX = baseX / len
                    const dirY = baseY / len
                    const dirZ = baseZ / len

                    posAttr.array[i * 3] = baseX + dirX * explosionAmount
                    posAttr.array[i * 3 + 1] = baseY + dirY * explosionAmount
                    posAttr.array[i * 3 + 2] = baseZ + dirZ * explosionAmount
                }

                posAttr.needsUpdate = true
            }

            // Manual raycasting check for static cursor (optimized - every 6th frame)
            if (hitboxRef.current && Math.floor(state.clock.elapsedTime * 60) % 6 === 0) {
                raycaster.setFromCamera(pointer, camera)
                const intersects = raycaster.intersectObject(hitboxRef.current, false)

                if (intersects.length > 0) {
                    if (!hovered) setHovered(true)
                } else {
                    if (hovered) setHovered(false)
                }
            }
        }
    })

    return (
        <group>
            <points ref={pointsRef}>
                <bufferGeometry>
                    <bufferAttribute
                        attach="attributes-position"
                        count={count}
                        array={positions}
                        itemSize={3}
                    />
                </bufferGeometry>
                <pointsMaterial
                    size={0.08}
                    map={circleTexture}
                    alphaMap={circleTexture}
                    color="#ffffff"
                    transparent
                    opacity={1.0}
                    sizeAttenuation={true}
                    depthWrite={false}
                    alphaTest={0.01}
                />
            </points>

            {/* Hitbox sphere for interaction */}
            <mesh
                ref={hitboxRef}
                onClick={handleClick}
                onPointerOver={(e) => {
                    e.stopPropagation()
                    setHovered(true)
                }}
                onPointerOut={(e) => {
                    e.stopPropagation()
                    setHovered(false)
                }}
                onPointerMove={(e) => e.stopPropagation()}
            >
                <sphereGeometry args={[0.25, 8, 8]} />
                <meshBasicMaterial
                    transparent
                    opacity={0}
                    visible={false}
                />
            </mesh>

            {/* Label - CSS positioned strictly to the left */}
            <Html
                position={position}
                center
                distanceFactor={6}
                style={{
                    pointerEvents: 'none',
                    transform: 'translate3d(-50%, 0, 0)' // Shift origin left
                }}
            >
                <div
                    className="flex flex-col items-center gap-1 transition-transform duration-500 ease-out"
                    style={{
                        marginRight: '80px', // Push content away from center
                        transform: !isActive ? 'scale(1.3)' : 'scale(0.85)'
                    }}
                >
                    <div
                        className={`
                            px-3 py-1.5 rounded-full backdrop-blur-xl border transition-all duration-500
                            ${isActive ? 'bg-white/30 border-white/50 shadow-[0_0_20px_rgba(255,255,255,0.4)]' : 'bg-black/70 border-white/30'}
                        `}
                    >
                        <Icon size={!isActive ? 20 : 16} className="text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] transition-all duration-500" />
                    </div>
                    <span className={`font-mono uppercase tracking-widest whitespace-nowrap transition-all duration-500 px-2 py-1 rounded ${isActive ? 'text-[10px] text-white font-semibold bg-black/60' : 'text-[12px] text-white/90 bg-black/60'} drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]`}>
                        {label}
                    </span>
                </div>
            </Html>

            {pointsRef.current && (
                <>
                    <pointLight
                        position={pointsRef.current.position}
                        intensity={isActive ? 12.0 : 1.5}
                        distance={6}
                        color="#ffffff"
                    />
                    {/* Additional glow */}
                    <pointLight
                        position={pointsRef.current.position}
                        intensity={isActive ? 5.0 : 0.5}
                        distance={3}
                        color="#88ccff"
                    />
                </>
            )}
        </group>
    )
}

export default function OrbitalSpheres() {
    const section = useStore((state) => state.section)
    const showGame = useStore((state) => state.showGame)
    const showMenu = useStore((state) => state.showMenu)

    const navItems = [
        {
            id: 'lab',
            label: 'Lab',
            icon: FlaskConical,
            angle: 0,
            radius: 2.5,
        },
        {
            id: 'info',
            label: 'Info',
            icon: Info,
            angle: (2 * Math.PI) / 3,
            radius: 3.5,
        },
        {
            id: 'products',
            label: 'Products',
            icon: Package,
            angle: (4 * Math.PI) / 3,
            radius: 3.2,
        },
    ]

    // Hide spheres when game or menu is active
    if (showGame || showMenu) return null

    return (
        <group rotation={[-Math.PI / 2 + 0.2, 0, 0]}>
            {navItems.map((item) => (
                <SphereButton
                    key={item.id}
                    baseAngle={item.angle}
                    radius={item.radius}
                    icon={item.icon}
                    label={item.label}
                    id={item.id}
                    isActive={section === item.id}
                />
            ))}
        </group>
    )
}
