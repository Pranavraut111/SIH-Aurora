import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Vitest's configuration lives in vitest.config.js, so a production build never
// references test-only files (which the Docker build context excludes).
export default defineConfig({
  plugins: [react()],
  build: {
    // The entry chunk is ~440 kB; the only chunk above 500 kB is three.js, and that
    // one is lazily loaded with the 3D twin, so it never delays first paint.
    chunkSizeWarningLimit: 600,
  },
})
