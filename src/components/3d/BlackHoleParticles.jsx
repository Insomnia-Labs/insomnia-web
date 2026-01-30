import React, { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { PERFORMANCE_CONFIG } from '../../constants/performance'

// Shader for Inner Dense Disk (smaller size)
const innerDiskVertexShader = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
attribute float aOrbitRadius;
attribute float aOrbitSpeed;
attribute float aInclination;
attribute float aPhaseOffset;
varying float vAlpha;
varying float vDistance;

void main() {
  vec3 pos = position;
  
  // Orbital parameters
  float angle = uTime * aOrbitSpeed + aPhaseOffset;
  
  // Create spherical orbit with inclination
  float r = aOrbitRadius;
  
  // XY plane rotation
  pos.x = r * cos(angle);
  pos.y = r * sin(angle);
  
  // Apply inclination (tilt orbit out of XY plane)
  float inclinedZ = pos.y * sin(aInclination);
  pos.y = pos.y * cos(aInclination);
  pos.z = inclinedZ;
  
  // Distance from center
  vDistance = r;
  
  // Fade based on distance (closer = brighter)
  vAlpha = smoothstep(10.0, 2.0, r) * 0.7;
  
  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  // Reduced size for finer appearance
  gl_PointSize = aSize * (12.0 / -viewPosition.z);
}
`

// Shader for orbital particles (spherical orbit around black hole)
const orbitalVertexShader = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
attribute float aOrbitRadius;
attribute float aOrbitSpeed;
attribute float aInclination;
attribute float aPhaseOffset;
varying float vAlpha;
varying float vDistance;

void main() {
  vec3 pos = position;
  
  // Orbital parameters
  float angle = uTime * aOrbitSpeed + aPhaseOffset;
  
  // Create spherical orbit with inclination
  float r = aOrbitRadius;
  
  // XY plane rotation
  pos.x = r * cos(angle);
  pos.y = r * sin(angle);
  
  // Apply inclination (tilt orbit out of XY plane)
  float inclinedZ = pos.y * sin(aInclination);
  pos.y = pos.y * cos(aInclination);
  pos.z = inclinedZ;
  
  // Distance from center
  vDistance = r;
  
  // Fade based on distance (closer = brighter due to temperature)
  vAlpha = smoothstep(10.0, 2.0, r) * 0.7;
  
  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = aSize * (25.0 / -viewPosition.z);
}
`

const orbitalFragmentShader = `
varying float vAlpha;
varying float vDistance;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  
  // Pure white particles
  vec3 color = vec3(1.0, 1.0, 1.0);
  
  float intensity = 1.0 - smoothstep(0.0, 0.5, d);
  
  gl_FragColor = vec4(color, vAlpha * intensity * 0.35);
}
`

// Separate shader for Inner Dense Disk (WHITE - no internal gradient)
const innerDiskFragmentShader = `
varying float vAlpha;
varying float vDistance;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  
  // Pure white particles - NO smoothstep gradient inside particle
  vec3 color = vec3(1.0, 1.0, 1.0);
  
  // Reduced brightness (was 0.35, now 0.25)
  gl_FragColor = vec4(color, vAlpha * 0.25);
}
`

// Shader for spiral-falling particles (approaching event horizon)
const spiralVertexShader = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
attribute float aStartRadius;
attribute float aSpiralSpeed;
attribute float aInclination;
varying float vAlpha;

void main() {
  vec3 pos = position;
  
  // Life cycle (particles gradually fall inward)
  float life = mod(uTime * aSpiralSpeed + aRandom * 10.0, 1.0);
  
  // Spiral inward
  float currentRadius = aStartRadius * (1.0 - life * 0.7); // Fall to 30% of start radius
  float angle = life * 6.28 * 3.0; // Multiple rotations as falling
  
  pos.x = currentRadius * cos(angle);
  pos.y = currentRadius * sin(angle);
  
  // Apply inclination
  float inclinedZ = pos.y * sin(aInclination);
  pos.y = pos.y * cos(aInclination);
  pos.z = inclinedZ;
  
  // Fade in/out (disappear near event horizon)
  float fadeIn = smoothstep(0.0, 0.1, life);
  float fadeOut = smoothstep(1.0, 0.85, life); // Fade out as approaching horizon
  vAlpha = fadeIn * fadeOut;
  
  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = aSize * (23.0 / -viewPosition.z);
}
`

const spiralFragmentShader = `
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  
  // Pure white particles
  vec3 color = vec3(1.0, 1.0, 1.0);
  
  float intensity = 1.0 - smoothstep(0.0, 0.5, d);
  
  gl_FragColor = vec4(color, vAlpha * intensity * 0.4);
}
`

// Shader for scattered ambient particles
const ambientVertexShader = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
attribute vec3 aVelocity;
attribute float aWanderSpeed;
varying float vAlpha;

void main() {
  vec3 pos = position;
  
  // Slow random wandering motion
  float t = uTime * aWanderSpeed + aRandom * 100.0;
  
  // Add wandering motion
  pos += aVelocity * sin(t) * 0.5;
  pos.x += cos(t * 0.7) * 0.3;
  pos.y += sin(t * 0.5) * 0.3;
  pos.z += cos(t * 0.3) * 0.2;
  
  // Distance from center
  float r = length(pos);
  
  // Very subtle fade
  vAlpha = smoothstep(15.0, 5.0, r) * 0.4;
  
  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = aSize * (28.0 / -viewPosition.z);
}
`

