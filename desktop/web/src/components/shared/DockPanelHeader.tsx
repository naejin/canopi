import { sidePanel } from '../../app/shell/state'
import { t } from '../../i18n'
import type { ComponentChildren } from 'preact'
import { SurfaceHeader } from './SurfaceHeader'

export function DockPanelHeader({ title, count, actions }: {
  readonly title: string
  readonly count?: number
  readonly actions?: ComponentChildren
}) {
  return <SurfaceHeader title={title} count={count} actions={actions} closeLabel={t('sidebar.close')} onClose={() => {
    const panel = sidePanel.value
    sidePanel.value = null
    document.querySelector<HTMLButtonElement>(`button[data-panel="${panel}"]`)?.focus()
  }} />
}
