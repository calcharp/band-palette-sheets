import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { paletterLocalImagePlugin } from './vite.localImagePlugin'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so Electron can load dist/ via file://
  base: './',
  plugins: [react(), paletterLocalImagePlugin()],
})
