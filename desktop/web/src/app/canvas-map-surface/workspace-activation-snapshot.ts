import { readCanvasMapLayerPresentation } from '../canvas-layer-presentation/presentation'
import { designSessionStore, type DesignSessionStore } from '../document-session/store'
import { basemapStyle } from '../settings/state'
import type { BasemapStyle } from '../../generated/contracts'
import {
  captureWorkspaceBasemapPresentation,
  type WorkspaceBasemapPresentation,
} from '../../maplibre/workspace-map'
import type { WorkspaceActivationSnapshot } from './workspace-activation'
import { DEFAULT_NEW_DESIGN_VIEW } from '../../canvas/session-plane'

export interface WorkspaceActivationSnapshotReaderOptions {
  readonly store?: Pick<DesignSessionStore, 'hasCurrentDesign' | 'sessionIdentity'>
  /** Initial map centre; the runtime's session plane origin in production. */
  readonly readInitialCenter?: () => { readonly lat: number; readonly lon: number }
  readonly readBasemapStyle?: () => BasemapStyle
  readonly readMapLayerPresentation?: () => {
    readonly layerVisibility: Readonly<Record<string, boolean>>
    readonly layerOpacity: Readonly<Record<string, number>>
  }
}

/** Reads the Design session identity and app settings projections. */
export function readWorkspaceBasemapPresentation(
  options: WorkspaceActivationSnapshotReaderOptions = {},
): WorkspaceBasemapPresentation {
  const readPresentation = options.readMapLayerPresentation ?? readCanvasMapLayerPresentation
  return captureWorkspaceBasemapPresentation({
    basemapStyle: (options.readBasemapStyle ?? (() => basemapStyle.value))(),
    basemapVisible: readPresentation().layerVisibility.base ?? true,
    basemapOpacity: readPresentation().layerOpacity.base ?? 1,
  })
}

export function readWorkspaceActivationSnapshot(
  options: WorkspaceActivationSnapshotReaderOptions = {},
): WorkspaceActivationSnapshot | null {
  const store = options.store ?? designSessionStore
  if (!store.hasCurrentDesign()) return null
  const presentation = readWorkspaceBasemapPresentation(options)
  const center = options.readInitialCenter?.()
    ?? { lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon }
  return Object.freeze({
    sessionIdentity: store.sessionIdentity.peek(),
    map: Object.freeze({
      initialCenter: Object.freeze({ lat: center.lat, lon: center.lon }),
      ...presentation,
    }),
    maximumWorldExtentMeters: undefined,
  })
}
