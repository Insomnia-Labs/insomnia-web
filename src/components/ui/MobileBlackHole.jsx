import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'

// ── Vertex shader: accretion disk particles ──────────────────────
const diskVert = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
varying float vAlpha;

void main() {
  vec3 pos = position;
  float r = length(pos.xy);
  float speed = 2.5 / (r * r * r + 0.08);
  float angle = uTime * speed * 0.7 + aRandom * 6.2832;
  float c = cos(angle); float s = sin(angle);
  vec3 cur = vec3(pos.x*c - pos.y*s, pos.x*s + pos.y*c, pos.z);
  pos = cur;
  vec4 vp = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * vp;
  gl_PointSize = aSize * (28.0 / -vp.z);
  float normD = 1.0 - smoothstep(2.0, 8.0, r);
  float inner = smoothstep(1.0, 1.8, r);
  vAlpha = 0.7 * normD * inner;
}
`
const diskFrag = `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  if (length(uv) > 0.5) discard;
  gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * 0.6);
}
`

// ── Vertex shader: orbital ring particles ────────────────────────
const orbVert = `
uniform float uTime;
attribute float aRandom;
attribute float aSize;
attribute float aRadius;
attribute float aSpeed;
attribute float aInc;
attribute float aPhase;
varying float vAlpha;

