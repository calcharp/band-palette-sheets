import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { paletterLocalImagePlugin } from './vite.localImagePlugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), paletterLocalImagePlugin()],
})
