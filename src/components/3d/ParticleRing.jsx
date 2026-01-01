import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export default function ParticleRing() {
    const pointsRef = useRef()

    // Create ring particles with scattered distribution
    const { positions, count } = useMemo(() => {
        const particleCount = 1500 // More particles for denser, wider look
        const positions = new Float32Array(particleCount * 3)

        const innerRadius = 0.6  // Start closer
        const outerRadius = 2.8  // Extend further - wider ring
        const heightVariation = 0.4 // Much more vertical thickness
        const radialScatter = 0.8 // Strong radial scatter for width

        for (let i = 0; i < particleCount; i++) {
            // Random angle around the ring
            const angle = (i / particleCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.3

            // Base radius with extra random scatter for width
            const baseRadius = innerRadius + Math.random() * (outerRadius - innerRadius)
            const radius = baseRadius + (Math.random() - 0.5) * radialScatter

            // Slight vertical variation
            const y = (Math.random() - 0.5) * heightVariation

            positions[i * 3] = Math.cos(angle) * radius
            positions[i * 3 + 1] = y
            positions[i * 3 + 2] = Math.sin(angle) * radius
        }

        return { positions, count: particleCount }
    }, [])

    // Slow rotation
    useFrame((state) => {
        if (pointsRef.current) {
            pointsRef.current.rotation.y = state.clock.elapsedTime * 0.05
        }
    })

    return (
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
                size={0.04}
                color="#ffffff"
                transparent
                opacity={0.6}
                sizeAttenuation
                blending={THREE.AdditiveBlending}
                depthWrite={false}
            />
        </points>
    )
}
