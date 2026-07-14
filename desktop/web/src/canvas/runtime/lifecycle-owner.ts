export interface CanvasRuntimeLifecycleLease {
  release(): void
}

interface CanvasRuntimeLifecycleOwner {
  readonly releaseRuntime: () => void
  releaseRequested: boolean
  releasing: boolean
}

let currentOwner: CanvasRuntimeLifecycleOwner | null = null

export class CanvasRuntimeLifecycleBusyError extends Error {
  constructor(message = 'Another Canvas runtime lifecycle is still active') {
    super(message)
    this.name = 'CanvasRuntimeLifecycleBusyError'
  }
}

/**
 * Retries a previously requested release before a component creates its next
 * runtime. A failed release remains owned here after the component that
 * requested it has unmounted.
 */
export function ensureCanvasRuntimeLifecycleAvailable(): void {
  if (!currentOwner) return
  if (!currentOwner.releaseRequested) throw new CanvasRuntimeLifecycleBusyError()
  releaseOwner(currentOwner)
}

export function claimCanvasRuntimeLifecycle(
  releaseRuntime: () => void,
): CanvasRuntimeLifecycleLease {
  ensureCanvasRuntimeLifecycleAvailable()
  const owner: CanvasRuntimeLifecycleOwner = {
    releaseRuntime,
    releaseRequested: false,
    releasing: false,
  }
  currentOwner = owner

  return Object.freeze({
    release() {
      if (currentOwner !== owner) return
      owner.releaseRequested = true
      releaseOwner(owner)
    },
  })
}

function releaseOwner(owner: CanvasRuntimeLifecycleOwner): void {
  if (currentOwner !== owner) return
  if (owner.releasing) {
    throw new CanvasRuntimeLifecycleBusyError('Canvas runtime release is still in progress')
  }

  owner.releasing = true
  try {
    owner.releaseRuntime()
    if (currentOwner === owner) currentOwner = null
  } finally {
    owner.releasing = false
  }
}
