import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath, URL } from "node:url";
import { resolveWebEditionDevHtmlUrl } from "./src/web/dev-entry";

export default defineConfig(({ mode }) => {
  const isWebEdition = mode === 'web';
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
  const designTemplateImportWorkflowAdapter = fileURLToPath(new URL(
    isWebEdition
      ? './src/app/design-template-import/workflow.browser.ts'
      : './src/app/design-template-import/workflow.desktop.ts',
    import.meta.url,
  ));
  const designTemplateCatalogAdapter = fileURLToPath(new URL(
    isWebEdition
      ? './src/app/community/catalog.browser.ts'
      : './src/app/community/catalog.desktop.ts',
    import.meta.url,
  ));

  return {
    plugins: [
      preact(),
      webEditionDevEntryPlugin(isWebEdition),
    ],
    base: isWebEdition ? "/app/" : undefined,
    resolve: {
      alias: {
        '#platform': platformAdapter,
        '#species-catalog-live': speciesCatalogLiveAdapter,
        '#design-template-import-workflow': designTemplateImportWorkflowAdapter,
        '#design-template-catalog': designTemplateCatalogAdapter,
      },
    },
    server: {
      port: 1420,
      strictPort: true,
    },
    build: {
      outDir: isWebEdition ? "dist-web" : "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: isWebEdition ? "web.html" : "index.html",
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
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
    },
  };
});

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
