/**
 * A complete, coherent qualification input for the whole contract.
 *
 * Every requirement gets a report whose recorded observations actually satisfy it,
 * so the end-to-end control establishes the contract before any test perturbs one
 * thing. Values here are literal and hand-derived; none is computed by the code
 * under test.
 */

import { FIXTURE_HASH, FIXTURE_NAME, identity, PLAN, report, traceRun } from './fixtures.js';

export const NOW = 1_760_000_100;

/** The real contract, read from the authoritative file at test time. */
export function realContractPath(): string {
  return new URL('../../../requirements.json', import.meta.url).pathname;
}

/** Producer assertion names each requirement mapping reads, with `ok` outcomes. */
const ASSERTIONS: Record<string, { name: string; ok: boolean }[]> = {
  q1: [
    { name: `version:whitebox-wasm@0.5.1`, ok: true },
    { name: `version:cog-tiler-wasm@0.3.6`, ok: true },
    { name: `integrity:whitebox-wasm`, ok: true },
    { name: `integrity:cog-tiler-wasm`, ok: true },
    { name: `license-recorded:whitebox-wasm`, ok: true },
    { name: `license-recorded:cog-tiler-wasm`, ok: true },
    { name: 'apis-and-worker-target-recorded', ok: true },
  ],
  q2: [
    { name: 'no-whole-file-request:plane2000', ok: true },
    { name: 'analytic:plane2000/origin', ok: true },
    { name: 'validity:plane2000/origin', ok: true },
    { name: 'zero-negative-retained:plane2000', ok: true },
  ],
  q3prepare: [
    { name: 'original-unchanged', ok: true },
    { name: 'original-hash-declared', ok: true },
    { name: 'derived-tiled', ok: true },
    { name: 'cell-exact', ok: true },
    { name: 'geotransform-preserved', ok: true },
    { name: 'all-values-match', ok: true },
  ],
  q3members: [
    { name: 'multi-member:spanning', ok: true },
    { name: 'gap-empty:unoccupied', ok: true },
    { name: 'precedence-last-wins', ok: true },
    { name: 'nodata-does-not-erase', ok: true },
  ],
  q4slope: [
    { name: 'hole-centre-not-interpolated:hole', ok: true },
    { name: 'degrees:plane2000', ok: true },
    { name: 'percent:plane2000', ok: true },
    { name: 'seam-matches-whole', ok: true },
    { name: 'outer-edge:edge', ok: true },
  ],
  q4crs: [
    { name: 'reference-epsg-configured-explicitly', ok: true },
    { name: 'crs-resolver-identified', ok: true },
    { name: 'candidate-projection-matches-reference', ok: true },
    { name: 'candidate-returned-coordinate-addresses-requested-pixel', ok: true },
    { name: 'original-metadata-untouched', ok: true },
  ],
  q5lifecycle: [
    { name: 'cancellation-stops-scheduling', ok: true },
    { name: 'cancellation-settles-in-bound', ok: true },
    { name: 'expected-rejection:uncancelled-control', ok: true },
    { name: 'adapter-dispose-idempotent', ok: true },
    { name: 'lifecycle:stalled-worker-termination', ok: true },
    { name: 'lifecycle:dead-worker-detectable', ok: true },
    { name: 'malformed-rejected:truncated-header', ok: true },
    { name: 'malformed-rejected:corrupt-tile', ok: true },
    { name: 'malformed-rejected:out-of-image-window', ok: true },
  ],
};

