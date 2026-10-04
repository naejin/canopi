/** Messages between the raster display pool and its worker lanes. */

/** Render parameters understood by `cog-tiler-wasm` (opacity stays a map paint). */
export interface RasterRenderOptions {
  readonly bidx?: number[]
  readonly rescale?: [number, number][] | [number, number]
  readonly colormap?: string
  readonly reversed?: boolean
  readonly nodata?: number
  readonly stretch?: 'linear' | 'sqrt' | 'log'
  readonly gamma?: number
}

export interface RasterSourceMetadata {
  readonly boundsLonLat: number[]
  readonly levels: readonly { width: number; height: number }[]
  readonly mode: '3857' | 'warp'
  readonly crsLabel: string
  readonly hasPalette: boolean
}

export type RasterWorkerRequest =
  | { readonly id: number; readonly op: 'init'; readonly budgetBytes: number }
  | { readonly id: number; readonly op: 'open'; readonly handle: number; readonly url: string }
  | {
    readonly id: number
    readonly op: 'render'
    readonly handle: number
    readonly z: number
    readonly x: number
    readonly y: number
    readonly render: RasterRenderOptions
    readonly encoding: 'png' | 'rgba'
  }
  | {
    readonly id: number
    readonly op: 'bbox'
    readonly handle: number
    readonly bbox: [number, number, number, number]
    readonly width: number
    readonly height: number
    readonly render: RasterRenderOptions
  }
  | { readonly id: number; readonly op: 'encode'; readonly rgba: Uint8ClampedArray; readonly width: number; readonly height: number }
  | { readonly id: number; readonly op: 'close'; readonly handle: number }
  | { readonly id: number; readonly op: 'usage' }

export type RasterWorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string }

export interface RasterLaneUsage {
  readonly cacheBytes: number
  readonly cacheBlocks: number
  readonly openSources: number
}
