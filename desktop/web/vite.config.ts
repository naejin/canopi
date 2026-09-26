import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath, URL } from "node:url";
import { resolveWebEditionDevHtmlUrl } from "./src/web/dev-entry";

const DEFAULT_WEB_EDITION_BASE_PATH = "/app/";
const WEB_EDITION_BASE_PATH_ENV = "CANOPI_WEB_BASE_PATH";
const tauriConfigPath = fileURLToPath(new URL('../tauri.conf.json', import.meta.url));

export default defineConfig(({ mode }) => {
  const isWebEdition = mode === 'web';
  const webEditionBasePath = isWebEdition
    ? resolveWebEditionBasePath(process.env[WEB_EDITION_BASE_PATH_ENV])
    : undefined;
  const platformAdapter = fileURLToPath(new URL(
    isWebEdition ? './src/platform/browser.ts' : './src/platform/desktop.ts',
    import.meta.url,
  ));
  const speciesCatalogLiveAdapter = fileURLToPath(new URL(
    isWebEdition
      ? './src/app/plant-browser/live.browser.ts'
      : './src/app/plant-browser/live.desktop.ts',
    import.meta.url,
  ));
  return {
    cacheDir: isWebEdition ? "node_modules/.vite-web" : "node_modules/.vite-desktop",
    plugins: [
      preact(),
      webEditionDevEntryPlugin(isWebEdition),
    ],
    base: webEditionBasePath,
    resolve: {
      alias: {
        '#platform': platformAdapter,
        '#canvas-pdf-platform': fileURLToPath(new URL(isWebEdition ? './src/app/canvas-pdf/platform.browser.ts' : './src/app/canvas-pdf/platform.desktop.ts', import.meta.url)),
        '#budget-export-platform': fileURLToPath(new URL(isWebEdition ? './src/app/budget/platform.browser.ts' : './src/app/budget/platform.desktop.ts', import.meta.url)),
        '#geocoding-transport': fileURLToPath(new URL(isWebEdition ? './src/app/geocoding/transport.browser.ts' : './src/app/geocoding/transport.desktop.ts', import.meta.url)),
        '#species-catalog-live': speciesCatalogLiveAdapter,
      },
    },
    optimizeDeps: {
      // The WASM decoder packages resolve their .wasm files relative to their
      // own module URL; pre-bundling would move them away from those files.
      exclude: ['cog-tiler-wasm', 'whitebox-wasm'],
      esbuildOptions: { target: 'es2022' },
    },
    worker: {
      // The raster decode lane imports geotiff codecs dynamically.
      format: 'es' as const,
    },
    server: {
      port: isWebEdition ? 1421 : 1420,
      strictPort: true,
      fs: {
        allow: [
          fileURLToPath(new URL('.', import.meta.url)),
          tauriConfigPath,
          `${tauriConfigPath}?raw`,
        ],
      },
    },
    build: {
      target: 'es2022',
      outDir: isWebEdition ? "dist-web" : "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: isWebEdition ? "web.html" : "index.html",
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (id.includes("maplibre-gl-raster") || id.includes("@deck.gl") || id.includes("@luma.gl") || id.includes("@developmentseed") || id.includes("@math.gl") || id.includes("@loaders.gl")) return "raster-display";
            if (id.includes("maplibre-gl")) return "maplibre-gl";
            if (id.includes("@tauri-apps")) return "tauri";
            if (id.includes("i18next")) return "i18n";
            return undefined;
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      // An unhandled error or rejection fails the run even when every test passes.
      dangerouslyIgnoreUnhandledErrors: false,
      coverage: {
        provider: "v8",
        include: ["src/**/*.{ts,tsx}"],
        exclude: ["src/**/*.test.{ts,tsx}", "src/__tests__/**", "src/generated/**", "src/vendor/**"],
        reporter: ["text-summary", "json-summary"],
        // Ratchet: the floor is the measured baseline; raise it, never lower it.
        thresholds: { statements: 86.9, branches: 77.4, functions: 87.7, lines: 90.3 },
      },
    },
  };
});

function resolveWebEditionBasePath(value: string | undefined): string {
  const basePath = (value ?? DEFAULT_WEB_EDITION_BASE_PATH).trim();
  if (basePath.length === 0) {
    throw new Error(`${WEB_EDITION_BASE_PATH_ENV} must not be empty.`);
  }
  if (basePath === "/") return "/";
  if (!basePath.startsWith("/")) {
    throw new Error(`${WEB_EDITION_BASE_PATH_ENV} must be "/" or an absolute path such as "/app/".`);
  }
  return basePath.endsWith("/") ? basePath : `${basePath}/`;
}

function webEditionDevEntryPlugin(enabled: boolean): Plugin {
  return {
    name: "canopi-web-edition-dev-entry",
    apply: "serve",
    configureServer(server) {
      if (!enabled) return;

      server.middlewares.use((request, _response, next) => {
        const webEntryUrl = resolveWebEditionDevHtmlUrl(request.url);
        if (webEntryUrl) request.url = webEntryUrl;
        next();
      });
    },
  };
}
