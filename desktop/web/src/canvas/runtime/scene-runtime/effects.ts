import type { CanvasRuntimeSettingsAdapter } from '../app-adapter'
import {
  runCanvasRuntimeCleanups,
  throwCanvasRuntimeCleanupErrors,
} from '../cleanup'

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
  const disposers: Array<() => void> = []
  try {
    disposers.push(deps.settings.subscribeTheme(deps.onTheme))
    disposers.push(deps.settings.subscribeLocale(deps.onLocale))
    disposers.push(deps.settings.subscribeChromeOverlay(deps.onChromeOverlay))
    disposers.push(deps.subscribePanelOriginTargetChanges(deps.onPanelTargetHover))
    return disposers
  } catch (error) {
    const errors: unknown[] = [error]
    try {
      runCanvasRuntimeCleanups(
        [...disposers].reverse(),
        'Scene Canvas runtime effect installation rollback failed',
      )
    } catch (cleanupError) {
      errors.push(cleanupError)
    }
    throwCanvasRuntimeCleanupErrors(errors, 'Scene Canvas runtime effect installation failed')
    return []
  }
}
