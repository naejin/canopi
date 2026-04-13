import { effect } from '@preact/signals'
import { locale, theme } from '../../../app/settings/state'
import { hoveredPanelTargets, selectedPanelTargets } from '../../../app/panel-targets/state'
import { layerLockState, layerOpacity, layerVisibility } from '../../../app/canvas-settings/signals'
import {
  gridVisible,
  guides,
  rulersVisible,
} from '../../../state/canvas'

interface SceneRuntimeEffectsDeps {
  onTheme: () => void
  onLocale: () => void
  onChromeOverlay: () => void
  onLayerSignals: () => void
  onPanelTargetHover: () => void
}

export function installSceneRuntimeEffects(deps: SceneRuntimeEffectsDeps): Array<() => void> {
  return [
    effect(() => {
      void theme.value
      deps.onTheme()
    }),
    effect(() => {
      void locale.value
      deps.onLocale()
    }),
    effect(() => {
      void gridVisible.value
      void rulersVisible.value
      deps.onChromeOverlay()
    }),
    effect(() => {
      void layerVisibility.value
      void layerLockState.value
      void layerOpacity.value
      void guides.value
      deps.onLayerSignals()
    }),
    effect(() => {
      void hoveredPanelTargets.value
      void selectedPanelTargets.value
      deps.onPanelTargetHover()
    }),
  ]
}
