import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxied so the browser sees every API/SSE request as same-origin
      // (localhost:5173) — the gateway's httpOnly auth cookies then just
      // work with no CORS/credentials wrangling in dev.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
