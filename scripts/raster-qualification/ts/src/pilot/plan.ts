/**
 * The fixed pilot plan: what this instrument requests, and how it prepares the input.
 *
 * These are declarations, not observations. They live here so the launcher, the
 * fixture preparation and the host run spec all describe the same run, and so a change
 * to the plan is a visible change to one file rather than a coincidence between three.
 */

import { PILOT_NODATA } from './producer.js';
import type { DeclaredRefusal, DeclaredWindow } from './producer.js';

/** The five level-zero windows the pilot requests. */
export const PILOT_WINDOWS: readonly DeclaredWindow[] = [
  { id: 'origin', x: 0, y: 0, w: 128, h: 128 },
  { id: 'mid', x: 480, y: 480, w: 128, h: 128 },
  { id: 'hole', x: 1000, y: 1000, w: 128, h: 128 },
  { id: 'far', x: 1920, y: 1920, w: 128, h: 128 },
  { id: 'lower-left', x: 0, y: 1800, w: 128, h: 128 },
];

/**
 * The refused-read controls, declared here and issued over the same native read path.
 *
 * The whole-artifact request is refused by the read cap before it is read, which is
 * why its expected code is the cap rather than the whole-artifact rule.
 */
export function pilotRefusals(fixtureBytes: number): readonly DeclaredRefusal[] {
  return [
    { id: 'whole-artifact', requestId: 'r0', offset: 0, length: fixtureBytes, expected: 'too-large' },
    { id: 'zero-length', requestId: 'r1', offset: 0, length: 0, expected: 'zero-length' },
    { id: 'past-end', requestId: 'r2', offset: fixtureBytes, length: 1, expected: 'out-of-range' },
    { id: 'unknown-handle', requestId: 'r3', handle: 4_294_967_295, offset: 0, length: 16, expected: 'unknown-handle' },
  ];
}

/** The generated fixture's specification. */
export const PILOT_FIXTURE = {
  /** The plane's side length in cells. */
  size: 2048,
  /** The single band's nodata sentinel. */
  nodata: PILOT_NODATA,
  /** The plane's CRS. */
  epsg: 2154,
  /** The tiled COG block size. */
  blockSize: 512,
  /** The band's data type. */
  dataType: 'Float32',
  /** The file name the prepared COG is admitted under. */
  fileName: 'plane-cog.tif',
} as const;

/** The launcher's declared fixture set, for the evaluator's fixture manifest. */
export function fixtureManifestDocument(fixture: {
  readonly name: string;
  readonly sha256: string;
}): Record<string, unknown> {
  return {
    declared: [{ name: fixture.name, sha256: fixture.sha256 }],
    requiredFixtures: { q2: [fixture.name] },
  };
}

/** The run spec the host is launched with. It is launcher input, never renderer input. */
export function runSpecDocument(options: {
  readonly runId: string;
  readonly runDirectory: string;
  readonly fixture: { readonly name: string; readonly sha256: string };
  readonly fixturePath: string;
  readonly assetBase: string;
  readonly wasmUrl: string;
  readonly headerBytes: number;
  readonly deadlineMs: number;
  readonly bundledAssets: readonly { readonly path: string; readonly sha256: string; readonly bytes: number }[];
  readonly fixtureBytes: number;
}): Record<string, unknown> {
  return {
    run: options.runId,
    run_directory: options.runDirectory,
    fixtures: [{ id: 'plane', path: options.fixturePath, sha256: options.fixture.sha256 }],
    asset_base: options.assetBase,
    wasm_url: options.wasmUrl,
    header_bytes: options.headerBytes,
    deadline_ms: options.deadlineMs,
    windows: PILOT_WINDOWS.map((window) => ({ ...window })),
    refusals: pilotRefusals(options.fixtureBytes).map(({ id, offset, length, expected, handle }) => ({
      id,
      offset,
      length,
      expected,
      ...(handle === undefined ? {} : { handle }),
    })),
    bundled_assets: options.bundledAssets.map((asset) => ({ ...asset })),
  };
}
