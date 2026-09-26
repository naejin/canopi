import type { BasemapStyle } from '../generated/contracts'

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

export interface VectorStyleLayer {
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
      this.uninstall()
      return
    }
    const installed = this.installed
    if (installed && installed.style === presentation.style && this.layersPresent(installed)) {
      if (installed.opacity !== presentation.opacity) this.applyOpacity(installed, presentation.opacity)
      if (installed.locale !== presentation.locale) this.applyLocale(installed, presentation.locale)
      return
    }
    const generation = ++this.generation
    const load = this.options.loadStyle ?? fetchStyle
    load(OPENFREEMAP_BASEMAPS[presentation.style].styleUrl).then((document) => {
      if (this.disposed || generation !== this.generation) return
      const desired = this.desired
      if (!desired?.visible || desired.style !== presentation.style) return
      this.uninstall()
      this.install(desired, document)
    }).catch((error: unknown) => {
      if (this.disposed || generation !== this.generation) return
      this.options.onError?.(error)
    })
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
    this.uninstall()
  }

  private layersPresent(installed: Installed): boolean {
    return installed.layers.every((layer) => this.map.getLayer(layer.id))
  }

  private install(presentation: VectorBasemapPresentation, document: VectorStyleDocument): void {
    const prepared = prepareOpenFreeMapStyle(document, presentation)
    if (document.glyphs) this.map.setGlyphs(document.glyphs)
    if (typeof document.sprite === 'string') this.map.setSprite(document.sprite)
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
    }
  }

  private uninstall(): void {
    const installed = this.installed
    if (!installed) return
    this.installed = null
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

export interface PreparedVectorStyle {
  readonly sources: Record<string, Record<string, unknown>>
  readonly layers: Record<string, unknown>[]
  readonly installedLayers: InstalledLayer[]
}

/** Namespaces, localizes and opacity-scales one style document. Pure. */
export function prepareOpenFreeMapStyle(
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

export function localizedLabel(locale: string): unknown[] {
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
