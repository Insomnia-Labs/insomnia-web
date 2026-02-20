import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useStore } from '../../store/useStore'
import gsap from 'gsap'
import { useIsMobile } from '../../hooks/useIsMobile'
import { CAMERA_SETTINGS } from '../../constants/layout'

export default function CameraController() {
    const { camera } = useThree()
    const section = useStore((state) => state.section)
    const setSection = useStore((state) => state.setSection)
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

    // Mobile detection
    const isMobile = useIsMobile()

    // Sphere positions
    const sphereData = {
        lab: { angle: 0, radius: 2.5 },
        info: { angle: (2 * Math.PI) / 3, radius: 2.8 },
        products: { angle: (4 * Math.PI) / 3, radius: 3.2 },
    }

    const groupRotation = -Math.PI / 2 + 0.2

    const isPageVisibleRef = useRef(true) // Track page visibility
    const orbitTimeRef = useRef(0) // Custom time counter for orbit

    useEffect(() => {
        const handleVisibilityChange = () => {
            isPageVisibleRef.current = !document.hidden
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [])

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

    // Handle eject animation (always returns to canonical home position)
    useEffect(() => {
        if (cameraAnimation === 'eject' && isExiting) {
            // ALWAYS eject back to the fixed home position — never to diveStartPosition.
            // This prevents the camera from flying toward a sphere or a random point.
            const HOME_POS = isMobile
                ? new THREE.Vector3(12, 12, 12)
                : new THREE.Vector3(7, 5, 3)
            const HOME_LOOKAT = new THREE.Vector3(0, -0.6, 0)

            const timeline = gsap.timeline()

            timeline.to(camera.position, {
                x: HOME_POS.x,
                y: HOME_POS.y,
                z: HOME_POS.z,
                duration: 1.8,
                ease: 'power3.out',
            }, 0)

            timeline.to(lookAtTarget.current, {
                x: HOME_LOOKAT.x,
                y: HOME_LOOKAT.y,
                z: HOME_LOOKAT.z,
                duration: 1.8,
                ease: 'power3.out',
                onUpdate: () => {
                    camera.lookAt(lookAtTarget.current)
                },
                onComplete: () => {
                    setCameraAnimation(null)
                    setIsExiting(false)
                    setInsideBlackHole(false) // UNLOCK camera
                    setSection('home')        // Ensure we are on home — prevents snapping to sphere
                }
            }, 0)
        }
    }, [cameraAnimation, isExiting, camera, setCameraAnimation, setIsExiting, setInsideBlackHole, setSection, isMobile])

    useFrame((state, delta) => {
        // Skip all calculations when page is hidden (tab is inactive)
        if (!isPageVisibleRef.current) {
            return
        }

        const safeDelta = Math.min(delta, 0.1)
        const step = 2.0 * safeDelta

        // Update custom time
        orbitTimeRef.current += safeDelta

        // Block all camera updates during animations or when inside black hole
        if (isDiving || isExiting || insideBlackHole) {
            return
        }

        // Home view
        if (section === 'home') {
            // Mobile: pull back and up to frame centered
            const homePos = isMobile
                ? new THREE.Vector3(12, 12, 12)
                : new THREE.Vector3(7, 5, 3)
            const homeTarget = new THREE.Vector3(0, -0.6, 0)

            camera.position.lerp(homePos, step)
            lookAtTarget.current.lerp(homeTarget, step)
            camera.lookAt(lookAtTarget.current)
            return
        }

        // Section views
        const activeSphere = sphereData[section] || sphereData.lab
        // Use custom orbit time instead of global time
        const time = orbitTimeRef.current

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
        const config = isMobile ? CAMERA_SETTINGS.mobile : CAMERA_SETTINGS.desktop
        const dist = config.dist
        const height = config.height
        const sideOffset = config.sideOffset

        const cameraPos = activeSpherePos.clone()
            .add(directionToOthers.clone().multiplyScalar(-dist))
            .add(right.clone().multiplyScalar(sideOffset))
            .add(new THREE.Vector3(0, height, 0))

        // 2. Look Target
        // To place the sphere on the Left, we look at a point to the Right of it.
        // Increasing this offset moves the sphere further Left.
        const lookRightOffset = config.lookRightOffset

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
