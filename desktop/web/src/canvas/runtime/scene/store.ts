import type {
  CanopiFile,
} from '../../../types/design'
import {
  SCENE_LAYER_NAMES,
  type ScenePersistedState,
  type SceneSessionState,
  type SceneViewportState,
} from './types'
import {
  cloneScenePersistedState,
  cloneSceneSessionState,
  hydrateScenePersistedState,
  type SceneSerializeOptions,
  serializeScenePersistedState,
} from './codec'
import {
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
} from './defaults'

export function isSceneLayerName(name: string): name is (typeof SCENE_LAYER_NAMES)[number] {
  return (SCENE_LAYER_NAMES as readonly string[]).includes(name)
}

export function hydrateSceneStore(file: CanopiFile): SceneStore {
  return new SceneStore(file)
}

export function serializeSceneStore(
  store: SceneStore,
  options: SceneSerializeOptions = {},
): CanopiFile {
  return store.toCanopiFile(options)
}

export class SceneStore {
  private _persisted: ScenePersistedState
  private _session: SceneSessionState

  constructor(file?: CanopiFile, sessionOverrides: Partial<SceneSessionState> = {}) {
    this._persisted = file ? hydrateScenePersistedState(file) : createDefaultScenePersistedState()
    this._session = createDefaultSceneSessionState(sessionOverrides)
  }

  static fromCanopi(file: CanopiFile, sessionOverrides: Partial<SceneSessionState> = {}): SceneStore {
    return new SceneStore(file, sessionOverrides)
  }

  get persisted(): ScenePersistedState {
    return cloneScenePersistedState(this._persisted)
  }

  get session(): SceneSessionState {
    return cloneSceneSessionState(this._session)
  }

  hydrate(file: CanopiFile): this {
    this._persisted = hydrateScenePersistedState(file)
    this._session = createDefaultSceneSessionState()
    return this
  }

  resetSession(overrides: Partial<SceneSessionState> = {}): this {
    this._session = createDefaultSceneSessionState(overrides)
    return this
  }

  updatePersisted(mutator: (draft: ScenePersistedState) => void): this {
    const draft = cloneScenePersistedState(this._persisted)
    mutator(draft)
    this._persisted = draft
    return this
  }

  updateSession(mutator: (draft: SceneSessionState) => void): this {
    const draft = cloneSceneSessionState(this._session)
    mutator(draft)
    this._session = draft
    return this
  }

  setSelection(entityIds: Iterable<string>): this {
    this._session = {
      ...this._session,
      selectedEntityIds: new Set(entityIds),
    }
    return this
  }

  setViewport(viewport: Partial<SceneViewportState>): this {
    this._session = {
      ...this._session,
      viewport: {
        ...this._session.viewport,
        ...viewport,
      },
    }
    return this
  }

  setActiveLayerName(name: string | null): this {
    this._session = {
      ...this._session,
      activeLayerName: name,
    }
    return this
  }

  snapshot(): { persisted: ScenePersistedState; session: SceneSessionState } {
    return {
      persisted: this.persisted,
      session: this.session,
    }
  }

  restoreSnapshot(snapshot: { persisted: ScenePersistedState; session: SceneSessionState }): this {
    this._persisted = cloneScenePersistedState(snapshot.persisted)
    this._session = cloneSceneSessionState(snapshot.session)
    return this
  }

  toCanopiFile(options: SceneSerializeOptions = {}): CanopiFile {
    return serializeScenePersistedState(this._persisted, options)
  }
}

export {
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
  serializeScenePersistedState,
}
