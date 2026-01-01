import { useRef, useMemo, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Shader for cursor particles flying toward black hole
const cursorParticleVertex = `
uniform float uTime;
attribute float aStartTime;
attribute vec3 aStartPosition;
attribute vec3 aVelocity;
attribute float aSize;
attribute float aLifetime;
varying float vAlpha;

void main() {
  float age = uTime - aStartTime;
  float life = clamp(age / aLifetime, 0.0, 1.0);
  
  // Particle position: start position + trajectory toward black hole
  vec3 blackHolePos = vec3(0.0, 0.0, 0.0);
  vec3 toBlackHole = normalize(blackHolePos - aStartPosition);
  float initialDistance = length(aStartPosition - blackHolePos);
  
  // Calculate velocity toward black hole (increases with time due to gravity)
  float gravity = 5.0;
  float velocityMagnitude = length(aVelocity) * 2.0 + gravity * age;
  
  // Move toward black hole, but limit distance to prevent passing through
  float travelDistance = velocityMagnitude * age;
  travelDistance = min(travelDistance, initialDistance - 0.5); // Stop 0.5 units before center
  
  vec3 pos = aStartPosition + toBlackHole * travelDistance;
  
  // Distance to black hole
  float distanceToBlackHole = length(pos - blackHolePos);
  
  // Fade in quickly at start
  float fadeIn = smoothstep(0.0, 0.1, life);
  
  // EXTREME brightness increase as particle gets closer (heating effect)
  // Normal at distance 3.0+, EXTREMELY bright at distance 0.8
  float brightness = smoothstep(3.0, 0.8, distanceToBlackHole) * 9.0 + 1.0; // 1.0 to 10.0 multiplier!!
  
  // Fade out before reaching stop point - disappear at distance 0.6-1.2
  float fadeOut = smoothstep(0.6, 1.2, distanceToBlackHole);
  
  vAlpha = fadeIn * fadeOut * brightness;
  
  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = aSize * (35.0 / -viewPosition.z);
}
`

const cursorParticleFragment = `
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  
  // White particles to match monochrome aesthetic
  vec3 color = vec3(1.0, 1.0, 1.0);
  
  // Soft glow
  float intensity = 1.0 - smoothstep(0.0, 0.5, d);
  
  // Moderately brighter than background (0.9 instead of 0.6, not 1.5)
  gl_FragColor = vec4(color, vAlpha * intensity * 0.9);
}
`

export default function CursorParticles3D() {
    const { camera, gl, size } = useThree()
    const pointsRef = useRef()
    const particlesDataRef = useRef([])
    const maxParticles = 800 // Optimized for better performance
    const mouseRef = useRef({ x: 0, y: 0 })
    const prevMouseRef = useRef({ x: 0, y: 0 })
    const lastEmitTimeRef = useRef(0)
    const isMovingRef = useRef(false)

    // Create buffers for particles
    const { geometry, material } = useMemo(() => {
        const geo = new THREE.BufferGeometry()

        const positions = new Float32Array(maxParticles * 3)
        const startTimes = new Float32Array(maxParticles)
        const startPositions = new Float32Array(maxParticles * 3)
        const velocities = new Float32Array(maxParticles * 3)
        const sizes = new Float32Array(maxParticles)
        const lifetimes = new Float32Array(maxParticles)

        // Initialize with inactive particles
        for (let i = 0; i < maxParticles; i++) {
            startTimes[i] = -999999 // Very old = inactive
            sizes[i] = Math.random() * 0.6 + 0.6 // Moderate size: 0.6-1.2
            lifetimes[i] = 3.0 + Math.random() * 2.0 // 3-5 seconds
        }

        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geo.setAttribute('aStartTime', new THREE.BufferAttribute(startTimes, 1))
        geo.setAttribute('aStartPosition', new THREE.BufferAttribute(startPositions, 3))
        geo.setAttribute('aVelocity', new THREE.BufferAttribute(velocities, 3))
        geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
        geo.setAttribute('aLifetime', new THREE.BufferAttribute(lifetimes, 1))

        const mat = new THREE.ShaderMaterial({
            vertexShader: cursorParticleVertex,
            fragmentShader: cursorParticleFragment,
            uniforms: {
                uTime: { value: 0 }
            },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        })

        return { geometry: geo, material: mat }
    }, [])

    const nextParticleIndexRef = useRef(0)

    const emitParticle = (screenX, screenY, currentTime) => {
        // Convert screen coordinates to normalized device coordinates (-1 to +1)
        const x = (screenX / size.width) * 2 - 1
        const y = -(screenY / size.height) * 2 + 1

        // Create a point in 3D space in front of camera
        const depth = 5 + Math.random() * 3 // Random depth 5-8 units from camera
        const ndc = new THREE.Vector3(x, y, 0.5)
        ndc.unproject(camera)

        const direction = ndc.sub(camera.position).normalize()
        const startPos = camera.position.clone().add(direction.multiplyScalar(depth))

        // Add some randomness to starting position
        startPos.x += (Math.random() - 0.5) * 0.5
        startPos.y += (Math.random() - 0.5) * 0.5
        startPos.z += (Math.random() - 0.5) * 0.5

        // Initial velocity (small random velocity, gravity will pull it)
        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3
        )

        const idx = nextParticleIndexRef.current

        const startPositions = geometry.attributes.aStartPosition.array
        const velocities = geometry.attributes.aVelocity.array
        const startTimes = geometry.attributes.aStartTime.array

        startPositions[idx * 3] = startPos.x
        startPositions[idx * 3 + 1] = startPos.y
        startPositions[idx * 3 + 2] = startPos.z

        velocities[idx * 3] = vel.x
        velocities[idx * 3 + 1] = vel.y
        velocities[idx * 3 + 2] = vel.z

        startTimes[idx] = currentTime

        geometry.attributes.aStartPosition.needsUpdate = true
        geometry.attributes.aVelocity.needsUpdate = true
        geometry.attributes.aStartTime.needsUpdate = true

        nextParticleIndexRef.current = (idx + 1) % maxParticles
    }

    useEffect(() => {
        const handleMouseMove = (e) => {
            prevMouseRef.current = { ...mouseRef.current }
            mouseRef.current = { x: e.clientX, y: e.clientY }

            // Calculate movement delta
            const dx = mouseRef.current.x - prevMouseRef.current.x
            const dy = mouseRef.current.y - prevMouseRef.current.y
            const movement = Math.sqrt(dx * dx + dy * dy)

            // Consider mouse "moving" if delta > 2 pixels
            isMovingRef.current = movement > 2
        }

        window.addEventListener('mousemove', handleMouseMove)
        return () => window.removeEventListener('mousemove', handleMouseMove)
    }, [])

    useFrame((state) => {
        if (material) {
            material.uniforms.uTime.value = state.clock.elapsedTime
        }

        const now = state.clock.elapsedTime

        // Only emit particles when mouse is moving (desabled)
        // if (isMovingRef.current && now - lastEmitTimeRef.current > 0.05) { 
        //     const count = Math.floor(Math.random() * 3) + 3 
        //     for (let i = 0; i < count; i++) {
        //         emitParticle(mouseRef.current.x, mouseRef.current.y, now)
        //     }
        //     lastEmitTimeRef.current = now
        // }
    })

    return (
        <points ref={pointsRef} geometry={geometry} material={material} />
    )
}
