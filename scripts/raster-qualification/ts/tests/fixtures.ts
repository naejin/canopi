/**
 * A complete, internally coherent set of producer reports.
 *
 * These are hand-authored from the plan's declared surface: every field is a
 * literal here rather than a value computed by the code under test. They exist so
 * each boundary test starts from a control that actually satisfies the contract,
 * and then perturbs exactly one thing.
 *
 * The numbers are the plan's, not the implementation's: a 1 GiB combined raster
 * memory budget, a 128 MiB decoded cache, 2 concurrent reads, 32 pending display
 * requests, a 100 ms sampling cadence, a 1024x1024-cell numeric window with a
 * one-cell halo, and a 50 ms UI-thread bound with one cold and three warm runs of
 * at least 100 samples each.
 */

export const PLAN = {
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
  sourceAgeDays: 7,
} as const;

export const ROUTE_ID = 'candidate-raster-route-v1';
export const ENVIRONMENT_ID = 'qualification-host-chromium-150';
export const HOST_ID = 'chromium';
export const FIXTURE_NAME = 'derived_cog';
export const FIXTURE_HASH = 'a'.repeat(64);
export const PIN_WHITEBOX = '9c0ff4fdf3513f27b89c78e294610c3b418b3a4f';
export const PIN_COG_TILER = 'a71c321d357b0fde063238ab38bcf7ddb914eacd';

export interface IdentityOptions {
  readonly experiment: string;
  readonly fixturePolicy?: string;
  readonly fixtures?: readonly { name: string; sha256: string }[];
  readonly artifact?: { name: string; version: string };
  readonly sidecarPolicy?: string;
  readonly recordedAt?: number;
  readonly runId?: string;
  readonly transport?: string;
  readonly routeId?: string;
  readonly environment?: string;
  readonly host?: string;
  readonly command?: string;
  readonly digest?: string;
}

/** The identity block a real report carries once its run recorded provenance. */
export function identity(options: IdentityOptions): Record<string, unknown> {
  const { experiment } = options;
  const block: Record<string, unknown> = {
    id: experiment,
    experiment,
    runId: options.runId ?? `run-${experiment}-0001`,
    recordedAt: options.recordedAt ?? 1_760_000_000,
    command: options.command ?? `measure.py ${experiment} --out reports/`,
    routeId: options.routeId ?? ROUTE_ID,
    environment: options.environment ?? ENVIRONMENT_ID,
    host: options.host ?? HOST_ID,
    fixturePolicy: options.fixturePolicy ?? 'measured',
    sidecarPolicy: options.sidecarPolicy ?? 'not_applicable',
    transport: options.transport ?? 'local-bridge',
    fixtures: options.fixtures ?? [{ name: FIXTURE_NAME, sha256: FIXTURE_HASH }],
    artifact: options.artifact ?? { name: 'whitebox-wasm', version: '0.5.1' },
  };
  if (options.digest !== undefined) block['digest'] = options.digest;
  return block;
}

function assertion(name: string, ok: boolean): Record<string, unknown> {
  return { name, ok };
}

/** A latencies list of exactly `count` finite values. */
function latencies(count: number, startMs: number): number[] {
  return Array.from({ length: count }, (_, index) => startMs + (index % 7) * 0.1);
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!;
}

/** A complete, self-consistent display trace run. */
export function traceRun(
  name: 'cold' | 'warm',
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const samples = latencies(PLAN.minLatenciesPerRun, name === 'cold' ? 4 : 2);
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name,
    ok: true,
    pageErrors: [],
    wallSeconds: 1.5,
    tileRequests: 128,
    tilesRendered: 128,
    failedTiles: 0,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1]!,
    individualLatenciesMs: samples,
    cachesCleared: name === 'cold' ? 'cold' : 'warm',
    longTaskMaxMs: 12,
    longTaskCount: 1,
    longTaskObserverSupported: true,
    ...overrides,
  };
}

export interface ReportOptions {
  readonly experiment: string;
  readonly result?: string;
  readonly assertions?: readonly Record<string, unknown>[];
  readonly identity?: Record<string, unknown> | null;
  readonly extra?: Record<string, unknown>;
  /** Accepted for readability at call sites that also build the identity. */
  readonly fixturePolicyOverride?: string;
}

export function report(options: ReportOptions): Record<string, unknown> {
  const base: Record<string, unknown> = {
    experiment: options.experiment,
    result: options.result ?? 'pass',
    failures: [],
    assertions: options.assertions ?? [],
    fixturesTested: 1,
    identity: options.identity === undefined
      ? identity({ experiment: options.experiment })
      : options.identity,
  };
  return { ...base, ...(options.extra ?? {}) };
}

/**
 * The candidate pins, read from the same shape `candidates.json` uses, so the
 * tests exercise the real declaration rather than an invented one.
 */
export function candidatePins(): Record<string, string> {
  return { 'whitebox-wasm': PIN_WHITEBOX, 'cog-tiler-wasm': PIN_COG_TILER };
}

export function fixtureManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    declared: [{ name: FIXTURE_NAME, sha256: FIXTURE_HASH }],
    requiredFixtures: {},
    ...overrides,
  };
}

/** The requirement contract as the real file declares it, for validation tests. */
export function contractWith(
  requirements: readonly Record<string, unknown>[],
): Record<string, unknown> {
  return { contractVersion: 1, source: 'test contract', title: 'test', requirements };
}

export function requirement(
  id: string,
  assertions: readonly string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    title: `${id} title`,
    phase: 'Q',
    required: true,
    role: `${id} role`,
    assertions,
    requiresRasterFixture: true,
    ...overrides,
  };
}
