import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("maplibre-gl")) return "maplibre-gl";
          if (id.includes("konva")) return "konva";
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
});
