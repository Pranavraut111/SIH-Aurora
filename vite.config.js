import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The entry chunk is ~440 kB; the only chunk above 500 kB is three.js, and that
    // one is lazily loaded with the 3D twin, so it never delays first paint.
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.{js,jsx}'],
    // tests/e2e is Playwright's; it must never be collected by Vitest.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    restoreMocks: true,
    coverage: { reporter: ['text', 'text-summary'], include: ['src/**/*.{js,jsx}'] },
  },
})
