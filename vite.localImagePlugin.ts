import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'

const IMAGE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg',
  '.avif',
  '.ico',
])

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
}

/**
 * Dev-only: serve an absolute local image path for pasted filesystem paths.
 * GET /__paletter_local?path=C:%5CUsers%5C...%5Cshot.png
 */
export function paletterLocalImagePlugin(): Plugin {
  return {
    name: 'paletter-local-image',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/__paletter_local')) {
          next()
          return
        }

        try {
          const url = new URL(req.url, 'http://localhost')
          const raw = url.searchParams.get('path') || ''
          if (!raw) {
            res.statusCode = 400
            res.end('missing path')
            return
          }

          // Reject obvious non-absolute inputs
          const isWin = /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')
          const isUnix = raw.startsWith('/')
          if (!isWin && !isUnix) {
            res.statusCode = 400
            res.end('path must be absolute')
            return
          }

          const resolved = path.resolve(raw)
          const ext = path.extname(resolved).toLowerCase()
          if (!IMAGE_EXT.has(ext)) {
            res.statusCode = 400
            res.end('not an image')
            return
          }

          if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
            res.statusCode = 404
            res.end('not found')
            return
          }

          res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-store')
          fs.createReadStream(resolved).pipe(res)
        } catch {
          res.statusCode = 500
          res.end('error')
        }
      })
    },
  }
}
