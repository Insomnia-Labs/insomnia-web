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

## 🔐 Telegram Auth Architecture (Cloudflare)

Telegram API keys are now handled server-side via Cloudflare Pages Functions:

- Frontend calls `/api/tg/*`
- Pages Functions connect to Telegram (GramJS)
- Browser never receives `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`

### Required Cloudflare Secrets

In your **Cloudflare Pages project** (`Settings -> Environment variables`), add:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_SECRET` (long random string, 32+ chars)

Add them for both environments you use (`Production` and `Preview`), then redeploy.

### Important

- Do **not** use `VITE_TELEGRAM_API_ID` / `VITE_TELEGRAM_API_HASH` anymore.
- Anything prefixed with `VITE_` is exposed to browser users.

### Optional frontend API base override

By default, frontend calls same-origin `/api/tg/*`.
If API is hosted on another domain, set:

- `VITE_TELEGRAM_API_BASE_URL=https://your-api-domain`

## ☁️ Cloudflare local run

1. Create local secrets file from example:

```bash
cp .dev.vars.example .dev.vars
```

2. Fill real values in `.dev.vars`.
3. Run local Pages environment:

```bash
npm run dev:pages
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
