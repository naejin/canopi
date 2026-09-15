import { signal } from '@preact/signals'

export type LidarCameraRequest =
  | { readonly revision: number; readonly type: 'coverage'; readonly bounds: [number, number, number, number] }
  | { readonly revision: number; readonly type: 'design-location' }

export const lidarCameraRequest = signal<LidarCameraRequest | null>(null)
export const lidarMapViewBounds = signal<[number, number, number, number] | null>(null)

let revision = 0

export function viewLidarCoverage(bounds: [number, number, number, number]): void {
  lidarCameraRequest.value = { revision: ++revision, type: 'coverage', bounds }
}

export function viewDesignLocation(): void {
  lidarCameraRequest.value = { revision: ++revision, type: 'design-location' }
}

export function publishLidarMapViewBounds(
  bounds: [number, number, number, number] | null,
): void {
  lidarMapViewBounds.value = bounds
}
