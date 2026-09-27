import type { MenuAction } from '../shell-commands/menus'
import { canShowSavedViews, currentSavedViews, goToSavedView } from './actions'
import { requestSavedViewThumbnail, savedViewThumbnail } from './thumbnails'

/** View › Saved views ▸: one entry per view of the open Design, in saved order, with its thumbnail. */
export function savedViewMenuActions(): MenuAction[] {
  const disabled = !canShowSavedViews()
  return currentSavedViews().map((view) => ({
    type: 'action',
    id: `view.goToView:${view.id}`,
    label: view.name,
    disabled,
    thumbnail: {
      source: () => {
        const thumbnail = savedViewThumbnail(view.id).value
        return { url: thumbnail.url, loading: thumbnail.status === 'loading' }
      },
      load: () => { requestSavedViewThumbnail(view) },
    },
    action: () => {
      goToSavedView(view.id)
    },
  }))
}
