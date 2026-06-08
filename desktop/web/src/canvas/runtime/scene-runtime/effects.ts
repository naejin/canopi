import type { CanvasRuntimeSettingsAdapter } from '../app-adapter'

interface SceneRuntimeEffectsDeps {
  onTheme: () => void
  onLocale: () => void
  onChromeOverlay: () => void
  onPanelTargetHover: () => void
  settings: Pick<
    CanvasRuntimeSettingsAdapter,
    'subscribeTheme' | 'subscribeLocale' | 'subscribeChromeOverlay'
  >
  subscribePanelOriginTargetChanges(onChange: () => void): () => void
}

export function installSceneRuntimeEffects(deps: SceneRuntimeEffectsDeps): Array<() => void> {
  return [
    deps.settings.subscribeTheme(deps.onTheme),
    deps.settings.subscribeLocale(deps.onLocale),
    deps.settings.subscribeChromeOverlay(deps.onChromeOverlay),
    deps.subscribePanelOriginTargetChanges(deps.onPanelTargetHover),
  ]
}
