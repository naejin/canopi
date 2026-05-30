import { effect } from '@preact/signals'
import { locale, theme } from '../../../app/settings/state'
import {
  gridVisible,
  rulersVisible,
} from '../../../app/canvas-settings/signals'

interface SceneRuntimeEffectsDeps {
  onTheme: () => void
  onLocale: () => void
  onChromeOverlay: () => void
  onPanelTargetHover: () => void
  subscribePanelOriginTargetChanges(onChange: () => void): () => void
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
    deps.subscribePanelOriginTargetChanges(deps.onPanelTargetHover),
  ]
}
