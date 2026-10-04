import { signal, type ReadonlySignal } from '@preact/signals'
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

/** Whether a Scene holds any plant, note, measurement guide, or zone with a point. */
function sceneHasObjects(scene: ScenePersistedState): boolean {
  return scene.plants.length > 0
    || scene.annotations.length > 0
    || scene.measurementGuides.length > 0
    || scene.zones.some((zone) => zone.points.length > 0)
}

export class SceneStore {
  private _persisted: ScenePersistedState
  private _session: SceneSessionState
  private _geo: SceneGeoFrame
  private readonly _plane = signal<SessionPlane | null>(null)
  private readonly _resolveEmptyOrigin: () => GeoPosition

  /** `emptyOrigin` places the session plane of a Design without objects. */
  constructor(
    file?: CanopiFile,
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
    this._session = createDefaultSceneSessionState()
    this._plane.value = this._geo.plane
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

  /** sceneHasObjects of the Scene, read without copying it. */
  get hasObjects(): boolean {
    return sceneHasObjects(this._persisted)
  }

  get session(): SceneSessionState {
    return cloneSceneSessionState(this._session)
  }

  hydrate(file: CanopiFile): this {
    const hydrated = hydrateSceneFromDesign(file, this._resolveEmptyOrigin())
    this._persisted = hydrated.persisted
    this._geo = hydrated.geo
    this._session = createDefaultSceneSessionState()
    this._plane.value = this._geo.plane
    return this
  }

  /**
   * Starts a re-origin at `origin`; commitReorigin moves the scene, and the caller re-projects history with the same
   * reprojector.
   */
  beginReorigin(origin: GeoPosition): ScenePlaneReprojector {
    return new ScenePlaneReprojector(this._geo, origin)
  }

  commitReorigin(reprojector: ScenePlaneReprojector): this {
    this._persisted = reprojector.persisted(this._persisted)
    this._geo = reprojector.next
    this._plane.value = this._geo.plane
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

  toCanopiFile(options: SceneSerializeOptions = {}): CanopiFile {
    return serializeScenePersistedState(this._persisted, this._geo, options)
  }
}

export type SceneStateReader = Pick<
  SceneStore,
  'persisted' | 'session' | 'guides' | 'hasObjects' | 'sessionPlane' | 'sessionPlaneSignal'
>
export type SceneDocumentReader = Pick<SceneStore, 'toCanopiFile'>
export type SceneSessionWriter = Pick<
  SceneStore,
  'setSelection' | 'setHoveredTarget'
>
