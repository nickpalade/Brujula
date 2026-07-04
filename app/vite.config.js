import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // npm workspaces hoist some deps (e.g. qrcode.react) to the repo root while
  // react/react-dom stay in app/ — without dedupe, QRCodeSVG hits a second React
  // copy and the Connect modal crashes at runtime.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
})
