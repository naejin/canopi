import type { BasemapStyle } from '../generated/contracts'
import type { MapLibreBasemapStatus } from './canvas-surface-state'
import { mapErrorResourceId } from './map-error-owner'

/*
 * OpenFreeMap style presets adapted from GeoLibre
 * packages/core/src/types.ts (OPENFREEMAP_BASEMAPS) at commit e9df9e2.
 * Copyright (c) 2026 Qiusheng Wu. MIT License; see THIRD_PARTY_NOTICES.
 */
export const OPENFREEMAP_BASEMAPS: Readonly<Record<BasemapStyle, { readonly name: string; readonly styleUrl: string }>> = {
  liberty: { name: 'Liberty', styleUrl: 'https://tiles.openfreemap.org/styles/liberty' },
  positron: { name: 'Positron', styleUrl: 'https://tiles.openfreemap.org/styles/positron' },
  bright: { name: 'Bright', styleUrl: 'https://tiles.openfreemap.org/styles/bright' },
  dark: { name: 'Dark', styleUrl: 'https://tiles.openfreemap.org/styles/dark' },
}

export const OPENFREEMAP_LAYER_PREFIX = 'ofm:'
export const OPENFREEMAP_SOURCE_PREFIX = 'ofm-'

/** The subset of a MapLibre style this module reads. */
export interface VectorStyleDocument {
  readonly glyphs?: string
  readonly sprite?: string | unknown
  readonly sources: Readonly<Record<string, Readonly<Record<string, unknown>>>>
  readonly layers: readonly VectorStyleLayer[]
}

interface VectorStyleLayer {
  readonly id: string
  readonly type: string
  readonly source?: string
  readonly layout?: Readonly<Record<string, unknown>>
  readonly paint?: Readonly<Record<string, unknown>>
  readonly [key: string]: unknown
}

/** The map operations the installer needs; a real MapLibre map satisfies it. */
export interface VectorBasemapMap {
  getSource(id: string): unknown
  addSource(id: string, source: Record<string, unknown>): void
  removeSource(id: string): void
  getLayer(id: string): unknown
  addLayer(layer: Record<string, unknown>, beforeId?: string): void
  removeLayer(id: string): void
  setPaintProperty(id: string, name: string, value: unknown): void
  setLayoutProperty(id: string, name: string, value: unknown): void
  setGlyphs(url: string | null): void
  setSprite(url: string | null): void
}

export interface VectorBasemapPresentation {
  readonly style: BasemapStyle
  readonly visible: boolean
  readonly opacity: number
  readonly locale: string
}

export interface VectorBasemapOptions {
  /** Fetches a style document; injected so tests and editions stay offline-capable. */
  readonly loadStyle?: (url: string) => Promise<VectorStyleDocument>
  /** The first Canopi layer the basemap must stay beneath. */
  readonly beforeLayerId?: () => string | null
  readonly onError?: (error: unknown) => void
  /**
   * `loading` while the shown style downloads, `failed` when it could not be downloaded, `ok` once a style is
   * installed, `idle` when hidden.
   */
  readonly onStatus?: (status: MapLibreBasemapStatus) => void
}

const OPACITY_PAINT_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  background: ['background-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
  raster: ['raster-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
  heatmap: ['heatmap-opacity'],
}

const styleCache = new Map<string, Promise<VectorStyleDocument>>()

async function fetchStyle(url: string): Promise<VectorStyleDocument> {
  const cached = styleCache.get(url)
  if (cached) return cached
  const request = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`Basemap style request failed (${response.status}).`)
    return await response.json() as VectorStyleDocument
  })
  styleCache.set(url, request)
  request.catch(() => styleCache.delete(url))
  return request
}

interface InstalledLayer {
  readonly id: string
  readonly baseOpacity: Readonly<Record<string, unknown>>
  readonly labelled: boolean
}

interface Installed {
  readonly style: BasemapStyle
  readonly sourceIds: readonly string[]
  readonly layers: readonly InstalledLayer[]
  opacity: number
  locale: string
  /** The requests the map makes for this style's sprite, glyphs and TileJSON, which it reports without a layer id. */
  readonly resources: readonly RegExp[]
}

/**
 * Installs one OpenFreeMap vector style onto a live map without `setStyle()`,
 * so the map lifetime, camera and Design edits are untouched. Sources and
 * layers are namespaced; row opacity scales every layer's paint opacity; labels
 * follow the app locale (`name:<locale>`, falling back to `name`).
 */
