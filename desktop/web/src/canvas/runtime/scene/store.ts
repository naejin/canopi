import { signal, type ReadonlySignal } from '@preact/signals'
import { computeScenePhysicalExtentMeters } from '../scene-physical-extent'
import type {
  CanopiFile,
} from '../../../types/design'
import {
  type ScenePersistedState,
  type SceneSessionState,
} from './types'
import {
  cloneScenePersistedState,
  cloneSceneSessionState,
  hydrateSceneFromDesign,
  type SceneSerializeOptions,
  serializeScenePersistedState,
} from './codec'
import { createSceneGeoFrame, ScenePlaneReprojector, type SceneGeoFrame } from './geo-frame'
import { DEFAULT_NEW_DESIGN_VIEW, type GeoPosition, type SessionPlane } from '../../session-plane'
import {
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
} from './defaults'
import {
  cloneSceneDesignObjectTarget,
  normalizeSceneDesignObjectTargets,
  type SceneDesignObjectTarget,
} from './design-object-targets'

export class SceneStore {
  private _persisted: ScenePersistedState
  private _session: SceneSessionState
  private _geo: SceneGeoFrame
  private readonly _plane = signal<SessionPlane | null>(null)
  private readonly _resolveEmptyOrigin: () => GeoPosition

  /** `emptyOrigin` places the session plane of a Design without objects. */
  constructor(
    file?: CanopiFile,
    sessionOverrides: Partial<SceneSessionState> = {},
    emptyOrigin: GeoPosition | (() => GeoPosition) = DEFAULT_NEW_DESIGN_VIEW,
  ) {
    this._resolveEmptyOrigin = typeof emptyOrigin === 'function' ? emptyOrigin : () => emptyOrigin
    if (file) {
      const hydrated = hydrateSceneFromDesign(file, this._resolveEmptyOrigin())
      this._persisted = hydrated.persisted
      this._geo = hydrated.geo
    } else {
      this._persisted = createDefaultScenePersistedState()
      this._geo = createSceneGeoFrame(this._resolveEmptyOrigin())
    }
    this._session = createDefaultSceneSessionState(sessionOverrides)
    this._plane.value = this._geo.plane
  }

  static fromCanopi(file: CanopiFile, sessionOverrides: Partial<SceneSessionState> = {}): SceneStore {
    return new SceneStore(file, sessionOverrides)
  }

  get persisted(): ScenePersistedState {
    return cloneScenePersistedState(this._persisted)
  }

  get guides(): ScenePersistedState['guides'] {
    return this._persisted.guides.map((guide) => ({ ...guide }))
  }

  // The runtime's metre frame for this Design; replaced on hydrate and re-origin.
  get sessionPlane(): SessionPlane {
    return this._geo.plane
  }

  // Published on hydrate and re-origin for map and LiDAR consumers.
  get sessionPlaneSignal(): ReadonlySignal<SessionPlane | null> {
    return this._plane
  }

  // The plane plus the ledger of loaded lon/lat that serialization needs.
  get geoFrame(): SceneGeoFrame {
    return this._geo
  }

  get physicalExtentMeters(): number | null {
    return computeScenePhysicalExtentMeters(this._persisted)
  }

  get session(): SceneSessionState {
    return cloneSceneSessionState(this._session)
  }

  hydrate(file: CanopiFile, emptyOrigin: GeoPosition = this._resolveEmptyOrigin()): this {
    const hydrated = hydrateSceneFromDesign(file, emptyOrigin)
    this._persisted = hydrated.persisted
    this._geo = hydrated.geo
    this._session = createDefaultSceneSessionState()
    this._plane.value = this._geo.plane
    return this
  }

  // Rebuilds the session plane at `origin`. The returned reprojector has
  // already moved the persisted scene; callers apply it to every other metre
  // holder (history, clipboard, camera) before publishing.
  beginReorigin(origin: GeoPosition): ScenePlaneReprojector {
    return new ScenePlaneReprojector(this._geo, origin)
  }

  commitReorigin(reprojector: ScenePlaneReprojector): this {
    this._persisted = reprojector.persisted(this._persisted)
    this._geo = reprojector.next
    this._plane.value = this._geo.plane
    return this
  }

  resetSession(overrides: Partial<SceneSessionState> = {}): this {
    this._session = createDefaultSceneSessionState(overrides)
    return this
  }

  updatePersisted(mutator: (draft: ScenePersistedState) => void): this {
    const draft = cloneScenePersistedState(this._persisted)
    mutator(draft)
    this._persisted = cloneScenePersistedState(draft)
    return this
  }

  updateSession(mutator: (draft: SceneSessionState) => void): this {
    const draft = cloneSceneSessionState(this._session)
    mutator(draft)
    this._session = cloneSceneSessionState(draft)
    return this
  }

  setSelection(targets: Iterable<SceneDesignObjectTarget>): this {
    this._session = {
      ...this._session,
      selectedTargets: normalizeSceneDesignObjectTargets(targets),
    }
    return this
  }

  setHoveredTarget(target: SceneDesignObjectTarget | null): this {
    this._session = {
      ...this._session,
      hoveredTarget: target ? cloneSceneDesignObjectTarget(target) : null,
    }
    return this
  }

  snapshot(): { persisted: ScenePersistedState; session: SceneSessionState } {
    return {
      persisted: this.persisted,
      session: this.session,
    }
  }

  toCanopiFile(options: SceneSerializeOptions = {}): CanopiFile {
    return serializeScenePersistedState(this._persisted, this._geo, options)
  }
}

export type SceneStateReader = Pick<
  SceneStore,
  'persisted' | 'session' | 'guides' | 'physicalExtentMeters' | 'sessionPlane' | 'sessionPlaneSignal'
>
export type SceneDocumentReader = Pick<SceneStore, 'toCanopiFile'>
export type SceneSessionWriter = Pick<
  SceneStore,
  'setSelection' | 'setHoveredTarget'
>

export {
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
  serializeScenePersistedState,
}
