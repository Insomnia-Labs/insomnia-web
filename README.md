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

## 🔐 Auth Architecture (Google + Supabase + Telegram)

Authentication is fully server-side on Cloudflare Pages Functions:

- Frontend talks to `/api/auth/*` and `/api/tg/*`
- Google OAuth identifies the website user
- Supabase stores app sessions (`users`, `app_sessions`)
- Telegram MTProto session is stored in Supabase per user (encrypted)
- Browser never receives `TELEGRAM_API_ID` / `TELEGRAM_API_HASH`

### Required Cloudflare Variables

Set these in **Cloudflare Pages -> Settings -> Environment variables** (Preview + Production):

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_SECRET` (32+ chars)
- `TELEGRAM_DB_SESSION_SECRET` (32+ chars, separate from cookie secret)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `SUPABASE_URL` (your project URL, e.g. `https://xxxx.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only secret key)
- Optional: `GOOGLE_REDIRECT_URI` (if callback must be fixed explicitly)

### Required Supabase Tables

Create tables in Supabase SQL Editor by pasting the file contents from:

- `supabase/schema.sql`

### Important

- Do **not** expose Telegram credentials or Supabase service key via `VITE_*` variables.
- Anything prefixed with `VITE_` is public in the browser bundle.
- OAuth callback should be: `https://<your-domain>/api/auth/google-callback`.

### Optional Frontend API Base Override

By default frontend calls same-origin API paths.
If API is proxied on another domain, set:

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
