// The browser half of GeoLibre's geolocation, the one module that calls the browser's geolocation (canopi-f47t.53; plan
// P53; design check A4 and §4). Adapted from GeoLibre apps/geolibre-desktop/src/lib/geolocation.ts (the
// `navigator.geolocation` branch of `watchPosition`) at commit e9df9e2; the Tauri plugin branch and the one-shot read are
// dropped: Show my location is Web only in 2.0 (U54 Q9) and only ever watches. The permission read follows GeoLibre's
// rule in packages/map/src/map-controller.ts (no Permissions API, or a query that throws, reads as unknown).
// Copyright (c) 2026 Qiusheng Wu. MIT License; see THIRD_PARTY_NOTICES.md.

/** One fix: where the device is, how far off it may be (metres) and when it was taken (ms since the epoch). */
export interface DeviceFix {
  readonly lon: number
  readonly lat: number
  readonly accuracy: number
  readonly timestamp: number
}

/** The browser's error codes: 1 permission denied, 2 position unavailable, 3 timeout. */
export type GeolocationErrorCode = 1 | 2 | 3

/**
 * High accuracy for a phone in the field; a fix older than the request is never reused; a fix that takes longer than
 * this ends as code 3, which marks the dot stale while the watch goes on.
 */
const WATCH_OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 }

/** Show my location is offered only where the browser can answer: a secure context with `navigator.geolocation` (A1). */
export function geolocationSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext === true
    && typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
}

/**
 * Watches the device's position until the returned stop is called: each fix goes to `onFix`, each error's code to
 * `onError` (the watch itself goes on; the caller stops it on a code 1).
 */
export function watchDevicePosition(
  onFix: (fix: DeviceFix) => void,
  onError: (code: GeolocationErrorCode) => void,
): () => void {
  const geolocation = navigator.geolocation
  const id = geolocation.watchPosition(
    (position) => onFix({
      lon: position.coords.longitude,
      lat: position.coords.latitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    }),
    (error) => onError(error.code as GeolocationErrorCode),
    WATCH_OPTIONS,
  )
  return () => geolocation.clearWatch(id)
}

/** The geolocation permission's live status, or null when the browser cannot say (no Permissions API, or it throws). */
export async function queryGeolocationPermission(): Promise<PermissionStatus | null> {
  try {
    return await navigator.permissions?.query({ name: 'geolocation' }) ?? null
  } catch {
    return null
  }
}
