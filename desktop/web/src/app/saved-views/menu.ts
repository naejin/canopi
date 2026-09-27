import type { MenuAction } from '../shell-commands/menus'
import { canShowSavedViews, currentSavedViews, goToSavedView } from './actions'

/** View › Saved views ▸: one entry per view of the open Design, in saved order. */
export function savedViewMenuActions(): MenuAction[] {
  const disabled = !canShowSavedViews()
  return currentSavedViews().map((view) => ({
    type: 'action',
    id: `view.goToView:${view.id}`,
    label: view.name,
    disabled,
    action: () => {
      goToSavedView(view.id)
    },
  }))
}
