import { sidePanel } from '../../app/shell/state'
import { t } from '../../i18n'
import type { ComponentChildren } from 'preact'
import { SurfaceHeader } from './SurfaceHeader'

export function DockPanelHeader({ title, actions }: {
  readonly title: string
  readonly actions?: ComponentChildren
}) {
  return <SurfaceHeader title={title} actions={actions} closeLabel={t('sidebar.close')} onClose={closeDockPanel} />
}

/** Closes the open dock panel and returns focus to its rail button. */
export function closeDockPanel(): void {
  const panel = sidePanel.value
  sidePanel.value = null
  document.querySelector<HTMLButtonElement>(`button[data-panel="${panel}"]`)?.focus()
}
