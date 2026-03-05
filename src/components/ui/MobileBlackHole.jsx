import { useRef, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

/* ── Counts ────────────────────────────────────────────────── */
const DISK_COUNT = 4000
const ORB_COUNT = 1200

/* ── Desktop camera position (matches CameraController home) ── */
const BASE_CAM = new THREE.Vector3(7, 5, 3)
const LOOK_AT = new THREE.Vector3(0, -0.6, 0)

/* ═══════════════════════════════════════════════════════════════
   Accretion Disk shader
═══════════════════════════════════════════════════════════════ */
const diskVert = /* glsl */`
    attribute float aAngle;
    attribute float aRadius;
    attribute float aSpeed;
    attribute float aSize;
    attribute vec3  aColor;
    uniform   float uTime;
    varying   vec3  vColor;
    varying   float vAlpha;

    void main() {
        float angle = aAngle + uTime * aSpeed;
        float x = cos(angle) * aRadius;
        float z = sin(angle) * aRadius * 0.28;
        float y = sin(angle * 3.0) * 0.04 * aRadius;
        vColor = aColor;
        float dist = aRadius;
        vAlpha = smoothstep(3.8, 0.4, dist) * 0.85;
        vec4 mv = modelViewMatrix * vec4(x, y, z, 1.0);
        gl_PointSize = aSize * (280.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
    }
`
const diskFrag = /* glsl */`
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
        vec2  uv   = gl_PointCoord - 0.5;
        float d    = length(uv);
        float fade = 1.0 - smoothstep(0.3, 0.5, d);
        if (fade < 0.01) discard;
        gl_FragColor = vec4(vColor, vAlpha * fade);
    }
`

/* ═══════════════════════════════════════════════════════════════
   Orbital ring shader
═══════════════════════════════════════════════════════════════ */
const orbVert = /* glsl */`
    attribute float aAngle;
    attribute float aRadius;
    attribute float aSpeed;
    attribute float aSize;
    attribute float aTilt;
    attribute vec3  aColor;
    uniform   float uTime;
    varying   vec3  vColor;
    varying   float vAlpha;

    void main() {
        float angle = aAngle + uTime * aSpeed;
        float cx = cos(angle) * aRadius;
        float cz = sin(angle) * aRadius;
        float tx = cx;
        float ty = cz * sin(aTilt);
        float tz = cz * cos(aTilt);
        vColor = aColor;
        vAlpha = 0.55;
        vec4 mv = modelViewMatrix * vec4(tx, ty, tz, 1.0);
        gl_PointSize = aSize * (220.0 / -mv.z);
        gl_Position  = projectionMatrix * mv;
    }
`
const orbFrag = /* glsl */`
    varying vec3  vColor;
    varying float vAlpha;
    void main() {
        vec2  uv   = gl_PointCoord - 0.5;
        float d    = length(uv);
        float fade = 1.0 - smoothstep(0.25, 0.5, d);
        if (fade < 0.01) discard;
        gl_FragColor = vec4(vColor, vAlpha * fade);
    }
`

/* ═══════════════════════════════════════════════════════════════
   Helpers
═══════════════════════════════════════════════════════════════ */
function makeDiskGeometry() {
    const pos = new Float32Array(DISK_COUNT * 3)
    const angles = new Float32Array(DISK_COUNT)
    const radii = new Float32Array(DISK_COUNT)
    const speeds = new Float32Array(DISK_COUNT)
    const sizes = new Float32Array(DISK_COUNT)
    const colors = new Float32Array(DISK_COUNT * 3)

    const palette = [
        new THREE.Color('#ff6a00'),
        new THREE.Color('#ff9d00'),
        new THREE.Color('#ffcc44'),
        new THREE.Color('#fff0b0'),
        new THREE.Color('#ff4400'),
    ]

    for (let i = 0; i < DISK_COUNT; i++) {
        const r = 0.35 + Math.pow(Math.random(), 0.6) * 3.4
        angles[i] = Math.random() * Math.PI * 2
        radii[i] = r
        speeds[i] = (0.08 + Math.random() * 0.18) * (Math.random() < 0.5 ? 1 : -1) / r
        sizes[i] = 1.5 + Math.random() * 2.5
        const c = palette[Math.floor(Math.random() * palette.length)]
        const t = Math.random()
        colors[i * 3] = c.r * (0.7 + t * 0.3)
        colors[i * 3 + 1] = c.g * (0.5 + t * 0.5)
        colors[i * 3 + 2] = c.b * (0.3 + t * 0.7)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1))
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1))
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    return geo
}

