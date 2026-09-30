// canvas/runtime/input/input-router.ts
//
// Owns where a recognised gesture goes: navigation (pan, zoom, rotate) to ViewNavigation, and everything else (hovers,
// presses, drags, drops, cancels, menu requests) to the ToolHost, the only opener of the canvas menu. It computes no
// geometry, and answers the host's GestureOutcome so the DOM source can apply it to the event being handled.

import type { GestureOutcome, InputRouter, InputRouterDeps } from '../interaction-ports'
import type { RotationSession } from '../view/read-surface'
import type { Gesture } from './gestures'

const NOTHING: GestureOutcome = Object.freeze({})

export function createInputRouter(deps: InputRouterDeps): InputRouter {
  /** The live rotate gesture's session: rotate{start} begins it, end or cancel closes it. */
  let rotation: RotationSession | null = null

  return {
    route(g: Gesture): GestureOutcome {
      switch (g.kind) {
        case 'pan':
          if (g.deltaPx.x !== 0 || g.deltaPx.y !== 0) deps.navigation.panByPx(g.deltaPx)
          return NOTHING
        case 'zoom':
          deps.navigation.zoomAroundPx(g.anchorPx, g.factor)
          return NOTHING
        case 'rotate':
          if (g.phase === 'start') {
            rotation?.cancel()
            rotation = deps.navigation.beginRotation(g.anchorPx)
            return NOTHING
          }
          if (g.phase === 'move') {
            rotation?.update(g.totalDeltaDeg, { step: g.step })
            return NOTHING
          }
          if (g.phase === 'end') rotation?.end()
          else rotation?.cancel()
          rotation = null
          return NOTHING
        case 'menu-request':
          return deps.toolHost.menuAt(g.at, g.source)
        case 'hover':
        case 'hover-end':
        case 'press':
        case 'tap':
        case 'drag-start':
        case 'drag-move':
        case 'drag-end':
        case 'drop':
        case 'cancel':
          return deps.toolHost.gesture(g)
      }
    },
  }
}
