import { getCurrentWindow } from '@tauri-apps/api/window'
import { t } from '../../i18n'
import { getCurrentCanvasSession } from '../../canvas/session'
import {
  saveCurrentDesign,
  saveAsCurrentDesign,
  openDesign,
  newDesignAction,
} from '../../app/document-session/actions'
import { currentDesign, designDirty } from '../../state/design'
import { FILE_SHORTCUTS, EDIT_SHORTCUTS, VIEW_SHORTCUTS } from '../../shortcuts/definitions'

export interface MenuAction {
  type: 'action'
  id: string
  label: string
  shortcut?: string
  action: () => void
  disabled: boolean
}

export interface MenuSeparator {
  type: 'separator'
}

export type MenuEntry = MenuAction | MenuSeparator

export interface MenuDefinition {
  id: string
  label: string
  items: MenuEntry[]
}

const separator: MenuSeparator = { type: 'separator' }

export function getMenuDefinitions(): MenuDefinition[] {
  const session = getCurrentCanvasSession()
  const hasDesign = currentDesign.value != null
  const hasSession = session != null

  return [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        { type: 'action', id: 'file.new', label: t('menu.file.new'), shortcut: FILE_SHORTCUTS.newDesign, action: () => { void newDesignAction() }, disabled: false },
        { type: 'action', id: 'file.open', label: t('menu.file.open'), shortcut: FILE_SHORTCUTS.openDesign, action: () => { void openDesign() }, disabled: false },
        separator,
        { type: 'action', id: 'file.save', label: t('menu.file.save'), shortcut: FILE_SHORTCUTS.saveDesign, action: () => { void saveCurrentDesign() }, disabled: !hasDesign || !designDirty.value },
        { type: 'action', id: 'file.saveAs', label: t('menu.file.saveAs'), shortcut: FILE_SHORTCUTS.saveDesignAs, action: () => { void saveAsCurrentDesign() }, disabled: !hasDesign },
        separator,
        { type: 'action', id: 'file.exit', label: t('menu.file.exit'), action: () => { void getCurrentWindow().close() }, disabled: false },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        { type: 'action', id: 'edit.undo', label: t('menu.edit.undo'), shortcut: EDIT_SHORTCUTS.undo, action: () => { session?.undo() }, disabled: !hasSession || !session.canUndo.value },
        { type: 'action', id: 'edit.redo', label: t('menu.edit.redo'), shortcut: EDIT_SHORTCUTS.redo, action: () => { session?.redo() }, disabled: !hasSession || !session.canRedo.value },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        { type: 'action', id: 'view.zoomIn', label: t('menu.view.zoomIn'), shortcut: VIEW_SHORTCUTS.zoomIn, action: () => { session?.zoomIn() }, disabled: !hasSession },
        { type: 'action', id: 'view.zoomOut', label: t('menu.view.zoomOut'), shortcut: VIEW_SHORTCUTS.zoomOut, action: () => { session?.zoomOut() }, disabled: !hasSession },
        { type: 'action', id: 'view.fitToContent', label: t('menu.view.fitToContent'), shortcut: VIEW_SHORTCUTS.fitToContent, action: () => { session?.zoomToFit() }, disabled: !hasSession },
      ],
    },
  ]
}
