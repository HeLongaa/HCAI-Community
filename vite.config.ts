import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: mode === 'production'
      ? [{ find: /^(?:\.\.\/)*\.\/data\/mockData$|^(?:\.\.\/)+data\/mockData$/, replacement: fileURLToPath(new URL('./src/data/productionData.ts', import.meta.url)) }]
      : [],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
}))
