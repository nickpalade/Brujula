import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'node:os'
import { createSocket } from 'node:dgram'

const backendTarget = process.env.VITE_API_BASE || 'http://localhost:8000'

function detectLanIp() {
  return new Promise((resolve) => {
    const fallback = () => {
      for (const infos of Object.values(os.networkInterfaces())) {
        for (const info of infos ?? []) {
          if (info.family === 'IPv4' && !info.internal) return info.address
        }
      }
      return '127.0.0.1'
    }

    try {
      const sock = createSocket('udp4')
      sock.once('error', () => {
        sock.close()
        resolve(fallback())
      })
      sock.connect(1, '10.255.255.255', () => {
        const { address } = sock.address()
        sock.close()
        resolve(address)
      })
    } catch {
      resolve(fallback())
    }
  })
}

function devServerPort(server) {
  const address = server.httpServer?.address()
  if (address && typeof address === 'object') return address.port
  return server.config.server.port || 5173
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // npm workspaces hoist some deps (e.g. qrcode.react) to the repo root while
  // react/react-dom stay in app/ — without dedupe, QRCodeSVG hits a second React
  // copy and the Connect modal crashes at runtime.
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '0.0.0.0',
    configureServer(server) {
      server.middlewares.use('/api/network-info', async (req, res, next) => {
        if (req.method !== 'GET') return next()

        const lanIp = await detectLanIp()
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          success: true,
          data: { lan_origin: `http://${lanIp}:${devServerPort(server)}` },
          error: null,
        }))
      })
    },
    proxy: {
      '/api': backendTarget,
      '/health': backendTarget,
      '/language-config': backendTarget,
      '/model-config': backendTarget,
      '/models': backendTarget,
      '/tiles': backendTarget,
    },
  },
})