export class VectorBasemap {
  private installed: Installed | null = null
  private desired: VectorBasemapPresentation | null = null
  private generation = 0
  /** The style whose download is running, so a repeated request (Retry) joins it instead of starting over. */
  private loading: BasemapStyle | null = null
  private status: MapLibreBasemapStatus = 'idle'
  /** The installed style's sprite, glyphs or TileJSON failed to download: only Retry installs it again. */
  private resourceFailed = false
  /** Every style's resource requests seen by this map, so a late failure from an earlier style is still the basemap's. */
  private readonly knownResources: RegExp[] = []
  /**
   * The installed style's sprite request may still be running: set by `setSprite`, cleared once the map is idle
   * (MapLibre is idle only after the sprite settled). A sprite that fails after its response arrived (HTML from a
   * captive portal, a body cut off, an undecodable image) reaches the map with no URL and no source.
   */
  private spriteInFlight = false
  private disposed = false

  constructor(
    private readonly map: VectorBasemapMap,
    private readonly options: VectorBasemapOptions = {},
  ) {}

  get installedStyle(): BasemapStyle | null {
    return this.installed?.style ?? null
  }

  update(presentation: VectorBasemapPresentation): void {
    if (this.disposed) return
    this.desired = presentation
    if (!presentation.visible) {
      this.generation += 1
      this.loading = null
      this.uninstall()
      this.setStatus('idle')
      return
    }
    const installed = this.installed
    if (installed && installed.style === presentation.style && this.layersPresent(installed)) {
      // The style on screen is the one asked for: a load still running for
      // another style is stale, and an earlier failure no longer applies.
      this.generation += 1
      this.loading = null
      if (installed.opacity !== presentation.opacity) this.applyOpacity(installed, presentation.opacity)
      if (installed.locale !== presentation.locale) this.applyLocale(installed, presentation.locale)
      // Nothing downloads on its own (ADR 0004): a style whose resources failed stays failed until Retry.
      if (!this.resourceFailed) this.setStatus('ok')
      return
    }
    // The settling load reads `desired`, so opacity or locale asked for meanwhile still applies.
    if (this.loading === presentation.style) return
    const generation = ++this.generation
    this.loading = presentation.style
    this.setStatus('loading')
    const load = this.options.loadStyle ?? fetchStyle
    load(OPENFREEMAP_BASEMAPS[presentation.style].styleUrl).then((document) => {
      if (this.disposed || generation !== this.generation) return
      this.loading = null
      const desired = this.desired
      if (!desired?.visible || desired.style !== presentation.style) return
      this.uninstall()
      this.install(desired, document)
      this.setStatus('ok')
    }).catch((error: unknown) => {
      if (this.disposed || generation !== this.generation) return
      this.loading = null
      this.setStatus('failed')
      this.options.onError?.(error)
    })
  }

  /**
   * Claims a map error about this basemap's sprite, glyphs or TileJSON, which MapLibre reports with no layer id (a
   * glyph range only through the tile that needed it). Such a failure leaves the basemap blank or unlabelled, so the
   * installed style is `failed` until Retry; a single tile's failure is not claimed. An error with no URL is claimed
   * only in a sprite's failure shapes while the installed style's sprite downloads (`spriteInFlight`). Returns whether
   * it was claimed.
   */
  claimResourceError(event: unknown): boolean {
    if (this.disposed) return false
    const url = failedRequestUrl(event)
    if (url === null) return this.claimSpriteError(event)
    if (!this.knownResources.some((resource) => resource.test(url))) return false
    const installed = this.installed
    if (installed && installed.resources.some((resource) => resource.test(url))) {
      this.resourceFailed = true
      this.setStatus('failed')
    }
    return true
  }

  /** The map went idle, so the installed style's sprite request has settled: a later URL-less error is not the sprite's. */
  noteMapIdle(): void {
    this.spriteInFlight = false
  }

  /**
   * A URL-less, sprite-shaped error (`isSpriteShapedError`) naming no source or layer, while the installed style's
   * sprite downloads, is that sprite's. Any other URL-less error stays a map failure.
   */
  private claimSpriteError(event: unknown): boolean {
    if (!this.spriteInFlight || !this.installed || mapErrorResourceId(event) !== null) return false
    if (!isSpriteShapedError(event)) return false
    this.spriteInFlight = false
    this.resourceFailed = true
    this.setStatus('failed')
    return true
  }

  /** Retry: a style whose resources failed is removed, so the next update installs it and downloads them again. */
  discardFailedResources(): void {
    if (this.disposed || !this.resourceFailed) return
    this.resourceFailed = false
    this.uninstall()
  }

