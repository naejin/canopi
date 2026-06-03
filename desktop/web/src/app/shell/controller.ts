import { mutateSettingsProjection } from '../settings/projection'

export function commitSidePanelWidth(width: number): void {
  if (!Number.isFinite(width)) return
  mutateSettingsProjection((settings) => {
    settings.sidePanel.width = width
  }, { persist: 'immediate' })
}
