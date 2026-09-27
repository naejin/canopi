import { buildCanvasContextMenuEntries } from '../../app/canvas-context-menu/entries'
import {
  canvasContextMenuRequest,
  closeCanvasContextMenu,
  openPlantAppearance,
} from '../../app/canvas-context-menu/state'
import { t } from '../../i18n'
import { ContextMenu } from '../shared/ActionMenu'

/**
 * The map's right-click menu. The canvas runtime opens it (pointer, Menu key
 * or Shift F10) with the selection it acts on; each item runs a scene edit.
 */
export function CanvasContextMenu() {
  const request = canvasContextMenuRequest.value
  if (!request) return null
  const entries = buildCanvasContextMenuEntries(request, { translate: t, openPlantAppearance })
  return (
    <ContextMenu
      // A new request is a new menu: it re-anchors and focuses its first item.
      key={requestKey(request)}
      label={t('canvas.contextMenu.ariaLabel')}
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
