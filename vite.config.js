import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Polyfills for Node.js built-ins required by GramJS (Buffer, process, crypto, etc.)
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'crypto', 'events', 'path'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],

  resolve: {
    alias: {
      // Replace the incomplete os polyfill with our own full stub.
      // GramJS calls os.type(), os.hostname() etc. which default polyfills don't provide.
      'os': path.resolve(__dirname, 'src/polyfills/os.js'),
    },
  },

  base: './',
})
