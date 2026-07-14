import type {
  RendererBackendDefinition,
  RendererBackendInstance,
  RendererBackendContext,
  RendererHostOptions,
  RendererHostSnapshot,
  RendererRunOptions,
  RendererBackendId,
  RendererBackendChangeEvent,
  RendererAwaitable,
  RendererBackendFailureEvent,
} from './types'
import { detectRendererCapabilities } from './capabilities'

export class RendererHostInitializationError extends Error {
  constructor(
    message: string,
    readonly causes: readonly RendererBackendFailureEvent[],
  ) {
    super(message)
    this.name = 'RendererHostInitializationError'
  }
}

export class RendererHostInitializationCancelledError extends Error {
  constructor() {
    super('RendererHost initialization was cancelled because its lifecycle changed.')
    this.name = 'RendererHostInitializationCancelledError'
  }
}

export class RendererHostAlreadyInitializedError extends Error {
  constructor() {
    super('RendererHost already has an active or pending backend. Dispose it before initializing again.')
    this.name = 'RendererHostAlreadyInitializedError'
  }
}

type RendererHostState<TInstance extends RendererBackendInstance> = {
  backend: RendererBackendDefinition<unknown, TInstance> | null
  instance: TInstance | null
  context: unknown
  initialized: boolean
  attemptedBackendIds: RendererBackendId[]
  failedBackendIds: RendererBackendId[]
  lastError: unknown | null
}

type RendererHostRuntimeFailover<TInstance extends RendererBackendInstance> = {
  failedInstance: TInstance
  lifecycleEpoch: number
  promise: Promise<TInstance>
}

export class RendererHost<
  TContext,
  TInstance extends RendererBackendInstance = RendererBackendInstance,
