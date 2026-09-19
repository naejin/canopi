/**
 * The qualification host's frontend build configuration.
 *
 * A plain exported object, so the config needs no resolution of the `vite` package
 * from this isolated directory: Vite itself is invoked from the repository's
 * installed tooling. The bundle is a measurement instrument, built into `web/dist`
 * and served from the bundle with no dev server.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default {
  root: here,
  base: './',
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(here, 'index.html'),
        worker: resolve(here, 'src/worker.ts'),
      },
      output: { entryFileNames: '[name].js' },
    },
  },
  worker: { format: 'es' },
  resolve: {
    // The API is resolved from the repository's installed tooling. A prefix alias is
    // needed as well as the bare specifier, because the frontend imports a subpath
    // (`@tauri-apps/api/core`) rather than only the package root.
    alias: [
      {
        find: /^@tauri-apps\/api$/,
        replacement: resolve(here, '../../../../desktop/web/node_modules/@tauri-apps/api/index.js'),
      },
      {
        find: /^@tauri-apps\/api\//,
        replacement: `${resolve(here, '../../../../desktop/web/node_modules/@tauri-apps/api')}/`,
      },
    ],
  },
};
