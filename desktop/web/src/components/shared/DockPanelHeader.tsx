import { sidePanel } from '../../app/shell/state'
import { t } from '../../i18n'
import { SurfaceHeader } from './SurfaceHeader'

export function DockPanelHeader({ title, count }: { readonly title: string; readonly count?: number }) {
  return <SurfaceHeader title={title} count={count} closeLabel={t('sidebar.close')} onClose={() => {
    const panel = sidePanel.value
    sidePanel.value = null
    document.querySelector<HTMLButtonElement>(`button[data-panel="${panel}"]`)?.focus()
  }} />
}