> {
  private readonly _capabilities: ReturnType<typeof detectRendererCapabilities>
  private _lifecycleEpoch = 0
  private _initializationToken: object | null = null
  private _initializationPromise: Promise<TInstance> | null = null
  private _runtimeFailover: RendererHostRuntimeFailover<TInstance> | null = null
  private readonly _failureEvents = new Map<RendererBackendId, RendererBackendFailureEvent>()
  private readonly _state: RendererHostState<TInstance> = {
    backend: null,
    instance: null,
    context: null,
    initialized: false,
    attemptedBackendIds: [],
    failedBackendIds: [],
    lastError: null,
  }

  constructor(private readonly _options: RendererHostOptions<TContext, TInstance>) {
    this._capabilities = _options.capabilities ?? detectRendererCapabilities()
  }

  get snapshot(): RendererHostSnapshot {
    return {
      initialized: this._state.initialized,
      activeBackendId: this._state.backend?.id ?? null,
      attemptedBackendIds: [...this._state.attemptedBackendIds],
      failedBackendIds: [...this._state.failedBackendIds],
      lastError: this._state.lastError,
    }
  }

  async initialize(context: TContext): Promise<TInstance> {
    if (
      this._initializationToken
      || this._runtimeFailover
      || this._state.initialized
      || this._state.instance
    ) {
      throw new RendererHostAlreadyInitializedError()
    }

    const initializationToken = {}
    this._initializationToken = initializationToken
    const lifecycleEpoch = ++this._lifecycleEpoch
    this._state.context = context
    let resolveInitialization!: (instance: TInstance) => void
    let rejectInitialization!: (error: unknown) => void
    const initializationPromise = new Promise<TInstance>((resolve, reject) => {
      resolveInitialization = resolve
      rejectInitialization = reject
    })
    this._initializationPromise = initializationPromise
    void this._selectBackend(
      'manual',
      this._state.backend?.id ?? null,
      lifecycleEpoch,
    ).then(resolveInitialization, rejectInitialization)
    try {
      const instance = await initializationPromise
      this._assertBackendCurrent(instance, lifecycleEpoch)
      return instance
    } finally {
      if (this._initializationToken === initializationToken) {
        this._initializationToken = null
        if (this._initializationPromise === initializationPromise) {
          this._initializationPromise = null
        }
      }
    }
  }

  async run<T>(
    operation: (instance: TInstance, backendContext: RendererBackendContext) => RendererAwaitable<T>,
    options: RendererRunOptions = {},
  ): Promise<T> {
    const lifecycleEpoch = this._lifecycleEpoch
    let backend = await this._ensureBackend()
    while (true) {
      const admittedFailover = this._admittedFailoverFor(backend, lifecycleEpoch)
      if (admittedFailover) {
        backend = await admittedFailover
        continue
      }
      this._assertBackendCurrent(backend, lifecycleEpoch)
      const backendContext = this._currentBackendContext(backend.id)

      try {
        const result = await operation(backend, backendContext)
        this._assertBackendCurrent(backend, lifecycleEpoch)
        return result
      } catch (error) {
        if (options.retryOnFailover === false) {
          this._assertBackendCurrent(backend, lifecycleEpoch)
          this._recordFailure(backend.id, 'runtime', error)
          this._assertBackendCurrent(backend, lifecycleEpoch)
          throw error
        }

        try {
          backend = await this._recoverFromRuntimeFailure(
            backend,
            lifecycleEpoch,
            error,
          )
        } catch (failoverError) {
          if (!(failoverError instanceof RendererHostInitializationError)) {
            throw failoverError
          }
          throw new RendererHostInitializationError(
            `RendererHost failed while running ${options.operationName ?? 'renderer operation'}.`,
            this._buildFailureCauses(),
          )
        }
      }
    }
  }

  private _admittedFailoverFor(
    backend: TInstance,
    lifecycleEpoch: number,
  ): Promise<TInstance> | null {
    const admittedFailover = this._runtimeFailover
    return admittedFailover?.failedInstance === backend
      && admittedFailover.lifecycleEpoch === lifecycleEpoch
      ? admittedFailover.promise
      : null
  }

  async dispose(): Promise<void> {
    ++this._lifecycleEpoch
    this._initializationToken = null
    this._initializationPromise = null
    this._runtimeFailover = null
    this._state.backend = null
    this._state.initialized = false
    this._state.context = null
    await this._disposeCurrentBackend()
  }

  private _currentBackendContext(backendId: RendererBackendId): RendererBackendContext {
    return {
      capabilities: this._capabilities,
      backendId,
    }
  }

  private async _ensureBackend(): Promise<TInstance> {
    if (this._runtimeFailover) {
      return this._runtimeFailover.promise
    }
    if (this._initializationPromise) {
      return this._initializationPromise
    }
    if (this._state.initialized && this._state.instance) {
      return this._state.instance
    }

    return this._selectBackend('manual')
  }

  private _recoverFromRuntimeFailure(
    failedInstance: TInstance,
    lifecycleEpoch: number,
    error: unknown,
  ): Promise<TInstance> {
    if (this._lifecycleEpoch !== lifecycleEpoch) {
      throw new RendererHostInitializationCancelledError()
    }

    const currentFailover = this._runtimeFailover
    if (currentFailover) {
      if (currentFailover.lifecycleEpoch !== lifecycleEpoch) {
        throw new RendererHostInitializationCancelledError()
      }
      if (currentFailover.failedInstance === failedInstance) {
        this._recordFailure(failedInstance.id, 'runtime', error)
        return currentFailover.promise
      }
    }

    this._assertBackendCurrent(failedInstance, lifecycleEpoch)
    this._recordFailure(failedInstance.id, 'runtime', error)
    this._assertBackendCurrent(failedInstance, lifecycleEpoch)
    this._state.backend = null
    this._state.initialized = false
    const promise = Promise.resolve().then(() => (
      this._performRuntimeFailover(failedInstance, lifecycleEpoch)
    ))
    this._runtimeFailover = {
      failedInstance,
      lifecycleEpoch,
      promise,
    }
    return promise
  }

  private async _performRuntimeFailover(
    failedInstance: TInstance,
    lifecycleEpoch: number,
  ): Promise<TInstance> {
    this._assertFailoverCurrent(failedInstance, lifecycleEpoch)
    await this._disposeCurrentBackend()
    return this._selectBackend('runtime-failure', failedInstance.id, lifecycleEpoch)
  }

  private async _selectBackend(
    reason: RendererBackendChangeEvent['reason'],
    previousBackendId: RendererBackendId | null = this._state.backend?.id ?? null,
    lifecycleEpoch: number = this._lifecycleEpoch,
  ): Promise<TInstance> {
    const context = this._state.context
    if (context === null) {
      throw new RendererHostInitializationError('RendererHost requires initialize(context) before use.', [])
    }
    this._assertLifecycleCurrent(lifecycleEpoch, context)

    const supportedBackends = this._options.backends.filter((backend) =>
      backend.supports ? backend.supports(this._capabilities) : true,
    )
    const candidates = supportedBackends

    if (candidates.length === 0) {
      throw new RendererHostInitializationError('No renderer backends are supported by the current environment.', [])
    }

    const failures: RendererBackendFailureEvent[] = []
    for (const backend of candidates) {
      this._assertLifecycleCurrent(lifecycleEpoch, context)
      if (this._state.failedBackendIds.includes(backend.id)) {
        continue
      }

      this._state.attemptedBackendIds.push(backend.id)
      let instance: TInstance
      try {
        instance = await backend.initialize(
          context as TContext,
          {
            capabilities: this._capabilities,
            backendId: backend.id,
          },
        )
      } catch (error) {
        this._assertLifecycleCurrent(lifecycleEpoch, context)
        this._recordFailure(backend.id, 'initialize', error)
        failures.push({ backendId: backend.id, phase: 'initialize', error })
        continue
      }

      if (!this._isLifecycleCurrent(lifecycleEpoch, context)) {
        await this._disposeBackendInstance(instance)
        throw new RendererHostInitializationCancelledError()
      }

      this._state.backend = backend as RendererBackendDefinition<unknown, TInstance>
      this._state.instance = instance
      this._state.initialized = true
      this._state.lastError = null
      const eventReason: RendererBackendChangeEvent['reason'] =
        reason === 'manual' && failures.length > 0 ? 'initialize-failure' : reason
      try {
        this._options.onBackendChange?.({
          previousBackendId,
          nextBackendId: backend.id,
          reason: eventReason,
        })
      } catch (error) {
        if (this._state.instance === instance) {
          this._state.backend = null
          this._state.initialized = false
          await this._disposeCurrentBackend()
        }
        throw error
      }
      this._assertLifecycleCurrent(lifecycleEpoch, context)
      return instance
    }

    throw new RendererHostInitializationError(
      'Unable to initialize any renderer backend.',
      this._buildFailureCauses(),
    )
  }

  private async _disposeCurrentBackend(): Promise<void> {
    const instance = this._state.instance
    this._state.instance = null
    if (!instance) return

    await this._disposeBackendInstance(instance)
  }

  private async _disposeBackendInstance(instance: TInstance): Promise<void> {
    try {
      await instance.dispose()
    } catch {
      // Disposal is best-effort during teardown and failover.
    }
  }

  private _assertLifecycleCurrent(lifecycleEpoch: number, context: unknown): void {
    if (!this._isLifecycleCurrent(lifecycleEpoch, context)) {
      throw new RendererHostInitializationCancelledError()
    }
  }

  private _assertBackendCurrent(instance: TInstance, lifecycleEpoch: number): void {
    if (
      this._lifecycleEpoch !== lifecycleEpoch
      || !this._state.initialized
      || this._state.instance !== instance
    ) {
      throw new RendererHostInitializationCancelledError()
    }
  }

  private _assertFailoverCurrent(instance: TInstance, lifecycleEpoch: number): void {
    const failover = this._runtimeFailover
    if (
      this._lifecycleEpoch !== lifecycleEpoch
      || failover?.lifecycleEpoch !== lifecycleEpoch
      || failover.failedInstance !== instance
      || this._state.instance !== instance
    ) {
      throw new RendererHostInitializationCancelledError()
    }
  }

  private _isLifecycleCurrent(lifecycleEpoch: number, context: unknown): boolean {
    return this._lifecycleEpoch === lifecycleEpoch && this._state.context === context
  }

  private _recordFailure(
    backendId: RendererBackendId,
    phase: 'initialize' | 'runtime',
    error: unknown,
  ): void {
    this._state.lastError = error
    const failure = { backendId, phase, error } as const
    this._failureEvents.set(backendId, failure)
    if (!this._state.failedBackendIds.includes(backendId)) {
      this._state.failedBackendIds = [...this._state.failedBackendIds, backendId]
    }
    try {
      this._options.onBackendFailure?.(failure)
    } catch (observerError) {
      console.error('Renderer backend failure observer failed:', observerError)
    }
  }

  private _buildFailureCauses(): RendererBackendFailureEvent[] {
    return this._state.failedBackendIds.flatMap((backendId) => {
      const failure = this._failureEvents.get(backendId)
      return failure ? [failure] : []
    })
  }
}
