import type { CanopiFile } from '../../types/design'

declare const preparedDesignWriteDestination: unique symbol
declare const preparedSynchronousDesignWriteDestination: unique symbol

export interface PreparedDesignWriteDestination {
  readonly [preparedDesignWriteDestination]: true
}

export interface PreparedSynchronousDesignWriteDestination {
  readonly [preparedSynchronousDesignWriteDestination]: true
}

export interface PrepareDesignWriteDestinationOptions {
  readonly resource: string
  readonly destinationPath?: string | null
  readonly blocksReplacement?: boolean
  readonly write: (content: CanopiFile) => void | Promise<void>
}

export interface PrepareSynchronousDesignWriteDestinationOptions {
  readonly resource: string
  readonly write: (content: CanopiFile) => undefined
}

interface PreparedDesignWriteDestinationState {
  readonly resource: string
  readonly destinationPath: string | null
  readonly blocksReplacement: boolean
  readonly write: (content: CanopiFile) => void | Promise<void>
}

export interface DesignWriteAdmission {
  dispose(): void
  destinationPath(destination: PreparedDesignWriteDestination): string | null
  executeImmediately<T>(
    destination: PreparedSynchronousDesignWriteDestination,
    content: CanopiFile,
    isCurrent: () => boolean,
    settle: () => T,
  ): DesignWriteAdmissionResult<T>
  execute<T>(
    destination: PreparedDesignWriteDestination,
    content: CanopiFile,
    isCurrent: () => boolean,
    settle: () => T | Promise<T>,
  ): Promise<DesignWriteAdmissionResult<T>>
  withReplacementFence<T>(replace: () => Promise<T>): Promise<T>
}

export type DesignWriteAdmissionResult<T> =
  | { readonly status: 'written'; readonly value: T }
  | { readonly status: 'stale' }

interface ReplacementGate {
  readonly promise: Promise<void>
  readonly open: () => void
  readonly drain: Promise<void> | null
  fenceCount: number
}

const destinationStates = new WeakMap<object, PreparedDesignWriteDestinationState>()
const synchronousDestinationStates = new WeakMap<
  object,
  PreparedDesignWriteDestinationState
>()

export function prepareDesignWriteDestination(
  options: PrepareDesignWriteDestinationOptions,
): PreparedDesignWriteDestination {
  const destination = Object.freeze({}) as PreparedDesignWriteDestination
  destinationStates.set(destination, {
    resource: options.resource,
    destinationPath: options.destinationPath ?? null,
    blocksReplacement: options.blocksReplacement ?? true,
    write: options.write,
  })
  return destination
}

export function prepareSynchronousDesignWriteDestination(
  options: PrepareSynchronousDesignWriteDestinationOptions,
): PreparedSynchronousDesignWriteDestination {
  const destination = Object.freeze({}) as PreparedSynchronousDesignWriteDestination
  synchronousDestinationStates.set(destination, {
    resource: options.resource,
    destinationPath: null,
    blocksReplacement: true,
    write: options.write,
  })
  return destination
}

export function createDesignWriteAdmission(): DesignWriteAdmission {
  const lanes = new Map<string, Promise<void>>()
  const blockingWrites = new Set<Promise<unknown>>()
  let replacementGate: ReplacementGate | null = null

  function enqueue<T>(
    prepared: PreparedDesignWriteDestinationState,
    content: CanopiFile,
    isCurrent: () => boolean,
    settle: () => T | Promise<T>,
    gate: Promise<void> | null,
  ): Promise<DesignWriteAdmissionResult<T>> {
    const predecessor = lanes.get(prepared.resource)
    const write = async (): Promise<DesignWriteAdmissionResult<T>> => {
      if (gate) await gate
      if (!isCurrent()) return { status: 'stale' }
      await prepared.write(content)
      return { status: 'written', value: await settle() }
    }
    let resolveResult!: (value: DesignWriteAdmissionResult<T>) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<DesignWriteAdmissionResult<T>>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const lane = result.then(
      () => undefined,
      () => undefined,
    )
    lanes.set(prepared.resource, lane)
    void lane.finally(() => {
      if (lanes.get(prepared.resource) === lane) lanes.delete(prepared.resource)
    })
    if (prepared.blocksReplacement) {
      blockingWrites.add(result)
      void result.then(
        () => blockingWrites.delete(result),
        () => blockingWrites.delete(result),
      )
    }
    const start = () => {
      void write().then(resolveResult, rejectResult)
    }
    if (predecessor) {
      void predecessor.then(start, start)
    } else {
      start()
    }
    return result
  }

  return {
    dispose() {
      const gate = replacementGate
      if (!gate) return
      replacementGate = null
      gate.open()
    },
    destinationPath(destination) {
      return readDestination(destination).destinationPath
    },
    executeImmediately(destination, content, isCurrent, settle) {
      const prepared = readSynchronousDestination(destination)
      if (replacementGate || lanes.has(prepared.resource)) {
        throw new Error('Design write resource is busy')
      }
      let releaseLane!: () => void
      const lane = new Promise<void>((resolve) => {
        releaseLane = resolve
      })
      lanes.set(prepared.resource, lane)
      if (prepared.blocksReplacement) blockingWrites.add(lane)
      try {
        if (!isCurrent()) return { status: 'stale' }
        const result = prepared.write(content)
        if (isPromiseLike(result)) {
          throw new Error('Synchronous Design write destination returned a Promise')
        }
        return { status: 'written', value: settle() }
      } finally {
        if (lanes.get(prepared.resource) === lane) lanes.delete(prepared.resource)
        blockingWrites.delete(lane)
        releaseLane()
      }
    },
    execute(destination, content, isCurrent, settle) {
      const prepared = readDestination(destination)
      const gate = prepared.blocksReplacement ? replacementGate?.promise ?? null : null
      return enqueue(prepared, content, isCurrent, settle, gate)
    },
    withReplacementFence<T>(replace: () => Promise<T>): Promise<T> {
      if (!replacementGate) {
        let open!: () => void
        const promise = new Promise<void>((resolve) => {
          open = resolve
        })
        replacementGate = {
          promise,
          open,
          drain: blockingWrites.size === 0
            ? null
            : Promise.allSettled([...blockingWrites]).then(() => undefined),
          fenceCount: 0,
        }
      }
      const gate = replacementGate
      gate.fenceCount += 1
      const release = () => {
        gate.fenceCount -= 1
        if (gate.fenceCount !== 0 || replacementGate !== gate) return
        replacementGate = null
        gate.open()
      }

      let result: Promise<T>
      try {
        result = gate.drain ? gate.drain.then(replace) : replace()
      } catch (error) {
        release()
        return Promise.reject(error)
      }
      return result.then(
        (value) => {
          release()
          return value
        },
        (error: unknown) => {
          release()
          throw error
        },
      )
    },
  }
}

function isPromiseLike(value: void | Promise<void>): value is Promise<void> {
  return typeof value === 'object'
    && value !== null
    && typeof value.then === 'function'
}

function readDestination(
  destination: PreparedDesignWriteDestination,
): PreparedDesignWriteDestinationState {
  const prepared = destinationStates.get(destination)
  if (!prepared) throw new Error('Unknown prepared Design write destination')
  return prepared
}

function readSynchronousDestination(
  destination: PreparedSynchronousDesignWriteDestination,
): PreparedDesignWriteDestinationState {
  const prepared = synchronousDestinationStates.get(destination)
  if (!prepared) throw new Error('Unknown prepared synchronous Design write destination')
  return prepared
}
