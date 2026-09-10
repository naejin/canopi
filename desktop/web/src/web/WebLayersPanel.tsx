import {
  currentCanvasQuerySurface,
  getCurrentCanvasLayerCommandSurface,
} from '../canvas/session'
import { activeLayerName } from '../app/canvas-settings/signals'
import { LayerPanel } from '../components/canvas/LayerPanel'
import { t } from '../i18n'

export function WebLayersPanel() {
  const queries = currentCanvasQuerySurface.value
  void queries?.revision.scene.value
  const layers = queries?.getSceneSnapshot().layers ?? []
  const rows = ['annotations', 'plants', 'measurement-guides', 'zones'].flatMap(
    (name) => {
      const layer = layers.find((entry) => entry.name === name)
      return layer
        ? [
            {
              id: layer.name,
              label: t(`canvas.layers.${layer.name}`),
              authority: 'scene' as const,
              active: activeLayerName.value === layer.name,
              visible: layer.visible,
              locked: layer.locked,
              opacity: layer.opacity,
              canLock: true,
              detail: { type: 'scene' as const },
            },
          ]
        : []
    },
  )
  return (
    <LayerPanel
      rows={rows}
      actions={{
        active: (id) => {
          activeLayerName.value = id
        },
        visibility: (id, visible) => {
          getCurrentCanvasLayerCommandSurface()?.setSceneLayerVisibility(
            id,
            visible,
          )
        },
        locked: (id, locked) => {
          getCurrentCanvasLayerCommandSurface()?.setSceneLayerLocked(id, locked)
        },
        opacity: (id, opacity) => {
          getCurrentCanvasLayerCommandSurface()?.setSceneLayerOpacity(
            id,
            opacity,
          )
        },
      }}
    />
  )
}
