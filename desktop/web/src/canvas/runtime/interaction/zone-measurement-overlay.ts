import type { CameraController } from '../camera'
import type { ZoneMeasurementLabel } from '../zone-measurements'

const MIN_EDGE_LABEL_PX = 36

export interface ZoneMeasurementOverlayController {
  update(labels: readonly ZoneMeasurementLabel[], camera: CameraController): void
  hide(): void
  dispose(): void
}

export function createZoneMeasurementOverlay(container: HTMLElement): ZoneMeasurementOverlayController {
  const root = document.createElement('div')
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    display: 'none',
    zIndex: '4',
  })
  container.appendChild(root)

  return {
    update(labels, camera) {
      root.replaceChildren()
      let visibleCount = 0

      for (const label of labels) {
        if (label.kind === 'edge' && label.worldStart && label.worldEnd) {
          const start = camera.worldToScreen(label.worldStart)
          const end = camera.worldToScreen(label.worldEnd)
          if (Math.hypot(end.x - start.x, end.y - start.y) < MIN_EDGE_LABEL_PX) continue
        }

        const screen = camera.worldToScreen(label.worldPosition)
        const element = document.createElement('div')
        element.dataset.zoneMeasurementLabel = 'true'
        element.dataset.zoneMeasurementKind = label.kind
        element.textContent = label.text
        Object.assign(element.style, {
          position: 'absolute',
          left: `${screen.x}px`,
          top: `${screen.y}px`,
          transform: 'translate(-50%, -50%)',
          padding: '2px 5px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border-strong)',
          background: 'var(--color-surface-muted)',
          color: 'var(--color-text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          fontWeight: label.kind === 'area' ? '600' : '400',
          lineHeight: '1.2',
          whiteSpace: 'nowrap',
          boxShadow: 'var(--shadow-sm)',
        })
        root.appendChild(element)
        visibleCount += 1
      }

      root.style.display = visibleCount > 0 ? 'block' : 'none'
    },
    hide() {
      root.replaceChildren()
      root.style.display = 'none'
    },
    dispose() {
      root.remove()
    },
  }
}
