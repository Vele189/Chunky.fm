import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER = process.env.CHUNKY_SERVER ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: SERVER, changeOrigin: true },
      '/ws': { target: SERVER.replace(/^http/, 'ws'), ws: true },
    },
  },
})