  /** Reinstalls after a same-map style reload dropped the layers. */
  restore(): void {
    const installed = this.installed
    if (!installed || this.layersPresent(installed)) return
    this.installed = null
    if (this.desired) this.update(this.desired)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.loading = null
    this.uninstall()
  }

  private setStatus(status: MapLibreBasemapStatus): void {
    if (status === this.status) return
    this.status = status
    this.options.onStatus?.(status)
  }

  private layersPresent(installed: Installed): boolean {
    return installed.layers.every((layer) => this.map.getLayer(layer.id))
  }

  private install(presentation: VectorBasemapPresentation, document: VectorStyleDocument): void {
    const prepared = prepareOpenFreeMapStyle(document, presentation)
    const resources = styleResourceRequests(document)
    for (const resource of resources) {
      if (!this.knownResources.some((known) => known.source === resource.source)) this.knownResources.push(resource)
    }
    this.resourceFailed = false
    if (document.glyphs) this.map.setGlyphs(document.glyphs)
    if (typeof document.sprite === 'string') {
      this.map.setSprite(document.sprite)
      this.spriteInFlight = true
    }
    for (const [id, source] of Object.entries(prepared.sources)) this.map.addSource(id, source)
    const beforeId = this.options.beforeLayerId?.() ?? undefined
    for (const layer of prepared.layers) {
      if (beforeId) this.map.addLayer(layer, beforeId)
      else this.map.addLayer(layer)
    }
    this.installed = {
      style: presentation.style,
      sourceIds: Object.keys(prepared.sources),
      layers: prepared.installedLayers,
      opacity: presentation.opacity,
      locale: presentation.locale,
      resources,
    }
  }

  private uninstall(): void {
    const installed = this.installed
    if (!installed) return
    this.installed = null
    this.spriteInFlight = false
    for (const layer of [...installed.layers].reverse()) {
      if (this.map.getLayer(layer.id)) this.map.removeLayer(layer.id)
    }
    for (const id of installed.sourceIds) {
      if (this.map.getSource(id)) this.map.removeSource(id)
    }
  }

  private applyOpacity(installed: Installed, opacity: number): void {
    for (const layer of installed.layers) {
      for (const [property, base] of Object.entries(layer.baseOpacity)) {
        this.map.setPaintProperty(layer.id, property, scaleOpacity(base, opacity))
      }
    }
    installed.opacity = opacity
  }

  private applyLocale(installed: Installed, locale: string): void {
    for (const layer of installed.layers) {
      if (layer.labelled) this.map.setLayoutProperty(layer.id, 'text-field', localizedLabel(locale))
    }
    installed.locale = locale
  }
}

interface PreparedVectorStyle {
  readonly sources: Record<string, Record<string, unknown>>
  readonly layers: Record<string, unknown>[]
  readonly installedLayers: InstalledLayer[]
}

/** Namespaces, localizes and opacity-scales one style document. Pure. */
function prepareOpenFreeMapStyle(
  document: VectorStyleDocument,
  presentation: Pick<VectorBasemapPresentation, 'opacity' | 'locale'>,
): PreparedVectorStyle {
  const sources: Record<string, Record<string, unknown>> = {}
  for (const [id, source] of Object.entries(document.sources)) {
    sources[`${OPENFREEMAP_SOURCE_PREFIX}${id}`] = { ...source }
  }
  const layers: Record<string, unknown>[] = []
  const installedLayers: InstalledLayer[] = []
  for (const layer of document.layers) {
    const id = `${OPENFREEMAP_LAYER_PREFIX}${layer.id}`
    const baseOpacity: Record<string, unknown> = {}
    const paint: Record<string, unknown> = { ...(layer.paint ?? {}) }
    for (const property of OPACITY_PAINT_PROPERTIES[layer.type] ?? []) {
      baseOpacity[property] = layer.paint?.[property]
      paint[property] = scaleOpacity(layer.paint?.[property], presentation.opacity)
    }
    const layout: Record<string, unknown> = { ...(layer.layout ?? {}) }
    const labelled = isNameLabel(layout['text-field'])
    if (labelled) layout['text-field'] = localizedLabel(presentation.locale)
    layers.push({
      ...layer,
      id,
      ...(layer.source ? { source: `${OPENFREEMAP_SOURCE_PREFIX}${layer.source}` } : {}),
      layout,
      paint,
    })
    installedLayers.push({ id, baseOpacity, labelled })
  }
  return { sources, layers, installedLayers }
}

