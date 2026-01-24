import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store/useStore'
import gsap from 'gsap'

export default function CameraController() {
    const { camera } = useThree()
    const section = useStore((state) => state.section)
    const cameraAnimation = useStore((state) => state.cameraAnimation)
    const setCameraAnimation = useStore((state) => state.setCameraAnimation)
    const setShowMenu = useStore((state) => state.setShowMenu)
    const isDiving = useStore((state) => state.isDiving)
    const setIsDiving = useStore((state) => state.setIsDiving)
    const isExiting = useStore((state) => state.isExiting)
    const setIsExiting = useStore((state) => state.setIsExiting)
    const insideBlackHole = useStore((state) => state.insideBlackHole)
    const setInsideBlackHole = useStore((state) => state.setInsideBlackHole)

    const lookAtTarget = useRef(new THREE.Vector3(0, 0, 0))
    const diveStartPosition = useRef(null)
    const diveStartLookAt = useRef(null)

    // Sphere positions
    const sphereData = {
        lab: { angle: 0, radius: 2.5 },
        info: { angle: (2 * Math.PI) / 3, radius: 3.5 },
        products: { angle: (4 * Math.PI) / 3, radius: 3.2 },
    }

    const groupRotation = -Math.PI / 2 + 0.2

    const getSpherePosition = (sphere, timeOffset = 0) => {
        const angle = sphere.angle + timeOffset * 0.15
        const x = sphere.radius * Math.cos(angle)
        const y = sphere.radius * Math.sin(angle)

        const rotatedY = y * Math.cos(groupRotation)
        const rotatedZ = y * Math.sin(groupRotation)

        return new THREE.Vector3(x, rotatedY, rotatedZ)
    }

    // Handle dive animation
    useEffect(() => {
        if (cameraAnimation === 'dive' && isDiving) {
            // Save current camera position and look-at target to avoid teleportation
            diveStartPosition.current = camera.position.clone()
            diveStartLookAt.current = lookAtTarget.current.clone()

            // Create smooth transition from current position to black hole center
            const timeline = gsap.timeline()

            // Animate camera position
            timeline.to(camera.position, {
                x: 0,
                y: 0,
                z: 0.1, // Almost at the center
                duration: 1.2,
                ease: 'power3.in', // Accelerating into the black hole
            }, 0)

            // Simultaneously animate look-at target to center
            timeline.to(lookAtTarget.current, {
                x: 0,
                y: 0,
                z: 0,
                duration: 1.2,
                ease: 'power3.in',
                onUpdate: () => {
                    // Update camera to look at the animated target
                    camera.lookAt(lookAtTarget.current)
                },
                onComplete: () => {
                    // Animation complete, camera stays frozen in black hole
                    setCameraAnimation(null)
                    setIsDiving(false)
                    setInsideBlackHole(true) // LOCK camera inside black hole
                }
            }, 0)
        }
    }, [cameraAnimation, isDiving, camera, setCameraAnimation, setIsDiving, setInsideBlackHole])

    // Handle eject animation (reverse of dive)
    useEffect(() => {
        if (cameraAnimation === 'eject' && isExiting) {
            // Make sure we have saved positions to return to
            if (!diveStartPosition.current || !diveStartLookAt.current) {
                // Fallback to home position
                diveStartPosition.current = new THREE.Vector3(7, 5, 3)
                diveStartLookAt.current = new THREE.Vector3(0, -0.6, 0)
            }

            // Create smooth transition from black hole back to original position
            const timeline = gsap.timeline()

            // Animate camera position back
            timeline.to(camera.position, {
                x: diveStartPosition.current.x,
                y: diveStartPosition.current.y,
                z: diveStartPosition.current.z,
                duration: 1.8,
                ease: 'power3.out', // Decelerating as ejected from black hole
            }, 0)

            // Simultaneously animate look-at target back
            timeline.to(lookAtTarget.current, {
                x: diveStartLookAt.current.x,
                y: diveStartLookAt.current.y,
                z: diveStartLookAt.current.z,
                duration: 1.8,
                ease: 'power3.out',
                onUpdate: () => {
                    camera.lookAt(lookAtTarget.current)
                },
                onComplete: () => {
                    // Animation complete, return to normal
                    setCameraAnimation(null)
                    setIsExiting(false)
                    setInsideBlackHole(false) // UNLOCK camera
                }
            }, 0)
        }
    }, [cameraAnimation, isExiting, camera, setCameraAnimation, setIsExiting, setInsideBlackHole])

    useFrame((state, delta) => {
        const safeDelta = Math.min(delta, 0.1)
        const step = 2.0 * safeDelta

        // Block all camera updates during animations or when inside black hole
        if (isDiving || isExiting || insideBlackHole) {
            return
        }

        // Home view
        if (section === 'home') {
            const homePos = new THREE.Vector3(7, 5, 3)
            const homeTarget = new THREE.Vector3(0, -0.6, 0)

            camera.position.lerp(homePos, step)
            lookAtTarget.current.lerp(homeTarget, step)
            camera.lookAt(lookAtTarget.current)
            return
        }

        // Section views
        const activeSphere = sphereData[section] || sphereData.lab
        const time = state.clock.elapsedTime

        const activeSpherePos = getSpherePosition(activeSphere, time)
        const otherSpheres = Object.keys(sphereData)
            .filter(key => key !== section)
            .map(key => getSpherePosition(sphereData[key], time))

        const centerOfOthers = new THREE.Vector3()
        otherSpheres.forEach(pos => centerOfOthers.add(pos))
        centerOfOthers.divideScalar(otherSpheres.length)

        const directionToOthers = new THREE.Vector3().subVectors(centerOfOthers, activeSpherePos).normalize()
        const up = new THREE.Vector3(0, 1, 0)
        const right = new THREE.Vector3().crossVectors(directionToOthers, up).normalize()

        // 1. Move Camera Back significantly to see the context
        const dist = 7.0
        const height = 2.0
        const sideOffset = 3.0 // Increased to move camera more to the side

        const cameraPos = activeSpherePos.clone()
            .add(directionToOthers.clone().multiplyScalar(-dist))
            .add(right.clone().multiplyScalar(sideOffset))
            .add(new THREE.Vector3(0, height, 0))

        // 2. Look Target
        // To place the sphere on the Left, we look at a point to the Right of it.
        // Increasing this offset moves the sphere further Left.
        const lookRightOffset = 3.5

        const focusPoint = activeSpherePos.clone()
            .add(right.clone().multiplyScalar(lookRightOffset))

            // Subtle: Look slightly towards the "others" to show connection lines if any
            .add(directionToOthers.clone().multiplyScalar(1.0))

        camera.position.lerp(cameraPos, step)
        lookAtTarget.current.lerp(focusPoint, step)
        camera.lookAt(lookAtTarget.current)
    })

    return null
}