void main() {
  float angle = uTime * aSpeed + aPhase;
  float r = aRadius;
  vec3 pos;
  pos.x = r * cos(angle);
  pos.y = r * sin(angle);
  float z = pos.y * sin(aInc);
  pos.y = pos.y * cos(aInc);
  pos.z = z;
  vAlpha = smoothstep(10.0, 2.0, r) * 0.7;
  vec4 vp = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * vp;
  gl_PointSize = aSize * (25.0 / -vp.z);
}
`
const orbFrag = `
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float i = 1.0 - smoothstep(0.0, 0.5, d);
  gl_FragColor = vec4(1.0, 1.0, 1.0, vAlpha * i * 0.35);
}
`

// ── Photo-ring shader ────────────────────────────────────────────
const ringVert = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const ringFrag = `
varying vec2 vUv;
void main(){
  vec2 c = vUv - 0.5;
  float dist = length(c) * 2.0;
  if(dist < 0.735) discard;
  float d = abs(dist - 0.74);
  float ring = smoothstep(0.005, 0.0, d);
  gl_FragColor = vec4(1.0,1.0,1.0, ring * 0.3);
}
`

// Desktop home camera: position(7, 5, 3), lookAt(0, -0.6, 0)
// We replicate that exact angle and orbit around Y-axis on scroll.
const BASE_CAM = new THREE.Vector3(7, 5, 3)
const LOOK_AT = new THREE.Vector3(0, -0.6, 0)

function BlackHoleScene({ scrollProgress }) {
    const diskRef = useRef()
    const orbRef = useRef()
    const camRef = useRef()

    // Accretion disk — 4000 particles (matching mobile PERFORMANCE_CONFIG)
    const diskData = useMemo(() => {
        const n = 4000
        const pos = new Float32Array(n * 3)
        const rnd = new Float32Array(n)
        const sz = new Float32Array(n)
        for (let i = 0; i < n; i++) {
            const r = 0.76 + Math.pow(Math.random(), 3.5) * 6.0
            const t = Math.random() * Math.PI * 2
            pos[i * 3] = r * Math.cos(t)
            pos[i * 3 + 1] = r * Math.sin(t)
            pos[i * 3 + 2] = (Math.random() - 0.5) * 0.15
            rnd[i] = Math.random()
            sz[i] = Math.random() * 0.5 + 0.15
        }
        return { pos, rnd, sz, n }
    }, [])

    // Orbital particles — 1200
    const orbData = useMemo(() => {
        const n = 1200
        const pos = new Float32Array(n * 3)
        const rnd = new Float32Array(n)
        const sz = new Float32Array(n)
        const radii = new Float32Array(n)
        const spds = new Float32Array(n)
        const incs = new Float32Array(n)
        const phs = new Float32Array(n)
        for (let i = 0; i < n; i++) {
            const r = 1.5 + Math.pow(Math.random(), 5) * 5.0
            pos[i * 3] = r; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = 0
            rnd[i] = Math.random()
            sz[i] = Math.random() * 0.55 + 0.35
            radii[i] = r
            spds[i] = 0.8 / Math.sqrt(r)
            incs[i] = (Math.random() - 0.5) * Math.PI * 0.6
            phs[i] = Math.random() * Math.PI * 2
        }
        return { pos, rnd, sz, radii, spds, incs, phs, n }
    }, [])

    const diskUni = useMemo(() => ({ uTime: { value: 0 } }), [])
    const orbUni = useMemo(() => ({ uTime: { value: 0 } }), [])

    // Pre-compute base camera spherical coords for orbit
    const baseRadius = BASE_CAM.length()
    const baseTheta = Math.atan2(BASE_CAM.z, BASE_CAM.x)   // horizontal angle
    const basePhi = Math.asin(BASE_CAM.y / baseRadius)    // vertical angle (elevation)

    useFrame((state) => {
        const t = state.clock.elapsedTime
        if (diskRef.current) diskRef.current.material.uniforms.uTime.value = t
        if (orbRef.current) orbRef.current.material.uniforms.uTime.value = t

        // Camera orbits horizontally around the black hole on scroll.
        // Base position matches desktop: (7,5,3) → same elevation, just rotates azimuth.
        const p = scrollProgress.current          // 0..1
        const azimuth = baseTheta + p * Math.PI * 2  // full 360° rotation on full scroll

        state.camera.position.set(
            baseRadius * Math.cos(basePhi) * Math.cos(azimuth),
            baseRadius * Math.sin(basePhi),
            baseRadius * Math.cos(basePhi) * Math.sin(azimuth),
        )
        state.camera.lookAt(LOOK_AT)
    })

    return (
        <>
            {/* Event horizon */}
            <Billboard>
                <mesh renderOrder={100}>
                    <circleGeometry args={[0.82, 64]} />
                    <meshBasicMaterial color="black" />
                </mesh>
            </Billboard>

            {/* Photo ring */}
            <Billboard>
                <mesh renderOrder={50}>
                    <planeGeometry args={[1.9, 1.9]} />
                    <shaderMaterial
                        vertexShader={ringVert}
                        fragmentShader={ringFrag}
                        transparent depthTest={true}
                        blending={THREE.AdditiveBlending}
                    />
                </mesh>
            </Billboard>

            {/* Accretion disk — tilted like the desktop */}
            <group rotation={[-Math.PI / 2 + 0.2, 0, 0]}>
                <points ref={diskRef} frustumCulled={false}>
                    <bufferGeometry>
                        <bufferAttribute attach="attributes-position" count={diskData.n} array={diskData.pos} itemSize={3} />
                        <bufferAttribute attach="attributes-aRandom" count={diskData.n} array={diskData.rnd} itemSize={1} />
                        <bufferAttribute attach="attributes-aSize" count={diskData.n} array={diskData.sz} itemSize={1} />
                    </bufferGeometry>
                    <shaderMaterial
                        vertexShader={diskVert} fragmentShader={diskFrag}
                        uniforms={diskUni} transparent depthWrite={false}
                        blending={THREE.AdditiveBlending}
                    />
                </points>
            </group>

            {/* Orbital halo */}
            <points ref={orbRef} frustumCulled={false}>
                <bufferGeometry>
                    <bufferAttribute attach="attributes-position" count={orbData.n} array={orbData.pos} itemSize={3} />
                    <bufferAttribute attach="attributes-aRandom" count={orbData.n} array={orbData.rnd} itemSize={1} />
                    <bufferAttribute attach="attributes-aSize" count={orbData.n} array={orbData.sz} itemSize={1} />
                    <bufferAttribute attach="attributes-aRadius" count={orbData.n} array={orbData.radii} itemSize={1} />
                    <bufferAttribute attach="attributes-aSpeed" count={orbData.n} array={orbData.spds} itemSize={1} />
                    <bufferAttribute attach="attributes-aInc" count={orbData.n} array={orbData.incs} itemSize={1} />
                    <bufferAttribute attach="attributes-aPhase" count={orbData.n} array={orbData.phs} itemSize={1} />
                </bufferGeometry>
                <shaderMaterial
                    vertexShader={orbVert} fragmentShader={orbFrag}
                    uniforms={orbUni} transparent depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>
        </>
    )
}

export default function MobileBlackHole({ scrollProgress }) {
    return (
        <Canvas
            camera={{
                fov: 52,
                near: 0.1,
                far: 100,
                position: [BASE_CAM.x, BASE_CAM.y, BASE_CAM.z],
            }}
            dpr={[1, 1]}
            frameloop="always"
            gl={{
                antialias: false,
                powerPreference: 'high-performance',
                alpha: true,
            }}
            style={{ width: '100%', height: '100%', background: 'transparent' }}
        >
            <BlackHoleScene scrollProgress={scrollProgress} />
        </Canvas>
    )
}