/**
 * The requests MapLibre makes for a style's own resources: the sprite sheet (`<sprite>[@2x].json|png`), the glyph
 * ranges (the glyphs template) and each source's TileJSON. A tile URL never matches.
 */
function styleResourceRequests(document: VectorStyleDocument): RegExp[] {
  const resources: RegExp[] = []
  const sprites = typeof document.sprite === 'string'
    ? [document.sprite]
    : Array.isArray(document.sprite)
      ? document.sprite.flatMap((entry) => typeof entry?.url === 'string' ? [entry.url as string] : [])
      : []
  for (const sprite of sprites) resources.push(new RegExp(`^${escapeRegExp(sprite)}(?:@\\d+(?:\\.\\d+)?x)?\\.(?:json|png)(?:[?#].*)?$`))
  if (document.glyphs) {
    const glyphs = escapeRegExp(document.glyphs)
      .replace(/\\\{fontstack\\\}/g, '[^/]+')
      .replace(/\\\{range\\\}/g, '\\d+-\\d+')
    resources.push(new RegExp(`^${glyphs}(?:[?#].*)?$`))
  }
  for (const source of Object.values(document.sources)) {
    if (typeof source.url === 'string') resources.push(new RegExp(`^${escapeRegExp(source.url)}(?:[?#].*)?$`))
  }
  return resources
}

/** The URL a failed MapLibre request names: an AJAXError's `url`, else the URL its message ends with. */
function failedRequestUrl(event: unknown): string | null {
  const error = typeof event === 'object' && event !== null && 'error' in event ? (event as { error: unknown }).error : event
  if (typeof error !== 'object' || error === null) return null
  const { url, message } = error as { url?: unknown; message?: unknown }
  if (typeof url === 'string' && url.length > 0) return url
  return typeof message === 'string' ? /(https?:\/\/\S+)\s*$/.exec(message)?.[1] ?? null : null
}

/** The body-read failures browsers raise as a `TypeError` when a download is cut off (WebKit, Chromium, Firefox). */
const CUT_OFF_BODY = /^(?:Load failed|network error|Failed to fetch|NetworkError\b|Error in body stream|terminated)/i

/**
 * The shapes a sprite takes when it fails after its response arrived (MapLibre `load_sprite.ts`): its JSON is not JSON
 * (`SyntaxError`, a captive portal's HTML), its body was cut off (a network `TypeError`), its image is empty or not an
 * image (MapLibre's "Could not load (sprite) image"), or the browser could not decode it (a `DOMException`).
 */
function isSpriteShapedError(event: unknown): boolean {
  const error = typeof event === 'object' && event !== null && 'error' in event ? (event as { error: unknown }).error : event
  if (typeof error !== 'object' || error === null) return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  const text = typeof message === 'string' ? message : ''
  if (name === 'SyntaxError') return true
  if (name === 'InvalidStateError' || name === 'EncodingError') return true
  if (name === 'TypeError') return CUT_OFF_BODY.test(text)
  return /^Could not load (?:sprite )?image\b/.test(text)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function localizedLabel(locale: string): unknown[] {
  return ['coalesce', ['get', `name:${locale}`], ['get', 'name']]
}

function isNameLabel(textField: unknown): boolean {
  return textField !== undefined && JSON.stringify(textField).includes('"name')
}

/**
 * Multiplies an opacity paint value by `factor`. Zoom curves keep their
 * top-level interpolate/step shape (MapLibre requires it), so only their
 * outputs are scaled.
 */
export function scaleOpacity(value: unknown, factor: number): unknown {
  if (value === undefined || value === null) return factor
  if (typeof value === 'number') return value * factor
  if (Array.isArray(value)) {
    const operator = value[0]
    if (operator === 'interpolate' || operator === 'interpolate-hcl' || operator === 'interpolate-lab') {
      return value.map((entry, index) => index >= 4 && (index - 4) % 2 === 0 ? scaleOpacity(entry, factor) : entry)
    }
    if (operator === 'step') {
      return value.map((entry, index) => index >= 2 && index % 2 === 0 ? scaleOpacity(entry, factor) : entry)
    }
    return ['*', value, factor]
  }
  if (typeof value === 'object' && Array.isArray((value as { stops?: unknown }).stops)) {
    const legacy = value as { stops: [unknown, unknown][] }
    return { ...legacy, stops: legacy.stops.map(([zoom, stop]) => [zoom, scaleOpacity(stop, factor)]) }
  }
  return value
}
