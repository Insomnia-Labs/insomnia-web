import React, { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Billboard } from '@react-three/drei'
import BlackHoleParticles from './BlackHoleParticles'
import { useStore } from '../../store/useStore'

// --- SHADERS ---
const particleVertexShader = `
uniform float uTime;
uniform vec3 uMouse; // Mouse in LOCAL (disk) space
attribute float aRandom;
attribute float aSize;
varying float vAlpha;
varying float vDistance;

void main() {
  vec3 pos = position;

  // Orbit Animation
  float r = length(pos.xy);
  float speed = 2.5 / (r * r * r + 0.08); 
  float angle = uTime * speed * 0.7 + aRandom * 6.28; 

  float c = cos(angle);
  float s = sin(angle);
  
  // Calculate rotated position (current orbital pos)
  vec3 currentPos = vec3(
    pos.x * c - pos.y * s,
    pos.x * s + pos.y * c,
    pos.z
  );

  // --- MOUSE REPULSION ---
  // Distance to mouse in local space
  float dist = distance(currentPos, uMouse);
  
  // Add randomness to radius for organic, non-circular shape
  // Varies between 0.4 and 0.7 based on particle's random seed
  float repulsionRadius = 0.4 + aRandom * 0.3; 

  if (dist < repulsionRadius) {
      vec3 repulseDir = normalize(currentPos - uMouse);
      
      // Add slight noise to direction for more scatter
      repulseDir.x += (aRandom - 0.5) * 0.2;
      repulseDir.y += (aRandom - 0.5) * 0.2;
      
      float force = (1.0 - dist / repulsionRadius);
      force = force * force; // Smooth falloff
      
      // Variable strength
      float strength = 0.8 + aRandom * 0.4;
      
      currentPos += repulseDir * force * strength; 
  }
  // -----------------------

  pos = currentPos;

  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  // Base size calculation
  float finalSize = aSize;

  gl_PointSize = finalSize * (28.0 / -viewPosition.z);

  
  float brightness = 0.7; 
  float normDist = 1.0 - smoothstep(2.0, 8.0, length(pos.xy)); // Use displaced pos or original? Displaced looks cool
  float innerFade = smoothstep(1.0, 1.8, length(pos.xy));
  
  vAlpha = brightness * normDist * innerFade;

  vDistance = length(pos.xy);
}
`

const particleFragmentShader = `
varying float vAlpha;
varying float vDistance;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;

  gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * 0.6); 
}
`

// --- RING SHADERS ---
const ringVertNew = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const ringFragNew = `
varying vec2 vUv;
void main() {
  vec2 center = vUv - 0.5;
  float dist = length(center) * 2.0;
  float radius = 0.74; 
  float width = 0.005; 
  
  if (dist < 0.735) discard;
  
  float d = abs(dist - radius);
  float ring = smoothstep(width, 0.0, d); 
  
  vec3 col = vec3(1.0, 1.0, 1.0);
  vec3 emission = col * ring * 0.5; 
  gl_FragColor = vec4(emission, ring * 0.3);
}
`



