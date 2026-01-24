import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stars } from '@react-three/drei'
import BlackHole from './components/3d/BlackHole'
import CameraController from './components/3d/CameraController'
import OrbitalSpheres from './components/3d/OrbitalSpheres'
import SpatialContent from './components/3d/SpatialContent'
import Overlay from './components/ui/Overlay'
import { EffectComposer, Bloom, Noise, Vignette, ChromaticAberration } from '@react-three/postprocessing'

function App() {
  return (
    <div className="w-full h-screen bg-black relative">
      <Canvas
        dpr={[1, 1.5]} // Limit pixel ratio for huge performance boost on Retina screens
        gl={{
          powerPreference: "high-performance",
          antialias: false, // Disable MSAA (Bloom+Noise masks aliasing)
          stencil: false,
          depth: true
        }}
        camera={{ position: [25, 12, 25], fov: 45 }}
      >
        <CameraController />
        <Suspense fallback={null}>
          <color attach="background" args={['#050505']} />
          <ambientLight intensity={0.5} />
          <BlackHole />
          <OrbitalSpheres />
          <SpatialContent />
          <Stars radius={100} depth={50} count={2000} factor={4} saturation={0} fade speed={1} />
        </Suspense>
        <EffectComposer disableNormalPass multisampling={0}>
          <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} height={300} intensity={0.8} />
          <Vignette eskil={false} offset={0.1} darkness={1.1} />
        </EffectComposer>
      </Canvas>
      <Overlay />
    </div>
  )
}

export default App
