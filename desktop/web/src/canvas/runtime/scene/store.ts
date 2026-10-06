import { signal, type ReadonlySignal, type Signal } from '@preact/signals'
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
import { ScenePlaneReprojector } from './geo-frame'
import { createSessionPlane, DEFAULT_NEW_DESIGN_VIEW, type GeoPosition, type SessionPlane } from '../../session-plane'
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
  private readonly _plane: Signal<SessionPlane>
  private readonly _resolveEmptyOrigin: () => GeoPosition

  /** `emptyOrigin` places the session plane of a Design without objects; a Design loads through hydrate. */
  constructor(emptyOrigin: () => GeoPosition = () => DEFAULT_NEW_DESIGN_VIEW) {
    this._resolveEmptyOrigin = emptyOrigin
    this._persisted = createDefaultScenePersistedState()
    this._plane = signal(createSessionPlane(this._resolveEmptyOrigin()))
    this._session = createDefaultSceneSessionState()
  }

  get persisted(): ScenePersistedState {
    return cloneScenePersistedState(this._persisted)
  }

  // The runtime's metre frame for this Design, which serialization and re-origin use; replaced on hydrate and re-origin.
  get sessionPlane(): SessionPlane {
    return this._plane.peek()
  }

  // Published on hydrate and re-origin for map and LiDAR consumers.
  get sessionPlaneSignal(): ReadonlySignal<SessionPlane | null> {
    return this._plane
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
    this._session = createDefaultSceneSessionState()
    this._plane.value = hydrated.plane
    return this
  }

  /**
   * Starts a re-origin at `origin`; commitReorigin moves the scene, and the caller re-projects history with the same
   * reprojector.
   */
  beginReorigin(origin: GeoPosition): ScenePlaneReprojector {
    return new ScenePlaneReprojector(this.sessionPlane, origin)
  }

  commitReorigin(reprojector: ScenePlaneReprojector): this {
    this._persisted = reprojector.persisted(this._persisted)
    this._plane.value = reprojector.next
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
    return serializeScenePersistedState(this._persisted, this.sessionPlane, options)
  }
}

export type SceneStateReader = Pick<
  SceneStore,
  'persisted' | 'session' | 'hasObjects' | 'sessionPlane' | 'sessionPlaneSignal'
>
export type SceneDocumentReader = Pick<SceneStore, 'toCanopiFile'>
export type SceneSessionWriter = Pick<
  SceneStore,
  'setSelection' | 'setHoveredTarget'
>
