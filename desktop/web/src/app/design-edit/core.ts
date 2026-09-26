import type { CanopiFile } from '../../types/design'
import { designSessionStore } from '../document-session/store'
import {
  designEditAuthorityCapability,
  disposeDesignEditAuthority,
} from './authority-capability'

export function editCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
): CanopiFile | null {
  return designEditAuthorityCapability(designSessionStore).editCommitted(updater)
}

export function reconcileCurrentDesign(
  updater: (design: CanopiFile) => CanopiFile,
): CanopiFile | null {
  return designEditAuthorityCapability(designSessionStore).reconcileCommitted(updater)
}

export function setDesignName(name: string): void {
  const nextName = name.trim()
  if (nextName.length === 0) return
  if (nextName === designSessionStore.readDesignName()) return

  designSessionStore.renameCurrentDesign(nextName)
}

export function editDesignArray<K extends keyof CanopiFile>(
  key: K,
  updater: (arr: CanopiFile[K]) => CanopiFile[K],
): void {
  editCurrentDesign((design) => {
    const next = updater(design[key])
    return next === design[key] ? design : { ...design, [key]: next }
  })
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeDesignEditAuthority(designSessionStore)
  })
}
