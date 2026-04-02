export type RendererBackendId = string

export type RendererBackendPriority = 'primary' | 'secondary' | number

export type RendererAwaitable<T> = T | PromiseLike<T>

export type RendererBackendProbe = Partial<RendererCapabilities>

export interface RendererCapabilities {
  readonly domCanvas: boolean
  readonly canvas2d: boolean
  readonly offscreenCanvas: boolean
  readonly offscreenCanvas2d: boolean
  readonly webgl: boolean
  readonly webgl2: boolean
  readonly webgpu: boolean
  readonly imageBitmap: boolean
  readonly createImageBitmap: boolean
  readonly worker: boolean
  readonly devicePixelRatio: number | null
  readonly prefersReducedMotion: boolean | null
}

export interface RendererCapabilityEnvironment {
  readonly document?: Pick<Document, 'createElement'>
  readonly navigator?: {
    readonly gpu?: unknown
  } | null
  readonly window?: Pick<Window, 'devicePixelRatio' | 'matchMedia'> | null
  readonly OffscreenCanvas?: typeof OffscreenCanvas
  readonly HTMLCanvasElement?: typeof HTMLCanvasElement
  readonly ImageBitmap?: typeof ImageBitmap
  readonly Worker?: typeof Worker
  readonly createImageBitmap?: typeof createImageBitmap
}

export interface RendererBackendContext {
  readonly capabilities: RendererCapabilities
  readonly backendId: RendererBackendId
}

export interface RendererBackendInstance {
  readonly id: RendererBackendId
  dispose(): RendererAwaitable<void>
}

export interface RendererBackendDefinition<
  TContext,
  TInstance extends RendererBackendInstance = RendererBackendInstance,
> {
  readonly id: RendererBackendId
  readonly priority?: RendererBackendPriority
  readonly supports?: (capabilities: RendererCapabilities) => boolean
  initialize(context: TContext, backendContext: RendererBackendContext): RendererAwaitable<TInstance>
}

export interface RendererBackendFailureEvent {
  readonly backendId: RendererBackendId
  readonly phase: 'initialize' | 'runtime'
  readonly error: unknown
}

export interface RendererBackendChangeEvent {
  readonly previousBackendId: RendererBackendId | null
  readonly nextBackendId: RendererBackendId
  readonly reason: 'initialize-failure' | 'runtime-failure' | 'manual'
}

export interface RendererHostSnapshot {
  readonly initialized: boolean
  readonly activeBackendId: RendererBackendId | null
  readonly attemptedBackendIds: readonly RendererBackendId[]
  readonly failedBackendIds: readonly RendererBackendId[]
  readonly lastError: unknown | null
}

export interface RendererHostOptions<
  TContext,
  TInstance extends RendererBackendInstance = RendererBackendInstance,
> {
  readonly backends: readonly [
    RendererBackendDefinition<TContext, TInstance>,
    RendererBackendDefinition<TContext, TInstance>,
    ...RendererBackendDefinition<TContext, TInstance>[],
  ]
  readonly capabilities?: RendererCapabilities
  readonly onBackendFailure?: (event: RendererBackendFailureEvent) => void
  readonly onBackendChange?: (event: RendererBackendChangeEvent) => void
}

export interface RendererRunOptions {
  readonly operationName?: string
  readonly retryOnFailover?: boolean
}
