import { appCommandGraphPanelProjection } from '../../commands/registry'
import { currentDesign } from '../../app/document-session/store'
import { t } from '../../i18n'
import { PanelRail } from '../shared/PanelRail'

/** Desktop panel rail over the command graph; hidden on the start screen. */
export function DesktopPanelRail() {
  const projection = appCommandGraphPanelProjection.value
  if (currentDesign.value === null) return null
  return <PanelRail label={t('panelRail.label')} groups={[projection.design, projection.planning]} />
}
