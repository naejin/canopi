/**
 * The declared qualification route.
 *
 * These are declarations, not observations: the route label, the transports each
 * source must have used, and the artifact versions the plan pins. They are read
 * from here rather than from any report, because an expectation taken from the
 * thing being checked is not an expectation.
 *
 * They are deliberately explicit rather than inferred, and the CLI never supplies
 * them from report content.
 */

/** The environment identity every report must have recorded. */
export const QUALIFICATION_ENVIRONMENT_ID = 'qualification-host-chromium-150';
/** The route identity every report must have recorded. */
export const QUALIFICATION_ROUTE_ID = 'candidate-raster-route-v1';
/** The observation host this run declares. Only `desktop-webview` satisfies Q-HOST-1. */
export const QUALIFICATION_HOST = 'chromium';

/**
 * The transport each source role must have used.
 *
 * The plan requires the proposed **local bridge** for bounded numeric access: "Q
 * must qualify this local bridge, not just HTTP COG access", and a remote HTTP demo
 * "does not qualify local access". Declaring `http-range` here would make the
 * comparison vacuous by expecting the very capability the plan rules out.
 */
export const LOCAL_BRIDGE_TRANSPORT = 'local-bridge';

export const TRANSPORT_BY_ROLE: ReadonlyMap<string, string> = new Map([
  ['q2', LOCAL_BRIDGE_TRANSPORT],
  ['q3prepare', LOCAL_BRIDGE_TRANSPORT],
  ['q3members', LOCAL_BRIDGE_TRANSPORT],
  ['q4slope', LOCAL_BRIDGE_TRANSPORT],
  ['q4crs', LOCAL_BRIDGE_TRANSPORT],
  ['q5lifecycle', LOCAL_BRIDGE_TRANSPORT],
  ['q6resources', LOCAL_BRIDGE_TRANSPORT],
  ['trace', LOCAL_BRIDGE_TRANSPORT],
]);

/** The experiment identifier each source role must record. */
export const EXPERIMENT_BY_ROLE: ReadonlyMap<string, string> = new Map([
  ['q1', 'q1-artifacts'],
  ['q2', 'q2-numeric'],
  ['q3prepare', 'q3-prepare'],
  ['q3members', 'q3-members'],
  ['q4slope', 'q4-slope'],
  ['q4crs', 'q4-crs'],
  ['q5lifecycle', 'q5-lifecycle'],
  ['q6resources', 'q6-resources'],
  ['trace', 'q6-trace'],
  // Legacy/raw sources that carry no identity of their own.
  ['ledger', 'ledger'],
  ['browser', 'q2ranged'],
]);

/**
 * Which declared engine each source role must have exercised.
 *
 * A role that the plan leaves unpinned still names the engine it expects: the plan
 * retains native GDAL for preparation, CRS and slope, and "unpinned" means the
 * version is discovered rather than declared, not that any engine is acceptable.
 */
export const ARTIFACT_BY_ROLE: ReadonlyMap<string, { name: string; version: string }> = new Map([
  ['q2', { name: 'whitebox-wasm', version: '0.5.1' }],
  ['q3prepare', { name: 'gdal', version: 'retained' }],
  ['q3members', { name: 'reference-resolver', version: 'harness' }],
  ['q4slope', { name: 'gdal', version: 'retained' }],
  ['q4crs', { name: 'gdal', version: 'retained' }],
  ['q5lifecycle', { name: 'whitebox-wasm', version: '0.5.1' }],
  ['q6resources', { name: 'whitebox-wasm', version: '0.5.1' }],
  ['trace', { name: 'cog-tiler-wasm', version: '0.3.6' }],
]);

/**
 * Roles whose declared engine the plan retains rather than pins.
 *
 * For these the name must still match the declared engine, while the version is
 * whatever the run discovered.
 */
export const UNPINNED_ENGINE_ROLES: ReadonlySet<string> = new Set([
  'q3prepare',
  'q4slope',
  'q4crs',
]);

