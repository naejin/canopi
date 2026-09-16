import { readCanvasMapLayerPresentation } from '../canvas-layer-presentation/presentation'
import { designSessionStore, type DesignSessionStore } from '../document-session/store'
import { basemapStyle } from '../settings/state'
import type { BasemapStyle } from '../../generated/contracts'
import {
  captureWorkspaceBasemapPresentation,
  type WorkspaceBasemapPresentation,
} from '../../maplibre/workspace-map'
import type { WorkspaceActivationSnapshot } from './workspace-activation'

export interface WorkspaceActivationSnapshotReaderOptions {
  readonly store?: Pick<DesignSessionStore,
    'hasCurrentDesign' | 'readMetadata' | 'sessionIdentity'>
  readonly readBasemapStyle?: () => BasemapStyle
  readonly readMapLayerPresentation?: () => {
    readonly layerVisibility: Readonly<Record<string, boolean>>
    readonly layerOpacity: Readonly<Record<string, number>>
  }
}

/** Reads only Design-session spatial authority and app settings projections. */
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
  const spatialFrame = store.readMetadata().spatialFrame
  if (!spatialFrame) throw new Error('Current Design is missing its required spatial frame.')
  const presentation = readWorkspaceBasemapPresentation(options)
  return Object.freeze({
    sessionIdentity: store.sessionIdentity.peek(),
    map: Object.freeze({
      anchor: Object.freeze({
        lat: spatialFrame.anchor_latitude_deg,
        lon: spatialFrame.anchor_longitude_deg,
      }),
      northBearingDeg: spatialFrame.north_bearing_deg,
      placementStatus: spatialFrame.placement_status,
      ...presentation,
    }),
    maximumWorldExtentMeters: undefined,
  })
}