function makeOrbGeometry() {
    const pos = new Float32Array(ORB_COUNT * 3)
    const angles = new Float32Array(ORB_COUNT)
    const radii = new Float32Array(ORB_COUNT)
    const speeds = new Float32Array(ORB_COUNT)
    const sizes = new Float32Array(ORB_COUNT)
    const tilts = new Float32Array(ORB_COUNT)
    const colors = new Float32Array(ORB_COUNT * 3)

    const palette = [
        new THREE.Color('#7040ff'),
        new THREE.Color('#4488ff'),
        new THREE.Color('#a0c8ff'),
        new THREE.Color('#ffffff'),
    ]

    for (let i = 0; i < ORB_COUNT; i++) {
        const r = 1.2 + Math.random() * 2.2
        angles[i] = Math.random() * Math.PI * 2
        radii[i] = r
        speeds[i] = (0.04 + Math.random() * 0.1) * (Math.random() < 0.5 ? 1 : -1)
        sizes[i] = 1.0 + Math.random() * 1.8
        tilts[i] = (Math.random() - 0.5) * Math.PI * 0.6
        const c = palette[Math.floor(Math.random() * palette.length)]
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aAngle', new THREE.BufferAttribute(angles, 1))
    geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1))
    geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
    geo.setAttribute('aTilt', new THREE.BufferAttribute(tilts, 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3))
    return geo
}

/* ═══════════════════════════════════════════════════════════════
   Scene
═══════════════════════════════════════════════════════════════ */
function BlackHoleScene({ scrollProgress, isMenuOpen }) {
    const diskRef = useRef()
    const orbRef = useRef()
    const camRef = useRef()

    const diskGeo = useMemo(() => makeDiskGeometry(), [])
    const orbGeo = useMemo(() => makeOrbGeometry(), [])

    const diskUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])
    const orbUniforms = useMemo(() => ({ uTime: { value: 0 } }), [])

    /* Camera azimuth orbit based on scroll ─────────────────── */
    const baseRadius = BASE_CAM.length()
    const basePhi = Math.asin(BASE_CAM.y / baseRadius)   // elevation angle

    useFrame((state) => {
        // Pause all GPU work while menu is animating — frees mobile GPU for GSAP
        if (isMenuOpen) return

        const t = state.clock.elapsedTime
        if (diskRef.current) diskRef.current.material.uniforms.uTime.value = t
        if (orbRef.current) orbRef.current.material.uniforms.uTime.value = t

        // Scroll-based full 360° camera orbit (same elevation as desktop)
        const progress = scrollProgress.current ?? 0
        const theta = progress * Math.PI * 2  // full orbit

        const cam = state.camera
        cam.position.set(
            Math.cos(theta) * Math.cos(basePhi) * baseRadius,
            Math.sin(basePhi) * baseRadius,
            Math.sin(theta) * Math.cos(basePhi) * baseRadius,
        )
        cam.lookAt(LOOK_AT)
    })

    return (
        <>
            {/* Black hole core */}
            <mesh>
                <circleGeometry args={[0.32, 64]} />
                <meshBasicMaterial color="#000000" side={THREE.DoubleSide} />
            </mesh>

            {/* Accretion disk particles */}
            <points ref={diskRef}>
                <primitive object={diskGeo} attach="geometry" />
                <shaderMaterial
                    vertexShader={diskVert}
                    fragmentShader={diskFrag}
                    uniforms={diskUniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>

            {/* Orbital ring particles */}
            <points ref={orbRef}>
                <primitive object={orbGeo} attach="geometry" />
                <shaderMaterial
                    vertexShader={orbVert}
                    fragmentShader={orbFrag}
                    uniforms={orbUniforms}
                    transparent
                    depthWrite={false}
                    blending={THREE.AdditiveBlending}
                />
            </points>
        </>
    )
}

/* ═══════════════════════════════════════════════════════════════
   Export
═══════════════════════════════════════════════════════════════ */
export default function MobileBlackHole({ scrollProgress, isMenuOpen }) {
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
            style={{
                width: '100%', height: '100%', background: 'transparent',
                // Hide canvas when menu open — avoids context loss from dynamic frameloop
                // GPU still renders to invisible canvas (safer than context loss)
                opacity: isMenuOpen ? 0 : 1,
                transition: 'opacity 0.15s',
            }}
        >
            <BlackHoleScene scrollProgress={scrollProgress} isMenuOpen={isMenuOpen} />
        </Canvas>
    )
}
