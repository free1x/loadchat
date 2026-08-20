import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3210',
      '/socket.io': { target: 'http://localhost:3210', ws: true },
      '/s': 'http://localhost:3210'
    }
  },
  build: { outDir: 'dist', sourcemap: true }
})
