import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

const WEB_BASE_PATH = "/app/";
const CLOUDFLARE_PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const CLOUDFLARE_PAGES_FREE_MAX_FILES = 20_000;
const MANIFEST_NAME = "canopi-web-edition-manifest.json";
const CATALOG_MANIFEST_PATH = "canopi-catalog/manifest.json";
const FORBIDDEN_DUCKDB_WASM_RE = /(?:^|\/)duckdb-.*\.wasm$/i;

const scriptRoot = import.meta.url.startsWith("file:")
  ? dirname(fileURLToPath(import.meta.url))
  : resolve(process.cwd(), "scripts");
const webRoot = resolve(scriptRoot, "..");
const repoRoot = resolve(webRoot, "../..");

export async function packageWebEdition(options = {}) {
  const distRoot = resolve(options.distRoot ?? resolve(webRoot, "dist-web"));
  const artifactRoot = resolve(options.artifactRoot ?? resolve(webRoot, "dist-web-artifacts"));
  const version = options.version ?? readPackageVersion(webRoot);
  const commit = options.commit ?? readGitCommit(repoRoot);
  const maxAssetBytes = options.maxAssetBytes ?? CLOUDFLARE_PAGES_MAX_ASSET_BYTES;
  const maxFileCount = options.maxFileCount ?? CLOUDFLARE_PAGES_FREE_MAX_FILES;

  if (!existsSync(distRoot)) {
    throw new Error(`Missing Web Edition build output at ${distRoot}. Run npm run build:web first.`);
  }

  const sourceFiles = filesUnder(distRoot).sort(comparePaths);
  if (sourceFiles.length === 0) {
    throw new Error(`Web Edition build output is empty at ${distRoot}.`);
  }
  if (sourceFiles.length > maxFileCount) {
    throw new Error(
      `Web Edition build contains ${sourceFiles.length} files, above the Cloudflare Pages file limit ${maxFileCount}.`,
    );
  }

  const sizeViolations = sourceFiles
    .map((filePath) => ({
      relativePath: toPortablePath(relative(distRoot, filePath)),
      bytes: statSync(filePath).size,
    }))
    .filter((file) => file.bytes > maxAssetBytes);

  if (sizeViolations.length > 0) {
    throw new Error(
      [
        `Web Edition build exceeds the Cloudflare Pages per-asset limit of ${maxAssetBytes} bytes.`,
        ...sizeViolations.map((file) => `- ${file.relativePath}: ${file.bytes} bytes`),
      ].join("\n"),
    );
  }
  validateNoRawDuckDbWasm(distRoot, sourceFiles);
  const catalog = validateCatalogArtifact(distRoot, maxAssetBytes);

  const artifactName = `canopi-web-edition-v${sanitizeVersion(version)}-${sanitizeCommit(commit)}`;
  const artifactDir = resolve(artifactRoot, artifactName);
  const archivePath = resolve(artifactRoot, `${artifactName}.tar.gz`);

  rmSync(artifactDir, { recursive: true, force: true });
  rmSync(archivePath, { force: true });
  mkdirSync(artifactDir, { recursive: true });

  for (const sourcePath of sourceFiles) {
    const sourceRelativePath = toPortablePath(relative(distRoot, sourcePath));
    const artifactRelativePath = sourceRelativePath === "web.html" ? "index.html" : sourceRelativePath;
    const targetPath = resolve(artifactDir, artifactRelativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }

  if (!existsSync(resolve(artifactDir, "index.html"))) {
    throw new Error("Web Edition artifact is missing index.html. Expected dist-web/web.html to package as index.html.");
  }

  const manifestFiles = filesUnder(artifactDir)
    .map((filePath) => createManifestEntry(artifactDir, filePath))
    .sort((left, right) => left.path.localeCompare(right.path));
  const manifest = {
    name: "Canopi Web Edition",
    version,
    commit,
    basePath: WEB_BASE_PATH,
    spaFallback: {
      source: "/app/*",
      destination: "/app/index.html",
      status: 200,
    },
    limits: {
      cloudflarePagesMaxAssetBytes: maxAssetBytes,
      cloudflarePagesMaxFiles: maxFileCount,
    },
    catalog,
    files: manifestFiles,
  };

  writeFileSync(resolve(artifactDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(archivePath, createTarGz(artifactDir));

  return {
    artifactDir,
    archivePath,
    manifestPath: resolve(artifactDir, MANIFEST_NAME),
  };
}

function validateNoRawDuckDbWasm(distRoot, sourceFiles) {
  const violation = sourceFiles
    .map((filePath) => toPortablePath(relative(distRoot, filePath)))
    .find((relativePath) => FORBIDDEN_DUCKDB_WASM_RE.test(relativePath));
  if (violation) {
    throw new Error(`${violation} must not bundle DuckDB raw WASM; use CDN-selected DuckDB-WASM bundles.`);
  }
}

function validateCatalogArtifact(distRoot, maxAssetBytes) {
  const catalogManifestPath = resolve(distRoot, CATALOG_MANIFEST_PATH);
  if (!existsSync(catalogManifestPath)) {
    throw new Error(
      `Web Edition build is missing generated Species Catalog manifest at ${CATALOG_MANIFEST_PATH}. Run npm run generate:web-catalog before npm run package:web.`,
    );
  }
  const catalogManifest = JSON.parse(readFileSync(catalogManifestPath, "utf8"));
  if (catalogManifest.asset_format !== "parquet") {
    throw new Error("Web Edition Species Catalog manifest must use Parquet assets for production packaging.");
  }
  if (!Array.isArray(catalogManifest.supported_filters) || catalogManifest.supported_filters.length === 0) {
    throw new Error("Web Edition Species Catalog manifest is missing supported-filter metadata.");
  }
  const catalogRoot = dirname(catalogManifestPath);
  const catalogMaxAssetBytes = stricterCatalogMaxAssetBytes(catalogManifest, maxAssetBytes);
  const assets = catalogAssetEntries(catalogManifest);
  if (assets.length === 0) {
    throw new Error("Web Edition Species Catalog manifest does not list required catalog assets.");
  }
  for (const asset of assets) {
    validateCatalogAssetEntry(catalogRoot, asset, catalogMaxAssetBytes);
  }
  return {
    manifestPath: CATALOG_MANIFEST_PATH,
    assetFormat: typeof catalogManifest.asset_format === "string" ? catalogManifest.asset_format : null,
    supportedFilters: catalogManifest.supported_filters.flatMap((filter) => (
      filter && typeof filter.key === "string" ? [filter.key] : []
    )),
    files: assets.map((asset) => `canopi-catalog/${asset.path}`),
  };
}

function stricterCatalogMaxAssetBytes(catalogManifest, maxAssetBytes) {
  const catalogLimit = catalogManifest.cloudflare_pages?.max_asset_bytes;
  return Number.isFinite(catalogLimit) && catalogLimit > 0
    ? Math.min(maxAssetBytes, catalogLimit)
    : maxAssetBytes;
}

function catalogAssetEntries(catalogManifest) {
  const assets = catalogManifest.assets;
  if (!assets || typeof assets !== "object") {
    throw new Error("Web Edition Species Catalog manifest does not list required catalog assets.");
  }
  const species = parseCatalogAssetList("species", assets.species);
  const names = assets.names && typeof assets.names === "object"
    ? Object.values(assets.names).map((entry) => parseCatalogAssetEntry("names", entry))
    : [];
  const images = parseCatalogAssetList("images", assets.images);
  if (species.length === 0 || names.length === 0 || images.length === 0) {
    throw new Error("Web Edition Species Catalog manifest does not list required catalog assets.");
  }
  return [...species, ...names, ...images];
}

function parseCatalogAssetList(kind, value) {
  return Array.isArray(value)
    ? value.map((entry) => parseCatalogAssetEntry(kind, entry))
    : [];
}

function parseCatalogAssetEntry(kind, value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.path !== "string" ||
    !Number.isFinite(value.bytes) ||
    typeof value.sha256 !== "string"
  ) {
    throw new Error(`Invalid Web Edition Species Catalog ${kind} asset manifest entry.`);
  }
  return {
    path: value.path,
    bytes: value.bytes,
    sha256: value.sha256,
  };
}

function validateCatalogAssetEntry(catalogRoot, asset, maxAssetBytes) {
  const assetPath = resolveCatalogAssetPath(catalogRoot, asset.path);
  if (!existsSync(assetPath)) {
    throw new Error(`Web Edition Species Catalog asset is missing: ${asset.path}`);
  }
  const bytes = statSync(assetPath).size;
  if (bytes > maxAssetBytes) {
    throw new Error(
      `Web Edition Species Catalog asset ${asset.path} exceeds the Cloudflare Pages per-asset limit of ${maxAssetBytes} bytes.`,
    );
  }
  if (bytes !== asset.bytes) {
    throw new Error(
      `Web Edition Species Catalog byte count mismatch for ${asset.path}: manifest ${asset.bytes}, actual ${bytes}.`,
    );
  }
  const sha256 = sha256File(assetPath);
  if (sha256 !== asset.sha256) {
    throw new Error(
      `Web Edition Species Catalog checksum mismatch for ${asset.path}: manifest ${asset.sha256}, actual ${sha256}.`,
    );
  }
}

function resolveCatalogAssetPath(catalogRoot, assetPath) {
  if (assetPath.startsWith("/") || assetPath.split("/").includes("..")) {
    throw new Error(`Unsafe Web Edition Species Catalog asset path: ${assetPath}`);
  }
  const resolved = resolve(catalogRoot, assetPath);
  const relativePath = relative(catalogRoot, resolved);
  if (relativePath.startsWith("..") || relativePath === "") {
    throw new Error(`Unsafe Web Edition Species Catalog asset path: ${assetPath}`);
  }
  return resolved;
}

function sha256File(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function readPackageVersion(root) {
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version.length === 0) {
    throw new Error("desktop/web/package.json is missing a version string.");
  }
  return packageJson.version;
}

function readGitCommit(root) {
  const gitDir = resolveGitDir(root);
  const head = readFileSync(resolve(gitDir, "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head.slice(0, 12);

  const ref = head.slice("ref: ".length);
  const refPath = resolve(gitDir, ref);
  if (existsSync(refPath)) return readFileSync(refPath, "utf8").trim().slice(0, 12);

  const packedRefsPath = resolve(gitDir, "packed-refs");
  if (existsSync(packedRefsPath)) {
    for (const line of readFileSync(packedRefsPath, "utf8").split("\n")) {
      if (line.endsWith(` ${ref}`)) return line.slice(0, 12);
    }
  }

  throw new Error(`Could not resolve git commit for ${ref}.`);
}

function resolveGitDir(root) {
  const dotGit = resolve(root, ".git");
  const dotGitStat = statSync(dotGit);
  if (dotGitStat.isDirectory()) return dotGit;

  const gitFile = readFileSync(dotGit, "utf8").trim();
  if (!gitFile.startsWith("gitdir: ")) {
    throw new Error(`Unsupported .git file at ${dotGit}.`);
  }
  return resolve(root, gitFile.slice("gitdir: ".length));
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(child);
    if (entry.isFile()) return [child];
    return [];
  });
}

function createManifestEntry(root, filePath) {
  const content = readFileSync(filePath);
  return {
    path: toPortablePath(relative(root, filePath)),
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function createTarGz(root) {
  const chunks = [];
  const filePaths = filesUnder(root).sort(comparePaths);
  for (const filePath of filePaths) {
    const relativePath = toPortablePath(relative(root, filePath));
    const content = readFileSync(filePath);
    chunks.push(createTarHeader(relativePath, content.byteLength));
    chunks.push(content);
    chunks.push(Buffer.alloc(padLength(content.byteLength)));
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks), { level: 9 });
}

function createTarHeader(path, size) {
  const pathBytes = Buffer.from(path);
  if (pathBytes.byteLength > 100) {
    throw new Error(`Cannot package ${path}: tar path exceeds 100 bytes.`);
  }

  const header = Buffer.alloc(512);
  writeString(header, path, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 8);
  return header;
}

function writeString(buffer, value, offset, length) {
  Buffer.from(value).copy(buffer, offset, 0, length);
}

function writeOctal(buffer, value, offset, length) {
  const text = value.toString(8).padStart(length - 1, "0");
  buffer.write(text.slice(-length + 1), offset, length - 1, "ascii");
  buffer[offset + length - 1] = 0;
}

function padLength(size) {
  const remainder = size % 512;
  return remainder === 0 ? 0 : 512 - remainder;
}

function sanitizeVersion(version) {
  return version.replace(/[^0-9A-Za-z._-]/g, "-");
}

function sanitizeCommit(commit) {
  return commit.replace(/[^0-9A-Za-z]/g, "").slice(0, 12);
}

function toPortablePath(path) {
  return path.split(sep).join("/");
}

function comparePaths(left, right) {
  return left.localeCompare(right);
}

function parseArgs(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument list near ${name ?? "<end>"}.`);
    }
    values.set(name, value);
  }
  return {
    distRoot: values.get("--dist"),
    artifactRoot: values.get("--out"),
    version: values.get("--version"),
    commit: values.get("--commit"),
    maxAssetBytes: values.has("--max-asset-bytes") ? Number(values.get("--max-asset-bytes")) : undefined,
    maxFileCount: values.has("--max-file-count") ? Number(values.get("--max-file-count")) : undefined,
  };
}

if (isCli()) {
  packageWebEdition(parseArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`Packaged Web Edition artifact: ${relative(webRoot, result.archivePath)}`);
      console.log(`Manifest: ${relative(webRoot, result.manifestPath)}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

function isCli() {
  return process.argv[1] !== undefined
    && import.meta.url.startsWith("file:")
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}
