import { designSessionStore, type DesignSessionStore } from '../document-session/store'
import { locale } from '../settings/state'
import { effectiveBackgroundOpacity, type MapLayersState } from '../map-layers/state'
import { presentedMapLayers } from '../story-presentation/overrides'
import {
  captureMapBackgroundPresentation,
  type MapBackgroundPresentation,
} from '../../maplibre/map-background'
import type { WorkspaceActivationSnapshot } from './workspace-activation'
import { DEFAULT_NEW_DESIGN_VIEW } from '../../canvas/session-plane'

export interface WorkspaceActivationSnapshotReaderOptions {
  readonly store?: Pick<DesignSessionStore, 'hasCurrentDesign' | 'sessionIdentity'>
  /** Initial map centre; the runtime's session plane origin in production. */
  readonly readInitialCenter?: () => { readonly lat: number; readonly lon: number }
  readonly readMapLayers?: () => MapLayersState
  readonly readLocale?: () => string
}

/** The background band as the map layer store (or a presented story step) and locale describe it. */
export function readWorkspaceBackgroundPresentation(
  options: WorkspaceActivationSnapshotReaderOptions = {},
): MapBackgroundPresentation {
  const layers = (options.readMapLayers ?? presentedMapLayers)()
  // Soften background dims the band itself; the plants above keep their colours.
  return captureMapBackgroundPresentation({
    basemap: { ...layers.basemap, opacity: effectiveBackgroundOpacity(layers, 'basemap') },
    satellite: { ...layers.satellite, opacity: effectiveBackgroundOpacity(layers, 'satellite') },
    locale: (options.readLocale ?? (() => locale.value))(),
  })
}

export function readWorkspaceActivationSnapshot(
  options: WorkspaceActivationSnapshotReaderOptions = {},
): WorkspaceActivationSnapshot | null {
  const store = options.store ?? designSessionStore
  if (!store.hasCurrentDesign()) return null
  const center = options.readInitialCenter?.()
    ?? { lat: DEFAULT_NEW_DESIGN_VIEW.lat, lon: DEFAULT_NEW_DESIGN_VIEW.lon }
  return Object.freeze({
    sessionIdentity: store.sessionIdentity.peek(),
    map: Object.freeze({
      initialCenter: Object.freeze({ lat: center.lat, lon: center.lon }),
      background: readWorkspaceBackgroundPresentation(options),
    }),
  })
}