/** A complete report for each role the contract consumes. */
export function roleReports(): Record<string, Record<string, unknown>> {
  const candidateResource = {
    route: 'candidate (wasm ranged transport)',
    routeRole: 'candidate',
    perFixture: [],
    incrementalPeakRssMiB: 300,
    sampleIntervalMs: PLAN.sampleIntervalMs,
    sampleCount: 12,
    maxConcurrentChildren: 1,
    temporaryDiskHighWaterBytes: 4096,
    decodedCacheBytes: 1024,
    activeReads: PLAN.activeReads,
    queueDepth: 1,
  };
  return {
    q1: report({
      experiment: 'q1-artifacts',
      fixturePolicyOverride: 'artifact-only',
      assertions: ASSERTIONS['q1']!,
      identity: identity({
        experiment: 'q1-artifacts',
        fixturePolicy: 'artifact-only',
        fixtures: [],
        artifact: { name: 'whitebox-wasm', version: '0.5.1' },
      }),
      extra: {
        fixturesTested: 0,
        verifiedArtifacts: [
          { name: 'whitebox-wasm', version: '0.5.1', license: 'MIT OR Apache-2.0' },
          { name: 'cog-tiler-wasm', version: '0.3.6', license: 'MIT' },
        ],
        sourceCorrespondence: [
          {
            artifact: 'whitebox-wasm',
            version: '0.5.1',
            pinnedRevision: '9c0ff4fdf3513f27b89c78e294610c3b418b3a4f',
            artifactRevision: '9c0ff4fdf3513f27b89c78e294610c3b418b3a4f',
            matches: true,
          },
          {
            artifact: 'cog-tiler-wasm',
            version: '0.3.6',
            pinnedRevision: 'a71c321d357b0fde063238ab38bcf7ddb914eacd',
            artifactRevision: 'a71c321d357b0fde063238ab38bcf7ddb914eacd',
            matches: true,
          },
        ],
        notes: [],
      },
    }),
    q2: report({
      experiment: 'q2-numeric',
      assertions: ASSERTIONS['q2']!,
      extra: {
        testedWindows: 9,
        serverLedger: { fixtureBytesServed: 4_194_304, fixtureRequests: 12 },
        windows: [
          {
            fixture: 'plane2000',
            label: 'bounded',
            classification: 'measured',
            window: { x: 0, y: 0, w: PLAN.windowEdge, h: PLAN.windowEdge, haloCells: 1 },
            cells: PLAN.windowCells,
          },
        ],
      },
    }),
    q3prepare: report({
      experiment: 'q3-prepare',
      assertions: ASSERTIONS['q3prepare']!,
      identity: identity({ experiment: 'q3-prepare', sidecarPolicy: 'not_applicable' }),
      extra: {
        sidecar: { expectedSha256: FIXTURE_HASH, sha256: FIXTURE_HASH, after: true },
      },
    }),
    q3members: report({
      experiment: 'q3-members',
      assertions: ASSERTIONS['q3members']!,
      identity: identity({
        experiment: 'q3-members',
        sidecarPolicy: 'not_applicable',
        artifact: { name: 'reference-resolver', version: 'harness' },
      }),
    }),
    q4slope: report({
      experiment: 'q4-slope',
      assertions: ASSERTIONS['q4slope']!,
      identity: identity({
        experiment: 'q4-slope',
        sidecarPolicy: 'not_applicable',
        artifact: { name: 'gdal', version: '3.8.4' },
      }),
    }),
    q4crs: report({
      experiment: 'q4-crs',
      assertions: ASSERTIONS['q4crs']!,
      identity: identity({
        experiment: 'q4-crs',
        sidecarPolicy: 'not_applicable',
        artifact: { name: 'gdal', version: '3.8.4' },
      }),
    }),
    q5lifecycle: report({
      experiment: 'q5-lifecycle',
      assertions: ASSERTIONS['q5lifecycle']!,
    }),
    q6resources: report({
      experiment: 'q6-resources',
      assertions: [{ name: 'route-measured', ok: true }],
      extra: {
        measurements: [
          candidateResource,
          {
            route: 'reference reader (native byte-range, NOT the candidate route)',
            routeRole: 'reference',
            incrementalPeakRssMiB: 18.32,
            maxSingleReadBytes: 4_194_304,
          },
        ],
      },
    }),
    trace: report({
      experiment: 'q6-trace',
      assertions: [{ name: 'trace-recorded', ok: true }],
      identity: identity({
        experiment: 'q6-trace',
        artifact: { name: 'cog-tiler-wasm', version: '0.3.6' },
      }),
      extra: {
        runs: [
          traceRun('cold'),
          traceRun('warm'),
          traceRun('warm'),
          traceRun('warm'),
        ],
      },
    }),
  };
}

/** Which report role feeds each source the contract expects. */
export const SOURCE_ROLES = [
  'q1',
  'q2',
  'q3prepare',
  'q3members',
  'q4slope',
  'q4crs',
  'q5lifecycle',
  'q6resources',
  'trace',
] as const;

void FIXTURE_NAME;

/**
 * Requirements whose every assertion can be satisfied by a recorded observation.
 *
 * The rest are genuinely unmeasured: the plan requires the observation, no probe
 * emits it, and the decision correctly reports a gap. They are listed separately so
 * the tests can assert both facts - that a supported requirement is reachable, and
 * that an unsupported one is never promoted to a pass by adjacent evidence.
 */
export const SUPPORTED_REQUIREMENTS: readonly string[] = [
  'Q-ART-1',
  'Q-LOCAL-1',
  'Q-PREP-1',
  'Q-CRS-1',
  'Q-RES-1',
  'Q-DISPLAY-1',
];

/** Assertions no producer observes, and the requirement each belongs to. */
export const UNSUPPORTED_ASSERTIONS: ReadonlyMap<string, string> = new Map([
  ['overviews-do-not-resurrect-replaced-pixels', 'Q-MEMBER-1'],
  ['required-fixture-classes-covered', 'Q-VALUE-1'],
  ['cancellation-issued-while-work-in-flight', 'Q-CANCEL-1'],
  ['concurrent-in-flight-work-measured', 'Q-CANCEL-1'],
  ['teardown-observably-releases-resource', 'Q-TEARDOWN-1'],
  ['disk-write-failure-exercised', 'Q-FAILINJ-1'],
  ['observed-in-desktop-webview', 'Q-HOST-1'],
]);
