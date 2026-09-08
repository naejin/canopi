import type {
  RendererCapabilityEnvironment,
  RendererCapabilities,
} from './types'

function _tryCreateCanvas(
  document: Pick<Document, 'createElement'> | undefined,
): HTMLCanvasElement | null {
  if (!document) return null

  try {
    const canvas = document.createElement('canvas')
    return typeof (canvas as HTMLCanvasElement).getContext === 'function'
      ? (canvas as HTMLCanvasElement)
      : null
  } catch {
    return null
  }
}

function _tryCreateOffscreenCanvas(
  constructor: typeof OffscreenCanvas | undefined,
): OffscreenCanvas | null {
  if (typeof constructor !== 'function') return null

  try {
    return new constructor(1, 1)
  } catch {
    return null
  }
}

function _tryGetContext(
  canvas: Pick<HTMLCanvasElement | OffscreenCanvas, 'getContext'> | null,
  contextId: '2d' | 'webgl' | 'webgl2',
): boolean {
  if (!canvas) return false

  try {
    return canvas.getContext(contextId) !== null
  } catch {
    return false
  }
}

function _supportsReducedMotion(
  window: Pick<Window, 'matchMedia'> | null | undefined,
): boolean | null {
  if (!window?.matchMedia) return null

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return null
  }
}

export function detectRendererCapabilities(
  environment: RendererCapabilityEnvironment = globalThis as unknown as RendererCapabilityEnvironment,
): RendererCapabilities {
  const htmlCanvas = _tryCreateCanvas(environment.document)
  const offscreenCanvas = _tryCreateOffscreenCanvas(environment.OffscreenCanvas)

  // A successful getContext locks that canvas to its context type. Probe
  // incompatible types on independent canvases, including OffscreenCanvas.
  return {
    domCanvas: htmlCanvas !== null,
    canvas2d:
      _tryGetContext(htmlCanvas, '2d') ||
      _tryGetContext(offscreenCanvas, '2d'),
    offscreenCanvas: environment.OffscreenCanvas !== undefined,
    offscreenCanvas2d: _tryGetContext(offscreenCanvas, '2d'),
    webgl:
      _tryGetContext(_tryCreateCanvas(environment.document), 'webgl') ||
      _tryGetContext(_tryCreateOffscreenCanvas(environment.OffscreenCanvas), 'webgl'),
    webgl2:
      _tryGetContext(_tryCreateCanvas(environment.document), 'webgl2') ||
      _tryGetContext(_tryCreateOffscreenCanvas(environment.OffscreenCanvas), 'webgl2'),
    webgpu: environment.navigator?.gpu !== undefined,
    imageBitmap: environment.ImageBitmap !== undefined,
    createImageBitmap: environment.createImageBitmap !== undefined,
    worker: environment.Worker !== undefined,
    devicePixelRatio: environment.window?.devicePixelRatio ?? null,
    prefersReducedMotion: _supportsReducedMotion(environment.window),
  }
}
