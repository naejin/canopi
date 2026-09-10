import type { SceneRendererInstance } from './scene-types'

interface FrameEvent {
  name: string
  cat: 'canopi.canvas'
  ph: 'X'
  pid: number
  tid: number
  ts: number
  dur: number
}

export interface CanvasRendererProfile {
  start(): void
  stop(): { traceEvents: readonly FrameEvent[]; dropped: number; metadata: ReturnType<typeof rendererMetadata> }
}

declare global {
  interface Window {
    __CANOPI_CANVAS_PROFILING__?: Map<HTMLCanvasElement, CanvasRendererProfile>
  }
}

const profiles = new Map<HTMLCanvasElement, CanvasRendererProfile>()

/** Development-only adapter. Exports timing events that existing trace viewers understand. */
export function instrumentSceneRenderer(canvas: HTMLCanvasElement, renderer: SceneRendererInstance): SceneRendererInstance {
  window.__CANOPI_CANVAS_PROFILING__ = profiles
  let recording = false
  let events: FrameEvent[] = []
  let dropped = 0
  const profile: CanvasRendererProfile = {
    start() { events = []; dropped = 0; recording = true },
    stop() {
      recording = false
      return { traceEvents: [...events], dropped, metadata: rendererMetadata(canvas, renderer.id) }
    },
  }
  profiles.set(canvas, profile)
  function measure(name: string, operation: () => void): void {
    if (!recording) { operation(); return }
    const start = performance.now()
    try { operation() } finally {
      if (events.length < 10000) {
        events.push({ name, cat: 'canopi.canvas', ph: 'X', pid: 1, tid: 1,
          ts: start * 1000, dur: (performance.now() - start) * 1000 })
      } else dropped += 1
    }
  }
  return {
    id: renderer.id,
    resize: (width, height) => measure('resize', () => renderer.resize(width, height)),
    renderScene: (snapshot) => measure('scene', () => renderer.renderScene(snapshot)),
    setViewport: (viewport) => measure('viewport', () => renderer.setViewport(viewport)),
    dispose() {
      recording = false
      events = []
      profiles.delete(canvas)
      return renderer.dispose()
    },
  }
}

function rendererMetadata(canvas: HTMLCanvasElement, backend: string) {
  const gl = backend === 'pixi' ? canvas.getContext('webgl2') ?? canvas.getContext('webgl') : null
  const extension = gl?.getExtension('WEBGL_debug_renderer_info')
  return {
    backend, dpr: window.devicePixelRatio,
    width: canvas.width, height: canvas.height,
    gpu: extension ? String(gl!.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null,
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => {
  for (const profile of profiles.values()) profile.stop()
  profiles.clear()
  if (window.__CANOPI_CANVAS_PROFILING__ === profiles) delete window.__CANOPI_CANVAS_PROFILING__
})
