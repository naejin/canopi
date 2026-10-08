// app/lidar/sampler.ts
//
// The one way the frontend samples site data (canopi-f47t.42, spec §1.10; architecture review finding 3; stream C builds
// it): row values (lane 'values', from site-values.ts) and the profile (lane 'profile', from profile.ts) both ask here, and
// nothing else calls `lidarSamplePoints`. Its rules:
// - one invoke in flight per lane; the backend serialises sampling across lanes (one permit before its Local slot);
// - a request's targets are split, in list order, into batches of LIDAR_SAMPLE_MAX_TARGETS, each with every point
//   (at most LIDAR_SAMPLE_MAX_POINTS), sent one after another;
// - a newer key replaces the lane's queued key, but never cuts short the running key's remaining batches, so a row past
//   the first batch gets its value while the pointer moves;
// - an answer is published only while the Design session it was asked for is open, and each target names the generation
//   it expects, so a moved head answers Unavailable rather than newer data.
// Commit 0's stub with the final signature.

import type { LidarSamplePointsRequest, LidarSampleSeries, LidarSampleTarget } from '../../generated/contracts'

export type SampleLane = 'values' | 'profile'

export interface SiteSampler {
  /**
   * Samples `targets` at `points` ([lon, lat]) under `key`. `onBatch` receives each batch's series with the index of its
   * first target. Resolves 'done' once every batch landed, or 'superseded' when a newer key replaced this one in its
   * lane before it ran, or the Design session changed.
   */
  request(
    lane: SampleLane,
    key: string,
    targets: readonly LidarSampleTarget[],
    points: readonly (readonly [number, number])[],
    onBatch: (firstTarget: number, series: readonly LidarSampleSeries[]) => void,
  ): Promise<'done' | 'superseded'>
}

export function createSiteSampler(deps: {
  sample(request: LidarSamplePointsRequest): Promise<LidarSampleSeries[]>
  /** The open Design session's identity: an answer for another session is never published. */
  designIdentity(): object
}): SiteSampler {
  void deps
  return {
    request: () => Promise.reject(new Error('The Site data sampler is not built yet (canopi-f47t.42, stream C)')),
  }
}
