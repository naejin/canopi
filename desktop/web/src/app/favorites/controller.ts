import { mutateSettingsProjection } from '../settings/projection'

export function commitSavedStampsFrameHeight(height: number): void {
  if (!Number.isFinite(height)) return
  mutateSettingsProjection((settings) => {
    settings.savedStamps.frameHeight = height
  }, { persist: 'immediate' })
}
