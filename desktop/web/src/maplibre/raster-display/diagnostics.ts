/**
 * Opt-in raster display timeline for measurement and troubleshooting.
 *
 * Disabled unless `localStorage['canopi.rasterDiagnostics'] === '1'` when the
 * module loads. Events stay in memory on `window.__CANOPI_RASTER_DIAGNOSTICS__`,
 * bounded, and never enter a Design, a log file or a Problem Report.
 */
export interface RasterDiagnosticEvent {
  readonly t: number
  readonly kind: string
  readonly id?: string
  readonly detail?: string
  readonly ms?: number
}

const MAX_EVENTS = 4000

function readEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem('canopi.rasterDiagnostics') === '1'
  } catch {
    return false
  }
}

const enabled = readEnabled()
const events: RasterDiagnosticEvent[] = []

if (enabled) {
  (globalThis as { __CANOPI_RASTER_DIAGNOSTICS__?: unknown }).__CANOPI_RASTER_DIAGNOSTICS__ = { events }
}

export function recordRaster(event: Omit<RasterDiagnosticEvent, 't'>): void {
  if (!enabled) return
  events.push({ t: performance.now(), ...event })
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS)
}
