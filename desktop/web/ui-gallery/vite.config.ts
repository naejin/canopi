import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath, URL } from 'node:url'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
export default defineConfig(({ command }) => {
  if (command !== 'serve') throw new Error('The UI gallery is development-only.')
  return {
    root: path('.'),
    cacheDir: path('../node_modules/.vite-ui-gallery'),
    // Serves the prepared PDF fonts (`npm run prepare:pdf-fonts`) for the PDF export workspace.
    publicDir: path('../public'),
    plugins: [preact()],
    resolve: { alias: {
      '@tauri-apps/api/core': path('./memory-backend.ts'),
      '@tauri-apps/plugin-dialog': path('./memory-dialogs.ts'),
      '#species-catalog-live': path('../src/app/plant-browser/live.desktop.ts'),
      '#platform': path('../src/platform/browser.ts'),
      '#canvas-pdf-platform': path('./canvas-pdf-platform.ts'),
      '#budget-export-platform': path('./budget-export.ts'),
      '#geocoding-transport': path('../src/app/geocoding/transport.browser.ts'),
    } },
    server: { host: '127.0.0.1', port: 1422, strictPort: true, fs: { allow: [path('..')] } },
  }
})
