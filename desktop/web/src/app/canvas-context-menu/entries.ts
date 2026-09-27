import {
  canvasCommandDefinitions,
  type CanvasEditAction,
  type CanvasEditCommandDefinition,
} from '../canvas-commands'
import { ariaKeyShortcuts, formatShortcut } from '../shell-commands/shortcut-text'
import type { CanvasContextMenuRequest } from '../../canvas/runtime/app-adapter'
import {
  selectionCommandAvailability,
  selectionIncludesPlants,
} from '../../canvas/runtime/interaction/contextual-selection-actions'
import type { PlantAppearanceAnchor, PlantAppearanceKind } from './state'

export type CanvasContextMenuItemId =
  | CanvasEditAction
  | 'plant-color'
  | 'plant-symbol'
  | 'toggle-plant-names'

export interface CanvasContextMenuCommand {
  readonly id: CanvasContextMenuItemId
  readonly label: string
  readonly shortcut?: string
  readonly keyShortcuts?: string
  /** Inapplicable commands stay listed and focusable, but do nothing. */
  readonly disabled: boolean
  readonly danger?: boolean
  readonly opensDialog?: boolean
  run(itemBounds?: DOMRect): void
}

export type CanvasContextMenuEntry = CanvasContextMenuCommand | { readonly separator: true }

export interface CanvasContextMenuEntryOptions {
  readonly translate: (key: string) => string
  openPlantAppearance(kind: PlantAppearanceKind, anchor: PlantAppearanceAnchor): void
}

const SEPARATOR = { separator: true } as const

/**
 * The right-click menu for a request: the selection's commands in plain words
 * with their menu-bar shortcuts, or Paste and Select all on the empty map.
 * Every command runs on the request's scene-edit surface.
 */
export function buildCanvasContextMenuEntries(
  request: CanvasContextMenuRequest,
  options: CanvasContextMenuEntryOptions,
): readonly CanvasContextMenuEntry[] {
  const { commands, selection, world } = request
  const edit = (id: CanvasEditAction, disabled: boolean, run: () => void, extra: Partial<CanvasContextMenuCommand> = {}) =>
    editCommand(id, disabled, run, options.translate, extra)
  const paste = edit('paste', !commands.canPaste(), () => commands.pasteAt(world))

  if (!selection) {
    return [paste, edit('select-all', false, () => commands.selectAll())]
  }

  const can = selectionCommandAvailability(selection)
  const appearance = (kind: PlantAppearanceKind, labelKey: string): CanvasContextMenuCommand => ({
    id: kind === 'color' ? 'plant-color' : 'plant-symbol',
    label: options.translate(labelKey),
    disabled: !can.plantAppearance,
    opensDialog: true,
    run: (itemBounds) => {
      if (!can.plantAppearance) return
      const bounds = itemBounds ?? request.anchor
      options.openPlantAppearance(kind, {
        getBoundingClientRect: () => ({ top: bounds.top, right: bounds.right }),
        focus: () => request.returnFocus(),
      })
    },
  })
  const plantEntries: readonly CanvasContextMenuEntry[] = selectionIncludesPlants(selection)
    ? [
        edit('select-same-species', !can.selectSameSpecies, () => commands.selectSameSpecies()),
        appearance('color', 'canvas.plantColor.label'),
        appearance('symbol', 'canvas.plantSymbol.label'),
        {
          id: 'toggle-plant-names',
          label: options.translate(can.plantNamesPinned ? 'canvas.contextMenu.hideName' : 'canvas.contextMenu.showName'),
          disabled: !can.plantAppearance,
          run: () => {
            if (can.plantAppearance) commands.toggleSelectedPlantNamePins()
          },
        },
        SEPARATOR,
      ]
    : []

  return [
    edit('cut', !can.copy, () => {
      commands.copy()
      commands.deleteSelected()
    }),
    edit('copy', !can.copy, () => commands.copy()),
    paste,
    edit('duplicate', !can.edit, () => commands.duplicateSelected()),
    SEPARATOR,
    ...plantEntries,
    edit('bring-to-front', !can.edit, () => commands.bringToFront()),
    edit('send-to-back', !can.edit, () => commands.sendToBack()),
    SEPARATOR,
    edit('group', !can.group, () => commands.groupSelected()),
    edit('ungroup', !can.ungroup, () => commands.ungroupSelected()),
    ...request.saveSelectionAsObjectStamp
      ? [edit('save-as-stamp', !can.saveAsStamp, request.saveSelectionAsObjectStamp)]
      : [],
    SEPARATOR,
    edit('lock', !can.edit, () => commands.lockSelected()),
    edit('unlock', !can.unlock, () => commands.unlockSelected()),
    SEPARATOR,
    edit('delete', !can.copy, () => commands.deleteSelected(), { danger: true }),
  ]
}

function editCommand(
  id: CanvasEditAction,
  disabled: boolean,
  run: () => void,
  translate: (key: string) => string,
  extra: Partial<CanvasContextMenuCommand>,
): CanvasContextMenuCommand {
  const definition = canvasCommandDefinitions.find(
    (candidate): candidate is CanvasEditCommandDefinition => candidate.kind === 'edit' && candidate.id === id,
  )
  if (!definition) throw new Error(`Missing Canvas edit command '${id}'`)
  const shortcut = definition.shortcuts?.[0]
  return {
    id,
    label: translate(definition.labelKey),
    ...(shortcut
      ? {
          shortcut: formatShortcut(shortcut, translate),
          keyShortcuts: definition.shortcuts?.map(ariaKeyShortcuts).join(' '),
        }
      : {}),
    disabled,
    run: () => {
      if (!disabled) run()
    },
    ...extra,
  }
}
