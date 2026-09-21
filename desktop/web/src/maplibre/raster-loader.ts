import { invoke } from '@tauri-apps/api/core'
import { NATIVE_RASTER_SCHEME, parseNativeTileUrl } from '../app/lidar/tile-urls'
import type { MapLibreApi, MapLibreRequestParameters } from './loader'

/**
 * Desktop raster protocol adapter.
 *
 * MapLibre asks this handler for every `canopi-raster://` tile; the handler
 * forwards the parsed request to the library's bounded tile command and hands
 * back the encoded PNG bytes. Nothing but identifiers, a style name and
 * integer tile coordinates leaves the webview.
 *
 * MapLibre has no protocol removal API, so installation is idempotent per
 * loaded module and teardown is per request: when a map is disposed or a
 * viewport moves on, MapLibre aborts the request and the handler both signals
 * the native side and discards the answer.
 */

/** Fetch one tile: resolves to PNG bytes, or rejects when it cannot be drawn. */
export type RasterTileFetcher = (
  request: NonNullable<ReturnType<typeof parseNativeTileUrl>>,
  signal: AbortSignal,
) => Promise<ArrayBuffer>

let installed = false

/** Install the protocol once per loaded MapLibre module. */
export function installRasterProtocol(
  maplibre: Pick<MapLibreApi, 'addProtocol'>,
  fetchTile: RasterTileFetcher = invokeRasterTile,
): void {
  if (installed) {
    return
  }
  maplibre.addProtocol(RASTER_PROTOCOL_SCHEME, async (parameters, abortController) => {
    const request = parseNativeTileUrl(parameters.url)
    if (!request) {
      throw new Error(`Unsupported raster tile URL: ${parameters.url}`)
    }
    const data = await fetchTile(request, abortController.signal)
    return { data }
  })
  installed = true
}

/** Reset the idempotence guard; tests install their own fetcher. */
export function resetRasterProtocolForTests(): void {
  installed = false
}

const RASTER_PROTOCOL_SCHEME = NATIVE_RASTER_SCHEME

/**
 * Ask the library for one tile.
 *
 * The request is identified locally so an aborted request can be cancelled
 * natively; a result that arrives after the abort is discarded rather than
 * drawn.
 */
export async function invokeRasterTile(
  request: NonNullable<ReturnType<typeof parseNativeTileUrl>>,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const requestId = nextRasterRequestId()
  const abort = () => {
    void invoke('lidar_cancel_raster_tile', { requestId }).catch(() => {
      // A cancellation that cannot be delivered is not a user-visible error:
      // the request is already being discarded on this side.
    })
  }
  if (signal.aborted) {
    abort()
    throw abortError()
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const data = await invoke<ArrayBuffer>('lidar_raster_tile', {
      requestId,
      entityKind: request.entityKind,
      entityId: request.entityId,
      generationId: request.generationId,
      style: request.style,
      z: request.z,
      x: request.x,
      y: request.y,
    })
    if (signal.aborted) {
      throw abortError()
    }
    return data
  } finally {
    signal.removeEventListener('abort', abort)
  }
}

let requestCounter = 0

function nextRasterRequestId(): string {
  requestCounter += 1
  return `tile-${Date.now().toString(36)}-${requestCounter.toString(36)}`
}

function abortError(): Error {
  const error = new Error('Raster tile request aborted')
  error.name = 'AbortError'
  return error
}

export type { MapLibreRequestParameters }
