import { vi } from 'vitest'
import type { CameraController } from '../../canvas/runtime/camera'
import type { ScenePoint } from '../../canvas/runtime/scene'

export interface SceneInteractionBounds {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

export interface SceneInteractionPointerOptions extends MouseEventInit {
  readonly pointerId?: number
  readonly pointerType?: string
  readonly isPrimary?: boolean
  readonly target?: EventTarget
}

export interface SceneInteractionEventHarnessOptions {
  readonly bounds?: SceneInteractionBounds
  readonly trackListeners?: boolean
}

export interface SceneInteractionKeyboardOptions extends KeyboardEventInit {
  readonly target?: EventTarget
}

export interface SceneInteractionListenerLog {
  containerAdds(eventName: string): unknown[]
  containerRemoves(eventName: string): unknown[]
  windowAdds(eventName: string): unknown[]
  windowRemoves(eventName: string): unknown[]
}

type ListenerSpy = ReturnType<typeof vi.spyOn>

export interface SceneInteractionEventHarness {
  readonly listenerLog: SceneInteractionListenerLog | null
  setBounds(bounds: SceneInteractionBounds): void
  boundsReads(): number
  clientPoint(screen: ScenePoint): ScenePoint
  screenPointFrom(event: Pick<MouseEvent, 'clientX' | 'clientY'>, rect?: DOMRect): ScenePoint
  worldPointFrom(
    camera: CameraController,
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    rect?: DOMRect,
  ): ScenePoint
  pointerDown(screen: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  pointerDownClient(client: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  pointerMove(screen: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  pointerMoveClient(client: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  pointerUp(screen: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  pointerUpClient(client: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  pointerLeave(screen: ScenePoint, options?: SceneInteractionPointerOptions): PointerEvent
  wheel(screen: ScenePoint, options?: WheelEventInit): WheelEvent
  keyDown(options: string | SceneInteractionKeyboardOptions): KeyboardEvent
  keyUp(options: string | SceneInteractionKeyboardOptions): KeyboardEvent
  holdSpace(): KeyboardEvent
  releaseSpace(): KeyboardEvent
  dispose(): void
}

const DEFAULT_BOUNDS: SceneInteractionBounds = {
  left: 0,
  top: 0,
  width: 400,
  height: 300,
}

export function createSceneInteractionEventHarness(
  container: HTMLElement,
  options: SceneInteractionEventHarnessOptions = {},
): SceneInteractionEventHarness {
  let bounds = options.bounds ?? DEFAULT_BOUNDS
  let boundsReadCount = 0
  const originalGetBoundingClientRect = container.getBoundingClientRect
  Object.defineProperty(container, 'getBoundingClientRect', {
    configurable: true,
    value: () => {
      boundsReadCount += 1
      return createRect(bounds)
    },
  })

  const listenerSpies = options.trackListeners ? createListenerSpies(container) : null

  function setBounds(next: SceneInteractionBounds): void {
    bounds = next
  }

  function clientPoint(screen: ScenePoint): ScenePoint {
    return {
      x: bounds.left + screen.x,
      y: bounds.top + screen.y,
    }
  }

  function currentRect(): DOMRect {
    return createRect(bounds)
  }

  function screenPointFrom(event: Pick<MouseEvent, 'clientX' | 'clientY'>, rect = currentRect()): ScenePoint {
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
  }

  function worldPointFrom(
    camera: CameraController,
    event: Pick<MouseEvent, 'clientX' | 'clientY'>,
    rect = currentRect(),
  ): ScenePoint {
    return camera.screenToWorld(screenPointFrom(event, rect))
  }

  function pointerDown(screen: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(container, 'pointerdown', clientPoint(screen), eventOptions)
  }

  function pointerDownClient(client: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(container, 'pointerdown', client, eventOptions)
  }

  function pointerMove(screen: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(window, 'pointermove', clientPoint(screen), eventOptions)
  }

  function pointerMoveClient(client: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(window, 'pointermove', client, eventOptions)
  }

  function pointerUp(screen: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(window, 'pointerup', clientPoint(screen), eventOptions)
  }

  function pointerUpClient(client: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(window, 'pointerup', client, eventOptions)
  }

  function pointerLeave(screen: ScenePoint, eventOptions: SceneInteractionPointerOptions = {}): PointerEvent {
    return dispatchPointer(container, 'pointerleave', clientPoint(screen), eventOptions)
  }

  function wheel(screen: ScenePoint, eventOptions: WheelEventInit = {}): WheelEvent {
    const point = clientPoint(screen)
    const event = createWheelEvent(point, eventOptions)
    container.dispatchEvent(event)
    return event
  }

  function keyDown(eventOptions: string | SceneInteractionKeyboardOptions): KeyboardEvent {
    return dispatchKeyboard('keydown', eventOptions)
  }

  function keyUp(eventOptions: string | SceneInteractionKeyboardOptions): KeyboardEvent {
    return dispatchKeyboard('keyup', eventOptions)
  }

  function holdSpace(): KeyboardEvent {
    return keyDown({ key: ' ', code: 'Space' })
  }

  function releaseSpace(): KeyboardEvent {
    return keyUp({ key: ' ', code: 'Space' })
  }

  return {
    listenerLog: listenerSpies?.log ?? null,
    setBounds,
    boundsReads: () => boundsReadCount,
    clientPoint,
    screenPointFrom,
    worldPointFrom,
    pointerDown,
    pointerDownClient,
    pointerMove,
    pointerMoveClient,
    pointerUp,
    pointerUpClient,
    pointerLeave,
    wheel,
    keyDown,
    keyUp,
    holdSpace,
    releaseSpace,
    dispose: () => {
      listenerSpies?.restore()
      Object.defineProperty(container, 'getBoundingClientRect', {
        configurable: true,
        value: originalGetBoundingClientRect,
      })
    },
  }
}

function dispatchPointer(
  defaultTarget: EventTarget,
  type: string,
  client: ScenePoint,
  options: SceneInteractionPointerOptions,
): PointerEvent {
  const event = createPointerEvent(type, client, options)
  ;(options.target ?? defaultTarget).dispatchEvent(event)
  return event
}

function createPointerEvent(
  type: string,
  client: ScenePoint,
  options: SceneInteractionPointerOptions,
): PointerEvent {
  const {
    pointerId = 1,
    pointerType = 'mouse',
    isPrimary = true,
    target: _target,
    button = 0,
    buttons = button === 0 ? 1 : 0,
    bubbles = true,
    cancelable = true,
    ...mouseOptions
  } = options
  const event = new MouseEvent(type, {
    ...mouseOptions,
    bubbles,
    cancelable,
    button,
    buttons,
    clientX: client.x,
    clientY: client.y,
  })
  definePointerFields(event, {
    pointerId,
    pointerType,
    isPrimary,
  })
  return event as PointerEvent
}

function definePointerFields(
  event: MouseEvent,
  fields: Pick<PointerEvent, 'pointerId' | 'pointerType' | 'isPrimary'>,
): void {
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: fields.pointerId },
    pointerType: { configurable: true, value: fields.pointerType },
    isPrimary: { configurable: true, value: fields.isPrimary },
  })
}

function createWheelEvent(client: ScenePoint, options: WheelEventInit): WheelEvent {
  if (typeof WheelEvent === 'function') {
    return new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      ...options,
      clientX: client.x,
      clientY: client.y,
    })
  }
  const event = new MouseEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ...options,
    clientX: client.x,
    clientY: client.y,
  })
  Object.defineProperty(event, 'deltaY', {
    configurable: true,
    value: options.deltaY ?? 0,
  })
  return event as WheelEvent
}

