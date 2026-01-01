# Insomnia - Interactive Black Hole Landing Page

An immersive 3D landing page featuring a realistic black hole simulation with gravitational effects, accretion disk, and interactive particle systems.

## 🚀 Technologies

- **React** + **Vite** - Fast development and build
- **React Three Fiber** - 3D rendering with Three.js
- **@react-three/drei** - Useful helpers for R3F
- **@react-three/postprocessing** - Advanced visual effects (Bloom, Vignette)
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **GSAP** - Smooth animations
- **Custom GLSL Shaders** - Realistic particle physics

## 🎮 Features

- ✨ **Realistic Black Hole**: Accretion disk with 90,000+ particles
- 🌌 **Multiple Particle Systems**: Orbital, spiral, ambient, and cursor-interactive particles
- 🔭 **Gravitational Lensing**: Visual effects simulating spacetime warping
- 💫 **Interactive UI**: Orbital navigation spheres with smooth animations
- 🎨 **Post-Processing**: Bloom and vignette effects for atmosphere
- ⚡ **Optimized Performance**: See [PERFORMANCE_OPTIMIZATIONS.md](./PERFORMANCE_OPTIMIZATIONS.md)

## 🏃 Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## ⚡ Performance

The project has been heavily optimized for smooth 60 FPS performance:
- **90,740 total particles** (optimized from 207,000)
- **56% reduction** in particle count
- **Cached THREE.js objects** to prevent garbage collection
- **Throttled raycasting** for better CPU usage
- **Optimized post-effects** for GPU efficiency

See [PERFORMANCE_OPTIMIZATIONS.md](./PERFORMANCE_OPTIMIZATIONS.md) for detailed information.

## 📁 Project Structure

```
src/
├── components/
│   ├── 3d/              # Three.js 3D components
│   │   ├── BlackHole.jsx
│   │   ├── BlackHoleParticles.jsx
│   │   ├── CursorParticles3D.jsx
│   │   └── OrbitalSpheres.jsx
│   └── ui/              # UI overlay components
│       └── Overlay.jsx
├── store/               # Zustand state management
├── App.jsx              # Main application
└── main.jsx             # Entry point
```

## 🎯 Browser Support

- Modern browsers with WebGL 2.0 support
- Optimized for Chrome, Firefox, Safari, Edge
- Recommended: Dedicated GPU for best performance
```