export default function BlackHole() {
    const groupRef = useRef()
    const pointsRef = useRef()
    const section = useStore((state) => state.section)

    // INITIALIZE VISUAL SETTINGS (Mobile check first)
    const [isMobile, setIsMobile] = React.useState(() =>
        typeof window !== 'undefined' ? window.innerWidth < 768 : false
    )

    React.useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener('resize', checkMobile)
        return () => window.removeEventListener('resize', checkMobile)
    }, [])


    const count = isMobile ? 12000 : 65000 // Optimized count (Moved definition below isMobile check)

    // 1. Primary Accretion Disk Data
    const { positions, randoms, sizes } = useMemo(() => {
        const positions = new Float32Array(count * 3)
        const randoms = new Float32Array(count)
        const sizes = new Float32Array(count)

        for (let i = 0; i < count; i++) {
            const randomR = Math.pow(Math.random(), 3.5);
            const r = 0.76 + randomR * 6.0;
            const theta = Math.random() * Math.PI * 2;

            const x = r * Math.cos(theta)
            const y = r * Math.sin(theta)
            const z = (Math.random() - 0.5) * 0.15

            positions[i * 3] = x
            positions[i * 3 + 1] = y
            positions[i * 3 + 2] = z

            randoms[i] = Math.random()
            sizes[i] = Math.random() * 0.5 + 0.15 // Slightly larger to compensate for lower count
        }
        return { positions, randoms, sizes }
    }, [count])

    const uniforms = useMemo(() => ({
        uTime: { value: 0 },
        uMouse: { value: new THREE.Vector3(9999, 9999, 9999) }
    }), [])

    // Raycast Math Objects
    const _inverseMatrix = useMemo(() => new THREE.Matrix4(), [])
    const _rayOrigin = useMemo(() => new THREE.Vector3(), [])
    const _rayDir = useMemo(() => new THREE.Vector3(), [])
    const _planeNormal = useMemo(() => new THREE.Vector3(0, 0, 1), []) // Disk is on XY plane (local)
    const _planePoint = useMemo(() => new THREE.Vector3(0, 0, 0), [])
    const _intersectPoint = useMemo(() => new THREE.Vector3(), [])

    // ANIMATION LOOP



    useFrame((state) => {
        if (!pointsRef.current) return

        pointsRef.current.material.uniforms.uTime.value = state.clock.elapsedTime

        // --- MOUSE INTERACTION ---

        // Skip on Mobile to prevent "scared" particles (Performance & UX)
        if (isMobile) {
            uniforms.uMouse.value.set(9999, 9999, 9999)
            return
        }

        // Project mouse ray onto the disk's local XY plane
        if (groupRef.current) {
            // 1. Convert Ray to Local Space of the Group (which is rotated)
            _inverseMatrix.copy(groupRef.current.matrixWorld).invert()

            state.raycaster.setFromCamera(state.pointer, state.camera)

            _rayOrigin.copy(state.raycaster.ray.origin).applyMatrix4(_inverseMatrix)
            _rayDir.copy(state.raycaster.ray.direction).transformDirection(_inverseMatrix).normalize()

            // 2. Intersect with Plane Z=0 (since particles are naturally on XY plane)
            const denom = _rayDir.dot(_planeNormal)

            if (Math.abs(denom) > 0.0001) {
                const t = _planePoint.clone().sub(_rayOrigin).dot(_planeNormal) / denom

                if (t >= 0) {
                    _intersectPoint.copy(_rayDir).multiplyScalar(t).add(_rayOrigin)
                    uniforms.uMouse.value.copy(_intersectPoint)
                } else {
                    uniforms.uMouse.value.set(9999, 9999, 9999)
                }
            } else {
                uniforms.uMouse.value.set(9999, 9999, 9999)
            }
        }
    })

    return (
        <group ref={groupRef} rotation={[-Math.PI / 2 + 0.2, 0, 0]}>
            <Billboard>
                <mesh renderOrder={100}>
                    <circleGeometry args={[0.84, 64]} />
                    <meshBasicMaterial color="black" />
                </mesh>
            </Billboard>

            <Billboard>
                <mesh renderOrder={50}>
                    <planeGeometry args={[2.0, 2.0]} />
                    <shaderMaterial
                        vertexShader={ringVertNew}
                        fragmentShader={ringFragNew}
                        transparent
                        depthTest={true}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            </Billboard>

            <points ref={pointsRef} frustumCulled={false}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
                    <bufferAttribute attach="attributes-aRandom" count={count} array={randoms} itemSize={1} />
                    <bufferAttribute attach="attributes-aSize" count={count} array={sizes} itemSize={1} />
                </bufferGeometry>
                <shaderMaterial
                    vertexShader={particleVertexShader}
                    fragmentShader={particleFragmentShader}
                    uniforms={uniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            <BlackHoleParticles isMobile={isMobile} />
        </group>
    )
}
