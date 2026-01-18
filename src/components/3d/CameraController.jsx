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

    const lookAtTarget = useRef(new THREE.Vector3(0, 0, 0))

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
            // Use GSAP to animate camera
            const targetPos = { x: 0, y: 0, z: 2 }

            gsap.to(camera.position, {
                x: targetPos.x,
                y: targetPos.y,
                z: targetPos.z,
                duration: 3.0,
                ease: 'power1.inOut',
                onUpdate: () => {
                    camera.lookAt(0, 0, 0)
                },
                onComplete: () => {
                    setShowMenu(true)
                    setCameraAnimation(null)
                    setIsDiving(false)
                }
            })
        }
    }, [cameraAnimation, isDiving, camera, setShowMenu, setCameraAnimation, setIsDiving])

    useFrame((state, delta) => {
        const safeDelta = Math.min(delta, 0.1)
        const step = 2.0 * safeDelta

        // Block all camera updates during dive
        if (isDiving) {
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
        const right = new THREE.Vector3().crossVectors(directionToOthers, new THREE.Vector3(0, 1, 0)).normalize()

        const cameraPos = activeSpherePos.clone()
            .add(directionToOthers.multiplyScalar(-3.5))
            .add(right.multiplyScalar(2.2))

        cameraPos.y += 2.0

        camera.position.lerp(cameraPos, step)
        lookAtTarget.current.lerp(centerOfOthers, step)
        camera.lookAt(lookAtTarget.current)
    })

    return null
}
