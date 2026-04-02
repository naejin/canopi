import { effect } from '@preact/signals'
import { locale, theme } from '../../../state/app'
import {
  gridVisible,
  guides,
  layerLockState,
  layerOpacity,
  layerVisibility,
  rulersVisible,
} from '../../../state/canvas'

interface SceneRuntimeEffectsDeps {
  onTheme: () => void
  onLocale: () => void
  onChromeOverlay: () => void
  onLayerSignals: () => void
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
      void guides.value
      deps.onChromeOverlay()
    }),
    effect(() => {
      void layerVisibility.value
      void layerLockState.value
      void layerOpacity.value
      void guides.value
      deps.onLayerSignals()
    }),
  ]
}
