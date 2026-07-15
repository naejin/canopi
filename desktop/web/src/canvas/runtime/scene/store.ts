import type {
  CanopiFile,
} from '../../../types/design'
import {
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
    const persisted = hydrateScenePersistedState(file)
    const session = createDefaultSceneSessionState()
    this._persisted = persisted
    this._session = session
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

  setSelection(entityIds: Iterable<string>): this {
    this._session = {
      ...this._session,
      selectedEntityIds: new Set(entityIds),
    }
    return this
  }

  setHoveredEntityId(id: string | null): this {
    this._session = {
      ...this._session,
      hoveredEntityId: id,
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

  toCanopiFile(options: SceneSerializeOptions = {}): CanopiFile {
    return serializeScenePersistedState(this._persisted, options)
  }
}

export type SceneStateReader = Pick<SceneStore, 'persisted' | 'session'>
export type SceneDocumentReader = Pick<SceneStore, 'toCanopiFile'>
export type SceneSessionWriter = Pick<
  SceneStore,
  'setSelection' | 'setViewport' | 'setHoveredEntityId'
>

export {
  createDefaultScenePersistedState,
  createDefaultSceneSessionState,
  serializeScenePersistedState,
}