function dispatchKeyboard(type: string, options: string | SceneInteractionKeyboardOptions): KeyboardEvent {
  const init = typeof options === 'string'
    ? { key: options, code: options }
    : options
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  ;(init.target ?? window).dispatchEvent(event)
  return event
}

function createRect(bounds: SceneInteractionBounds): DOMRect {
  const right = bounds.left + bounds.width
  const bottom = bounds.top + bounds.height
  return {
    x: bounds.left,
    y: bounds.top,
    left: bounds.left,
    top: bounds.top,
    right,
    bottom,
    width: bounds.width,
    height: bounds.height,
    toJSON: () => ({
      x: bounds.left,
      y: bounds.top,
      left: bounds.left,
      top: bounds.top,
      right,
      bottom,
      width: bounds.width,
      height: bounds.height,
    }),
  } as DOMRect
}

function createListenerSpies(container: HTMLElement): {
  readonly log: SceneInteractionListenerLog
  readonly restore: () => void
} {
  const addContainerListener = vi.spyOn(container, 'addEventListener')
  const removeContainerListener = vi.spyOn(container, 'removeEventListener')
  const addWindowListener = vi.spyOn(window, 'addEventListener')
  const removeWindowListener = vi.spyOn(window, 'removeEventListener')
  const log: SceneInteractionListenerLog = {
    containerAdds: (eventName) => listenerCalls(addContainerListener, eventName),
    containerRemoves: (eventName) => listenerCalls(removeContainerListener, eventName),
    windowAdds: (eventName) => listenerCalls(addWindowListener, eventName),
    windowRemoves: (eventName) => listenerCalls(removeWindowListener, eventName),
  }
  return {
    log,
    restore: () => {
      addContainerListener.mockRestore()
      removeContainerListener.mockRestore()
      addWindowListener.mockRestore()
      removeWindowListener.mockRestore()
    },
  }
}

function listenerCalls(spy: ListenerSpy, eventName: string): unknown[] {
  return spy.mock.calls.filter((call: readonly unknown[]) => call[0] === eventName)
}
