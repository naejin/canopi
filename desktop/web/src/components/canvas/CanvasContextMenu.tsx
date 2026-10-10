import { buildCanvasContextMenuEntries, type CanvasContextMenuProfileLine } from '../../app/canvas-context-menu/entries'
import {
  canvasContextMenuRequest,
  closeCanvasContextMenu,
  openPlantAppearance,
} from '../../app/canvas-context-menu/state'
import { requestBudgetPrice } from '../../app/budget/price-request'
import { useMapSelectionSummary } from '../../app/map-selection/summary'
import { mapSelectionHeading } from '../../app/map-selection/summary-text'
import { openSpeciesDetail } from '../../app/plant-detail/actions'
import { locale, singleKeyShortcuts } from '../../app/settings/state'
import { requestCalendarAdd } from '../../app/timeline/calendar-request'
import type { CanvasContextMenuRequest } from '../../canvas/runtime/app-adapter'
import { t } from '../../i18n'
import { ContextMenu } from '../shared/ActionMenu'

/**
 * The map's right-click menu. The canvas runtime opens it (pointer, Menu key
 * or Shift F10) with the selection it acts on; each item runs a scene edit or
 * opens the panel that owns the rest. A heading names the selection in the
 * selection chip's words. The edition with Site data (Desktop) hands over "Profile this line"; the Web entry graph must
 * not import app/lidar.
 */
export function CanvasContextMenu({ profileLine }: { readonly profileLine?: CanvasContextMenuProfileLine }) {
  const request = canvasContextMenuRequest.value
  if (!request) return null
  return <OpenCanvasContextMenu request={request} profileLine={profileLine} />
}

function OpenCanvasContextMenu({ request, profileLine }: {
  readonly request: CanvasContextMenuRequest
  readonly profileLine?: CanvasContextMenuProfileLine
}) {
  // Right-click retargets the selection first, so the chip's summary is the request's selection. A request with no
  // targets (an object on a locked layer) names nothing: the app's selection is not what the menu acts on.
  const selectionSummary = useMapSelectionSummary()
  const targets = request.selection ? request.selection.editableTargets.length + request.selection.lockedTargets.length : 0
  const summary = targets ? selectionSummary : null
  const heading = summary ? mapSelectionHeading(summary, locale.value) : null
  const entries = buildCanvasContextMenuEntries(request, {
    translate: t,
    characterKeyShortcuts: singleKeyShortcuts.value,
    openPlantAppearance,
    summary,
    openSpeciesDetail,
    addToCalendar: requestCalendarAdd,
    setUnitCost: requestBudgetPrice,
    profileLine,
  })
  return (
    <ContextMenu
      // A new request is a new menu: it re-anchors and focuses its first item.
      key={requestKey(request)}
      label={heading ?? t('canvas.contextMenu.ariaLabel')}
      heading={heading ?? undefined}
      entries={entries}
      anchor={request.anchor}
      onClose={(restoreFocus) => {
        closeCanvasContextMenu(request)
        if (restoreFocus) request.returnFocus()
      }}
    />
  )
}

const requestKeys = new WeakMap<object, number>()
let nextRequestKey = 0

function requestKey(request: object): number {
  let key = requestKeys.get(request)
  if (key === undefined) {
    key = nextRequestKey++
    requestKeys.set(request, key)
  }
  return key
}