/** The measured artifacts the route must cover. */
export const ROUTE_ARTIFACTS: readonly { name: string; version: string }[] = [
  { name: 'whitebox-wasm', version: '0.5.1' },
  { name: 'cog-tiler-wasm', version: '0.3.6' },
];

/** Artifact roles the plan explicitly leaves unpinned, with its reason. */
export const UNPINNED_ROLES: readonly { name: string; reason: string }[] = [
  { name: 'gdal', reason: 'the plan allows native GDAL to retain preparation and slope' },
  { name: 'reference-resolver', reason: 'harness reference implementation, not a shipped artifact' },
];

/** Route labels, used for diagnostics and the decision document. */
export const ROUTE_LABELS = {
  numeric: 'whitebox-wasm CogStream over HTTP Range requests',
  prepare: 'native GDAL preparation',
  member: 'ordered member replay (reference implementation)',
  slope: 'native GDAL slope plus independent Horn implementation',
  crs: 'native GDAL CRS resolution',
  lifecycle: 'owned-adapter lifecycle probe',
  display: 'cog-tiler-wasm renderTilePNG over a disk-backed File',
  artifacts: 'candidate artifact resolution',
} as const;

/** Declared budgets and bounds, matching the plan. */
export const DECLARATIONS = {
  combinedMemoryMiB: 1024,
  decodedCacheBytes: 128 * 1024 * 1024,
  activeReads: 2,
  queueDepth: 32,
  sampleIntervalMs: 100,
  windowEdge: 1024,
  windowCells: 1024 * 1024,
  uiThreadBoundMs: 50,
  coldRuns: 1,
  warmRuns: 3,
  minLatenciesPerRun: 100,
  minTileRequestsPerRun: 100,
  sourceAgeDays: 7,
} as const;

/** The route declaration object a caller can inspect. */
export function declaredRoute(): Record<string, unknown> {
  return {
    routeId: QUALIFICATION_ROUTE_ID,
    environment: QUALIFICATION_ENVIRONMENT_ID,
    host: QUALIFICATION_HOST,
    ...ROUTE_LABELS,
    artifacts: ROUTE_ARTIFACTS,
    unpinnedRoles: UNPINNED_ROLES,
  };
}

/**
 * The full declared expectation set for one report role.
 *
 * The caller supplies a role and a path; everything the source is checked against
 * comes from here, so a report cannot nominate its own expected route, transport,
 * environment or artifact.
 */
export function expectationsForRole(
  role: string,
): {
  role: string;
  experiment: string;
  routeId: string;
  environment: string;
  host: string;
  transport?: string;
  requiresRasterFixture: boolean;
  expectedArtifact?: { name: string; version: string };
  unpinnedEngine?: boolean;
  requiredArtifacts: readonly { name: string; version: string }[];
  unpinnedRoles: readonly string[];
} | undefined {
  const experiment = EXPERIMENT_BY_ROLE.get(role);
  if (experiment === undefined) return undefined;
  const transport = TRANSPORT_BY_ROLE.get(role);
  const artifact = ARTIFACT_BY_ROLE.get(role);
  // The artifact report covers every pinned candidate artifact; every other role
  // covers the single artifact it exercised.
  const requiredArtifacts = role === 'q1' ? ROUTE_ARTIFACTS : artifact === undefined ? [] : [artifact];
  return {
    role,
    experiment,
    routeId: QUALIFICATION_ROUTE_ID,
    environment: QUALIFICATION_ENVIRONMENT_ID,
    host: QUALIFICATION_HOST,
    ...(transport === undefined ? {} : { transport }),
    requiresRasterFixture: role !== 'q1',
    ...(artifact === undefined ? {} : { expectedArtifact: artifact }),
    ...(UNPINNED_ENGINE_ROLES.has(role) ? { unpinnedEngine: true } : {}),
    requiredArtifacts,
    unpinnedRoles: UNPINNED_ROLES.map((entry) => entry.name),
  };
}

/** The hosts that can satisfy Q-HOST-1. Only the packaged Desktop WebView can. */
export const ALLOWED_HOSTS: readonly string[] = ['desktop-webview'];
