import { signal } from '@preact/signals'

// Camera/view mirrors only. CameraController owns writes when the viewport changes.
export const zoomLevel = signal<number>(1)

/** The stage scale that represents 100% zoom (set on init to fit ~100m in viewport). */
export const zoomReference = signal<number>(1)
