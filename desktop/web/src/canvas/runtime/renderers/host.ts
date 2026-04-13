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

type RendererHostState<TInstance extends RendererBackendInstance> = {
  backend: RendererBackendDefinition<unknown, TInstance> | null
  instance: TInstance | null
  context: unknown
  initialized: boolean
  attemptedBackendIds: RendererBackendId[]
  failedBackendIds: RendererBackendId[]
  lastError: unknown | null
}

export class RendererHost<
  TContext,
  TInstance extends RendererBackendInstance = RendererBackendInstance,
> {
  private readonly _capabilities: ReturnType<typeof detectRendererCapabilities>
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
    this._state.context = context
    return this._selectBackend('manual')
  }

  async run<T>(
    operation: (instance: TInstance, backendContext: RendererBackendContext) => RendererAwaitable<T>,
    options: RendererRunOptions = {},
  ): Promise<T> {
    const backend = await this._ensureBackend()
    const backendContext = this._currentBackendContext(backend.id)

    try {
      return await operation(backend, backendContext)
    } catch (error) {
      if (options.retryOnFailover === false) {
        this._recordFailure(backend.id, 'runtime', error)
        throw error
      }

      this._recordFailure(backend.id, 'runtime', error)
      const failedBackendId = backend.id
      await this._disposeCurrentBackend()
      this._state.backend = null
      this._state.instance = null
      this._state.initialized = false

      const retryBackend = await this._selectBackend('runtime-failure', failedBackendId)
      const retryContext = this._currentBackendContext(retryBackend.id)

      try {
        return await operation(retryBackend, retryContext)
      } catch (retryError) {
        this._recordFailure(retryBackend.id, 'runtime', retryError)
        throw new RendererHostInitializationError(
          `RendererHost failed while running ${options.operationName ?? 'renderer operation'}.`,
          this._buildFailureCauses(retryBackend.id, retryError),
        )
      }
    }
  }

  async dispose(): Promise<void> {
    await this._disposeCurrentBackend()
    this._state.backend = null
    this._state.initialized = false
    this._state.context = null
  }

  private _currentBackendContext(backendId: RendererBackendId): RendererBackendContext {
    return {
      capabilities: this._capabilities,
      backendId,
    }
  }

  private async _ensureBackend(): Promise<TInstance> {
    if (this._state.initialized && this._state.instance) {
      return this._state.instance
    }

    return this._selectBackend('manual')
  }

  private async _selectBackend(
    reason: RendererBackendChangeEvent['reason'],
    previousBackendId: RendererBackendId | null = this._state.backend?.id ?? null,
  ): Promise<TInstance> {
    const context = this._state.context
    if (context === null) {
      throw new RendererHostInitializationError('RendererHost requires initialize(context) before use.', [])
    }

    const supportedBackends = this._options.backends.filter((backend) =>
      backend.supports ? backend.supports(this._capabilities) : true,
    )
    const candidates = supportedBackends

    if (candidates.length === 0) {
      throw new RendererHostInitializationError('No renderer backends are supported by the current environment.', [])
    }

    const failures: RendererBackendFailureEvent[] = []
    for (const backend of candidates) {
      if (this._state.failedBackendIds.includes(backend.id)) {
        continue
      }

      this._state.attemptedBackendIds.push(backend.id)
      try {
        const instance = await backend.initialize(
          context as TContext,
          {
            capabilities: this._capabilities,
            backendId: backend.id,
          },
        )
        this._state.backend = backend as RendererBackendDefinition<unknown, TInstance>
        this._state.instance = instance
        this._state.initialized = true
        this._state.lastError = null
        const eventReason: RendererBackendChangeEvent['reason'] =
          reason === 'manual' && failures.length > 0 ? 'initialize-failure' : reason
        this._options.onBackendChange?.({
          previousBackendId,
          nextBackendId: backend.id,
          reason: eventReason,
        })
        return instance
      } catch (error) {
        this._recordFailure(backend.id, 'initialize', error)
        failures.push({ backendId: backend.id, phase: 'initialize', error })
      }
    }

    throw new RendererHostInitializationError(
      'Unable to initialize any renderer backend.',
      failures,
    )
  }

  private async _disposeCurrentBackend(): Promise<void> {
    const instance = this._state.instance
    this._state.instance = null
    if (!instance) return

    try {
      await instance.dispose()
    } catch {
      // Disposal is best-effort during failover.
    }
  }

  private _recordFailure(
    backendId: RendererBackendId,
    phase: 'initialize' | 'runtime',
    error: unknown,
  ): void {
    this._state.lastError = error
    if (!this._state.failedBackendIds.includes(backendId)) {
      this._state.failedBackendIds = [...this._state.failedBackendIds, backendId]
    }
    this._options.onBackendFailure?.({ backendId, phase, error })
  }

  private _buildFailureCauses(
    failedBackendId: RendererBackendId,
    error: unknown,
  ): RendererBackendFailureEvent[] {
    const causes = this._state.failedBackendIds.map((backendId) => ({
      backendId,
      phase: backendId === failedBackendId ? 'runtime' as const : 'initialize' as const,
      error: backendId === failedBackendId ? error : this._state.lastError,
    }))

    if (!this._state.failedBackendIds.includes(failedBackendId)) {
      causes.push({ backendId: failedBackendId, phase: 'runtime', error })
    }

    return causes
  }
}
