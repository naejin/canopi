import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), base: './', publicDir: false,
  plugins: [preact()], build: { outDir: '../../dist-pdf-validation', emptyOutDir: true } })
