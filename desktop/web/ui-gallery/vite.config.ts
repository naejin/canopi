import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { fileURLToPath, URL } from 'node:url'

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))
export default defineConfig(({ command }) => {
  if (command !== 'serve') throw new Error('The UI gallery is development-only.')
  return {
    root: path('.'),
    cacheDir: path('../node_modules/.vite-ui-gallery'),
    plugins: [preact()],
    resolve: { alias: {
      '@tauri-apps/api/core': path('./memory-backend.ts'),
      '@tauri-apps/plugin-dialog': path('./memory-dialogs.ts'),
      '#species-catalog-live': path('../src/app/plant-browser/live.desktop.ts'),
      '#platform': path('../src/platform/browser.ts'),
      '#canvas-pdf-platform': path('../src/app/canvas-pdf/platform.browser.ts'),
      '#design-template-import-workflow': path('../src/app/design-template-import/workflow.browser.ts'),
      '#design-template-catalog': path('../src/app/community/catalog.browser.ts'),
    } },
    server: { host: '127.0.0.1', port: 1422, strictPort: true, fs: { allow: [path('..')] } },
  }
})
