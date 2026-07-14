import type { CanopiFile } from '../../types/design'

export interface DesignSessionPersistenceCapture {
  readonly file: CanopiFile
  readonly path: string | null
  readonly name: string
  isCurrent(): boolean
  isExactCurrent(): boolean
  acknowledgeSaved(options?: {
    readonly canvasAcknowledged?: boolean
    readonly canvasDetached?: boolean
  }): 'applied' | 'stale'
  updatePath(path: string): boolean
  setAutosaveFailed(failed: boolean): boolean
}

const persistenceCaptures = new WeakMap<
  object,
  () => DesignSessionPersistenceCapture
>()

export function registerDesignSessionPersistenceCapability(
  store: object,
  capture: () => DesignSessionPersistenceCapture,
): void {
  persistenceCaptures.set(store, capture)
}

export function captureDesignSessionPersistenceState(
  store: object,
): DesignSessionPersistenceCapture {
  const capture = persistenceCaptures.get(store)
  if (!capture) throw new Error('Design Session store has no persistence capability')
  return capture()
}