const ambientFragmentShader = `
varying float vAlpha;

void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  
  // Pure white particles
  vec3 color = vec3(1.0, 1.0, 1.0);
  
  float intensity = 1.0 - smoothstep(0.0, 0.5, d);
  
  gl_FragColor = vec4(color, vAlpha * intensity * 0.3);
}
`

export default function BlackHoleParticles({ isMobile = false }) {
    const innerDiskRef = useRef()
    const orbitalRef = useRef()
    const orbitalGroupRef = useRef() // Group for camera-facing orbital "wings"
    const spiralRef = useRef()
    const ambientRef = useRef()

    const config = isMobile ? PERFORMANCE_CONFIG.mobile : PERFORMANCE_CONFIG.desktop

    // 0. INNER DENSE DISK - Very close to event horizon (OPTIMIZED)
    const innerDiskCount = config.innerDiskCount
    const innerDiskData = useMemo(() => {
        const positions = new Float32Array(innerDiskCount * 3)
        const randoms = new Float32Array(innerDiskCount)
        const sizes = new Float32Array(innerDiskCount)
        const orbitRadii = new Float32Array(innerDiskCount)
        const orbitSpeeds = new Float32Array(innerDiskCount)
        const inclinations = new Float32Array(innerDiskCount)
        const phaseOffsets = new Float32Array(innerDiskCount)

        for (let i = 0; i < innerDiskCount; i++) {
            // HIGHLY concentrated near event horizon (0.88 to 2.0)
            const r = 0.88 + Math.pow(Math.random(), 5) * 1.12

            positions[i * 3] = r
            positions[i * 3 + 1] = 0
            positions[i * 3 + 2] = 0

            randoms[i] = Math.random()
            sizes[i] = Math.random() * 1.6 + 0.9 // Compensate size
            orbitRadii[i] = r

            // Very fast orbits close to horizon
            orbitSpeeds[i] = 1.2 / Math.sqrt(r)

            // Mostly flat (small inclination for dense disk look)
            inclinations[i] = (Math.random() - 0.5) * Math.PI * 0.2

            phaseOffsets[i] = Math.random() * Math.PI * 2
        }

        return { positions, randoms, sizes, orbitRadii, orbitSpeeds, inclinations, phaseOffsets }
    }, [innerDiskCount])

    // 1. Orbital particles (stable orbits at different radii and inclinations) (OPTIMIZED)
    const orbitalCount = config.orbitalCount
    const orbitalData = useMemo(() => {
        const positions = new Float32Array(orbitalCount * 3)
        const randoms = new Float32Array(orbitalCount)
        const sizes = new Float32Array(orbitalCount)
        const orbitRadii = new Float32Array(orbitalCount)
        const orbitSpeeds = new Float32Array(orbitalCount)
        const inclinations = new Float32Array(orbitalCount)
        const phaseOffsets = new Float32Array(orbitalCount)

        for (let i = 0; i < orbitalCount; i++) {
            // Heavy concentration near black hole (exponential falloff)
            const r = 1.5 + Math.pow(Math.random(), 5) * 5.0

            positions[i * 3] = r
            positions[i * 3 + 1] = 0
            positions[i * 3 + 2] = 0

            randoms[i] = Math.random()
            sizes[i] = Math.random() * 0.55 + 0.35 // Compensate size
            orbitRadii[i] = r

            // Orbital speed decreases with distance (Kepler's law approximation)
            orbitSpeeds[i] = 0.8 / Math.sqrt(r)

            // Random inclination (some orbits tilted)
            inclinations[i] = (Math.random() - 0.5) * Math.PI * 0.6

            // Random starting phase
            phaseOffsets[i] = Math.random() * Math.PI * 2
        }

        return { positions, randoms, sizes, orbitRadii, orbitSpeeds, inclinations, phaseOffsets }
    }, [orbitalCount])

    // 2. Spiral-falling particles (gradually approaching event horizon) (OPTIMIZED)
    const spiralCount = config.spiralCount
    const spiralData = useMemo(() => {
        const positions = new Float32Array(spiralCount * 3)
        const randoms = new Float32Array(spiralCount)
        const sizes = new Float32Array(spiralCount)
        const startRadii = new Float32Array(spiralCount)
        const spiralSpeeds = new Float32Array(spiralCount)
        const inclinations = new Float32Array(spiralCount)

        for (let i = 0; i < spiralCount; i++) {
            // Exponential distribution (most particles near center)
            const r = 1.2 + Math.pow(Math.random(), 4) * 4.0

            positions[i * 3] = r
            positions[i * 3 + 1] = 0
            positions[i * 3 + 2] = 0

            randoms[i] = Math.random()
            sizes[i] = Math.random() * 0.45 + 0.25 // Compensate size
            startRadii[i] = r
            spiralSpeeds[i] = 0.1 + Math.random() * 0.2
            inclinations[i] = (Math.random() - 0.5) * Math.PI * 0.4
        }

        return { positions, randoms, sizes, startRadii, spiralSpeeds, inclinations }
    }, [spiralCount])

    // 3. Ambient scattered particles (far from black hole, slow motion) (OPTIMIZED)
    const ambientCount = config.ambientCount
    const ambientData = useMemo(() => {
        const positions = new Float32Array(ambientCount * 3)
        const randoms = new Float32Array(ambientCount)
        const sizes = new Float32Array(ambientCount)
        const velocities = new Float32Array(ambientCount * 3)
        const wanderSpeeds = new Float32Array(ambientCount)

        for (let i = 0; i < ambientCount; i++) {
            // Exponential distribution for ambient particles (fewer far away)
            const baseR = 6.0 + Math.pow(Math.random(), 3) * 8.0
            const theta = Math.random() * Math.PI * 2
            const phi = Math.acos(2 * Math.random() - 1)

            positions[i * 3] = baseR * Math.sin(phi) * Math.cos(theta)
            positions[i * 3 + 1] = baseR * Math.sin(phi) * Math.sin(theta)
            positions[i * 3 + 2] = baseR * Math.cos(phi) * 0.5 // Flatten a bit

            randoms[i] = Math.random()
            sizes[i] = Math.random() * 0.4 + 0.2

            // Random slow drift velocity
            velocities[i * 3] = (Math.random() - 0.5) * 0.1
            velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.1
            velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05

            wanderSpeeds[i] = 0.05 + Math.random() * 0.1
        }

        return { positions, randoms, sizes, velocities, wanderSpeeds }
    }, [ambientCount])

    const innerDiskUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
    const orbitalUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
    const spiralUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
    const ambientUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

    // Cache THREE objects to avoid garbage collection
    const cachedQuaternion = useMemo(() => new THREE.Quaternion(), [])
    const cachedGroupWorldPos = useMemo(() => new THREE.Vector3(), [])
    const cachedDirToCamera = useMemo(() => new THREE.Vector3(), [])
    const cachedLocalDir = useMemo(() => new THREE.Vector3(), [])

    useFrame((state) => {
        if (innerDiskRef.current) {
            innerDiskRef.current.material.uniforms.uTime.value = state.clock.elapsedTime
        }
        if (orbitalRef.current) {
            orbitalRef.current.material.uniforms.uTime.value = state.clock.elapsedTime
        }
        if (spiralRef.current) {
            spiralRef.current.material.uniforms.uTime.value = state.clock.elapsedTime
        }
        if (ambientRef.current) {
            ambientRef.current.material.uniforms.uTime.value = state.clock.elapsedTime
        }

        // Make orbital wings face camera accounting for parent rotation
        if (orbitalGroupRef.current && orbitalGroupRef.current.parent) {
            // Get parent's world quaternion (reuse cached object)
            orbitalGroupRef.current.parent.getWorldQuaternion(cachedQuaternion)

            // Get direction to camera in world space (reuse cached objects)
            orbitalGroupRef.current.getWorldPosition(cachedGroupWorldPos)
            cachedDirToCamera.subVectors(state.camera.position, cachedGroupWorldPos).normalize()

            // Transform to parent's local space (reuse cached object)
            cachedLocalDir.copy(cachedDirToCamera).applyQuaternion(cachedQuaternion.clone().invert())

            // Calculate angle in local XY plane (INVERTED)
            const angle = Math.atan2(cachedLocalDir.x, cachedLocalDir.y)
            orbitalGroupRef.current.rotation.z = -angle  // NEGATIVE to reverse direction
        }
    })

    return (
        <group>
            {/* 0. Inner Dense Disk (5k particles very close to horizon) */}
            <points ref={innerDiskRef}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={innerDiskCount} array={innerDiskData.positions} itemSize={3} />
                    <bufferAttribute attach="attributes-aRandom" count={innerDiskCount} array={innerDiskData.randoms} itemSize={1} />
                    <bufferAttribute attach="attributes-aSize" count={innerDiskCount} array={innerDiskData.sizes} itemSize={1} />
                    <bufferAttribute attach="attributes-aOrbitRadius" count={innerDiskCount} array={innerDiskData.orbitRadii} itemSize={1} />
                    <bufferAttribute attach="attributes-aOrbitSpeed" count={innerDiskCount} array={innerDiskData.orbitSpeeds} itemSize={1} />
                    <bufferAttribute attach="attributes-aInclination" count={innerDiskCount} array={innerDiskData.inclinations} itemSize={1} />
                    <bufferAttribute attach="attributes-aPhaseOffset" count={innerDiskCount} array={innerDiskData.phaseOffsets} itemSize={1} />
                </bufferGeometry>
                <shaderMaterial
                    vertexShader={innerDiskVertexShader}
                    fragmentShader={innerDiskFragmentShader}
                    uniforms={innerDiskUniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            {/* 1. Orbital Particles (stable orbits) - Camera-facing Wings */}
            <group ref={orbitalGroupRef}>

                <points ref={orbitalRef}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" count={orbitalCount} array={orbitalData.positions} itemSize={3} />
                        <bufferAttribute attach="attributes-aRandom" count={orbitalCount} array={orbitalData.randoms} itemSize={1} />
                        <bufferAttribute attach="attributes-aSize" count={orbitalCount} array={orbitalData.sizes} itemSize={1} />
                        <bufferAttribute attach="attributes-aOrbitRadius" count={orbitalCount} array={orbitalData.orbitRadii} itemSize={1} />
                        <bufferAttribute attach="attributes-aOrbitSpeed" count={orbitalCount} array={orbitalData.orbitSpeeds} itemSize={1} />
                        <bufferAttribute attach="attributes-aInclination" count={orbitalCount} array={orbitalData.inclinations} itemSize={1} />
                        <bufferAttribute attach="attributes-aPhaseOffset" count={orbitalCount} array={orbitalData.phaseOffsets} itemSize={1} />
                    </bufferGeometry>
                    <shaderMaterial
                        vertexShader={orbitalVertexShader}
                        fragmentShader={orbitalFragmentShader}
                        uniforms={orbitalUniforms}
                        transparent
                        depthWrite={false}
                        blending={THREE.AdditiveBlending}
                    />
                </points>
            </group>

            {/* 2. Spiral-Falling Particles */}
            <points ref={spiralRef}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={spiralCount} array={spiralData.positions} itemSize={3} />
                    <bufferAttribute attach="attributes-aRandom" count={spiralCount} array={spiralData.randoms} itemSize={1} />
                    <bufferAttribute attach="attributes-aSize" count={spiralCount} array={spiralData.sizes} itemSize={1} />
                    <bufferAttribute attach="attributes-aStartRadius" count={spiralCount} array={spiralData.startRadii} itemSize={1} />
                    <bufferAttribute attach="attributes-aSpiralSpeed" count={spiralCount} array={spiralData.spiralSpeeds} itemSize={1} />
                    <bufferAttribute attach="attributes-aInclination" count={spiralCount} array={spiralData.inclinations} itemSize={1} />
                </bufferGeometry>
                <shaderMaterial
                    vertexShader={spiralVertexShader}
                    fragmentShader={spiralFragmentShader}
                    uniforms={spiralUniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            {/* 3. Ambient Scattered Particles */}
            <points ref={ambientRef}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={ambientCount} array={ambientData.positions} itemSize={3} />
                    <bufferAttribute attach="attributes-aRandom" count={ambientCount} array={ambientData.randoms} itemSize={1} />
                    <bufferAttribute attach="attributes-aSize" count={ambientCount} array={ambientData.sizes} itemSize={1} />
                    <bufferAttribute attach="attributes-aVelocity" count={ambientCount} array={ambientData.velocities} itemSize={3} />
                    <bufferAttribute attach="attributes-aWanderSpeed" count={ambientCount} array={ambientData.wanderSpeeds} itemSize={1} />
                </bufferGeometry>
                <shaderMaterial
                    vertexShader={ambientVertexShader}
                    fragmentShader={ambientFragmentShader}
                    uniforms={ambientUniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>
        </group>
    )
}
