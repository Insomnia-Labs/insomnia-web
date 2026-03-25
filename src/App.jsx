import { Suspense, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import BlackHole from './components/3d/BlackHole'
import CameraController from './components/3d/CameraController'
import OrbitalSpheres from './components/3d/OrbitalSpheres'
import SpatialContent from './components/3d/SpatialContent'
import Overlay from './components/ui/Overlay'
import VoidLogin from './components/ui/VoidLogin'
import { EffectComposer, Bloom, Noise, Vignette, ChromaticAberration } from '@react-three/postprocessing'
import { useIsMobile } from './hooks/useIsMobile'
import MobileBackground from './components/ui/MobileBackground'
import ChatList from './components/ui/ChatList'
import Dashboard from './components/ui/Dashboard'
import { PERFORMANCE_CONFIG } from './constants/performance'
import { useStore } from './store/useStore'

function App() {
  const isMobile = useIsMobile()
  const section = useStore((state) => state.section)
  const showVoidLogin = useStore((state) => state.showVoidLogin)
  const setShowVoidLogin = useStore((state) => state.setShowVoidLogin)
  const showVoid = useStore((state) => state.showVoid)
  const postLoginView = useStore((state) => state.postLoginView)
  const config = isMobile ? PERFORMANCE_CONFIG.mobile : PERFORMANCE_CONFIG.desktop
  const containerRef = useRef(null)

  // Block 3D canvas interaction whenever a full-screen modal is open
  const blockCanvas = showVoidLogin || showVoid

  // Block body scroll on mobile when viewing sections (not home)
  useEffect(() => {
    if (isMobile && section !== 'home') {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [isMobile, section])

  // Re-open login modal automatically after OAuth redirect.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('openVoidLogin') !== '1') return

    setShowVoidLogin(true)
    url.searchParams.delete('openVoidLogin')
    const query = url.searchParams.toString()
    const nextUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash || ''}`
    window.history.replaceState({}, '', nextUrl)
  }, [setShowVoidLogin])

  return (
    <div
      ref={containerRef}
      className={`w-full relative ${isMobile ? 'app-mobile-shell' : 'h-screen'} ${postLoginView ? 'bg-[#1a1b26]' : ''}`}
    >
      {!postLoginView && (
        <>
          {!isMobile ? (
            <Canvas
              dpr={config.dpr}
              gl={{
                powerPreference: "high-performance",
                antialias: false,
                stencil: false,
                depth: true
              }}
              camera={{ position: [25, 12, 25], fov: 45 }}
              eventSource={containerRef}
              eventPrefix="client"
              style={{ pointerEvents: blockCanvas ? 'none' : 'auto' }}
            >
              <CameraController />
              <Suspense fallback={null}>
                <color attach="background" args={['#050505']} />
                <ambientLight intensity={0.5} />
                <BlackHole />
                <OrbitalSpheres />
                <SpatialContent />
                <Stars radius={100} depth={50} count={config.starsCount} factor={4} saturation={0} fade speed={1} />
              </Suspense>
              {config.enableBloom && (
                <EffectComposer disableNormalPass multisampling={0}>
                  <Bloom luminanceThreshold={0.2} luminanceSmoothing={config.bloomSmoothing} height={config.bloomHeight} intensity={0.8} />
                  <Vignette eskil={false} offset={0.1} darkness={0.6} />
                </EffectComposer>
              )}
            </Canvas>
          ) : (
            <>
              {section === 'home' ? (
                <MobileBackground />
              ) : (
                <div className="fixed inset-0 bg-black" />
              )}
            </>
          )}
          <Overlay />
        </>
      )}

      {postLoginView === 'chats' && <ChatList />}
      {postLoginView === 'dashboard' && <Dashboard />}
      <VoidLogin />
    </div>
  )
}

export default App
