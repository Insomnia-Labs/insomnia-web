import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store/useStore'

export default function CameraController() {
    const { camera, clock } = useThree()
    const section = useStore((state) => state.section)
    const lookAtTarget = useRef(new THREE.Vector3(0, 0, 0))

    // Sphere positions (matching OrbitalSpheres.jsx)
    const sphereData = {
        lab: { angle: 0, radius: 2.5 },
        info: { angle: (2 * Math.PI) / 3, radius: 3.5 },
        products: { angle: (4 * Math.PI) / 3, radius: 3.2 },
    }

    // Group rotation from OrbitalSpheres
    const groupRotation = -Math.PI / 2 + 0.2

    // Calculate sphere world position with time offset
    const getSpherePosition = (sphere, timeOffset = 0) => {
        const angle = sphere.angle + timeOffset * 0.15  // Matches sphere rotation speed
        const x = sphere.radius * Math.cos(angle)
        const y = sphere.radius * Math.sin(angle)

        // Apply group rotation
        const rotatedY = y * Math.cos(groupRotation)
        const rotatedZ = y * Math.sin(groupRotation)

        return new THREE.Vector3(x, rotatedY, rotatedZ)
    }

    useFrame((state, delta) => {
        // Clamp delta to prevent camera flying away when tab is inactive
        const safeDelta = Math.min(delta, 0.1)
        const step = 2.0 * safeDelta

        // Special handling for home page
        if (section === 'home') {
            // Side and top view position
            const homePos = new THREE.Vector3(7, 5, 3)
            const homeTarget = new THREE.Vector3(0, -0.6, 0)

            camera.position.lerp(homePos, step)
            lookAtTarget.current.lerp(homeTarget, step)
            camera.lookAt(lookAtTarget.current)
            return
        }

        const activeSphere = sphereData[section] || sphereData.lab
        const time = state.clock.elapsedTime

        // Get current position of active sphere (with rotation)
        const activeSpherePos = getSpherePosition(activeSphere, time)

        // Get other spheres positions (with rotation)
        const otherSpheres = Object.keys(sphereData)
            .filter(key => key !== section)
            .map(key => getSpherePosition(sphereData[key], time))

        // Calculate center point of other spheres
        const centerOfOthers = new THREE.Vector3()
        otherSpheres.forEach(pos => centerOfOthers.add(pos))
        centerOfOthers.divideScalar(otherSpheres.length)

        // Camera follows behind active sphere
        const directionToOthers = new THREE.Vector3().subVectors(centerOfOthers, activeSpherePos).normalize()
        const cameraPos = activeSpherePos.clone().add(directionToOthers.multiplyScalar(-3.5)) // 3.5 units behind
        cameraPos.y += 1.6 // Higher viewpoint

        // Smooth camera movement (faster)
        camera.position.lerp(cameraPos, step)

        // Look at center of other spheres
        lookAtTarget.current.lerp(centerOfOthers, step)
        camera.lookAt(lookAtTarget.current)
    })

    return null
}
