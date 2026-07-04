import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = resolve(root, "dist-web");

const scannedExtensions = new Set([".html", ".js", ".mjs"]);
const forbiddenPatterns = [
  "@tauri-apps",
  "__TAURI__",
  "app/shell/bootstrap",
  "app/shell/close-guard",
  "ipc/design",
  "ipc/settings",
  "ipc/species",
  "ipc/favorites",
  "ipc/community",
  "ipc/geocoding",
  "ipc/problem-report",
  "plugin-dialog",
];

if (!existsSync(distRoot)) {
  console.error(`Missing Web Edition build output at ${distRoot}. Run npm run build:web first.`);
  process.exit(1);
}

const violations = [];

for (const filePath of filesUnder(distRoot)) {
  if (!scannedExtensions.has(extensionOf(filePath))) continue;
  const source = readFileSync(filePath, "utf8");
  for (const pattern of forbiddenPatterns) {
    if (source.includes(pattern)) {
      violations.push(`${relative(root, filePath)} contains ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error("Web Edition build contains desktop-only imports or runtime markers:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    if (entry.isFile()) return [child];
    return [];
  });
}

function extensionOf(filePath) {
  const name = filePath.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "";
  return name.slice(dot);
}
