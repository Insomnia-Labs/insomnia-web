import React, { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Billboard } from '@react-three/drei'
import BlackHoleParticles from './BlackHoleParticles'
import { useStore } from '../../store/useStore'

// --- SHADERS ---
const particleVertexShader = `
uniform float uTime;
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
  
  pos = vec3(
    pos.x * c - pos.y * s,
    pos.x * s + pos.y * c,
    pos.z
  );

  vec4 viewPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * viewPosition;

  // Base size calculation
  float finalSize = aSize;

  gl_PointSize = finalSize * (28.0 / -viewPosition.z);

  
  float brightness = 0.7; 
  float normDist = 1.0 - smoothstep(2.0, 8.0, length(position.xy));
  float innerFade = smoothstep(1.0, 1.8, length(position.xy));
  
  vAlpha = brightness * normDist * innerFade;

  vDistance = length(position.xy);
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


    const count = 120000

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
            sizes[i] = Math.random() * 0.4 + 0.1
        }
        return { positions, randoms, sizes }
    }, [])

    const uniforms = useMemo(() => ({
        uTime: { value: 0 }
    }), [])

    // ANIMATION LOOP
    useFrame((state) => {
        if (!pointsRef.current) return

        pointsRef.current.material.uniforms.uTime.value = state.clock.elapsedTime
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

            <BlackHoleParticles />
        </group>
    )
}
