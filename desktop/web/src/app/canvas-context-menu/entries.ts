import {
  canvasCommandAriaKeys,
  canvasCommandDefinitions,
  canvasCommandDisplayKey,
  type CanvasEditAction,
  type CanvasEditCommandDefinition,
} from '../canvas-commands'
import { formatShortcut } from '../shell-commands/shortcut-text'
import type { CanvasContextMenuRequest } from '../../canvas/runtime/app-adapter'
import type { CanvasDesignObjectSelectionModel } from '../../canvas/runtime/runtime'
import {
  selectionCommandAvailability,
  selectionIncludesPlants,
} from '../../canvas/runtime/interaction/contextual-selection-actions'
import type { PlantAppearanceAnchor, PlantAppearanceKind } from './state'
import type { MapSelectionSummary } from '../map-selection/summary'
import type { CalendarAddTarget } from '../timeline/calendar-request'
import { openRotateSelectionDialog } from '../rotate-selection/state'
import { loneEditableZoneId, openRenameZoneDialog } from '../rename-zone/state'

export type CanvasContextMenuItemId =
  | CanvasEditAction
  | 'plant-color'
  | 'plant-symbol'
  | 'toggle-plant-names'
  | 'species-details'
  | 'rename-zone'
  | 'add-to-calendar'
  | 'set-unit-cost'
  | 'place-plants-here'
  | 'turn-view-to-edge'
  | 'finish-shape'
  | 'profile-line'

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

/** Arrange ▸: stacking and grouping, one level down so the plant menu fits a short window. */
export interface CanvasContextMenuSubmenu {
  readonly id: 'arrange'
  readonly label: string
  /** Disabled while nothing in it applies. */
  readonly disabled: boolean
  readonly submenu: readonly CanvasContextMenuEntry[]
}

export type CanvasContextMenuEntry =
  | CanvasContextMenuCommand
  | CanvasContextMenuSubmenu
  | { readonly separator: true }

export interface CanvasContextMenuEntryOptions {
  readonly translate: (key: string) => string
  /** Settings › Keyboard: false hides character-key shortcuts (`]`, `[`), which no longer work. */
  readonly characterKeyShortcuts: boolean
  openPlantAppearance(kind: PlantAppearanceKind, anchor: PlantAppearanceAnchor): void
  /** What the selection chip says about the selection (its species); null on the empty map. */
  readonly summary: MapSelectionSummary | null
  /** Species details: the species' detail in the Plant catalog. */
  openSpeciesDetail(canonicalName: string): void
  /** Add to calendar…: the Calendar's new-action editor aimed at the selection. */
  addToCalendar(target: CalendarAddTarget): void
  /** Set unit cost…: the species' price field in the Budget. */
  setUnitCost(canonicalName: string): void
  /** Profile this line (Desktop's Site data, spec §1.10, U49 Q29); absent where there is no Site data. */
  readonly profileLine?: CanvasContextMenuProfileLine
}

/** What "Profile this line" needs from the edition that has Site data (app/lidar/profile.ts). */
export interface CanvasContextMenuProfileLine {
  /** False disables the entry, as the Site data Profile button: no elevation or height layer is shown. */
  readonly available: boolean
  /** Profiles the lone Line zone or Measure guide the menu acts on. */
  profile(target: { readonly kind: 'zone' | 'measurement-guide'; readonly id: string }): void
}

const SEPARATOR = { separator: true } as const

/**
 * The right-click menu for a request: the selection's commands in plain words
 * with their menu-bar shortcuts, or Paste and Select all on the empty map.
 * Every command runs on the request's scene-edit surface. During a polygon
 * draft that can finish, Finish shape leads every menu. On a zone's edge,
 * Turn view to this edge leads the empty map's menu and comes before Lock in
 * the selection's. While a gesture or tool transient is live, Cut and Delete
 * are disabled (U39). Where there is Site data, a lone Line zone or Measure
 * guide offers Profile this line after the zone's own entries.
 */
export function buildCanvasContextMenuEntries(
  request: CanvasContextMenuRequest,
  options: CanvasContextMenuEntryOptions,
): readonly CanvasContextMenuEntry[] {
  const { commands, selection, world } = request
  const edit = (id: CanvasEditAction, disabled: boolean, run: () => void, extra: Partial<CanvasContextMenuCommand> = {}) =>
    editCommand(id, disabled, run, options.translate, options.characterKeyShortcuts, extra)
  const paste = edit('paste', !commands.canPaste(), () => commands.pasteAt(world))
  // Turn view to this edge (spec §4.16): only when the menu opened on a zone's edge; it moves the view, never an object,
  // so a locked zone keeps it enabled.
  const turnViewToEdge = request.turnViewToEdge
  const edgeEntries: readonly CanvasContextMenuEntry[] = turnViewToEdge
    ? [{
        id: 'turn-view-to-edge',
        label: options.translate('canvas.contextMenu.turnViewToEdge'),
        disabled: false,
        run: () => turnViewToEdge(),
      }, SEPARATOR]
    : []
  // Finish shape (spec §3.2): a polygon draft that can finish leads every menu with it.
  const finishShape = request.finishShape
  const finishEntries: readonly CanvasContextMenuEntry[] = finishShape
    ? [{
        id: 'finish-shape',
        label: options.translate('canvas.contextMenu.finishShape'),
        disabled: false,
        run: () => finishShape(),
      }, SEPARATOR]
    : []

  if (!selection) {
    const placePlantsAt = request.placePlantsAt
    return [
      ...finishEntries,
      ...edgeEntries,
      ...placePlantsAt
        ? [{
            id: 'place-plants-here' as const,
            label: options.translate('canvas.contextMenu.placePlantsHere'),
            disabled: false,
            run: () => placePlantsAt(world),
          }, SEPARATOR]
        : [],
      paste,
      edit('select-all', false, () => commands.selectAll()),
    ]
  }

  const can = selectionCommandAvailability(selection)
  // Cut and Delete wait while a gesture or tool transient is live, as Delete and Ctrl+X do (U39).
  const deletable = can.copy && !request.holdsSelectionDeletes
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
  const species = options.summary?.species ?? []
  const oneSpecies = species.length === 1 ? species[0]!.canonicalName : null
  const plants = selectionIncludesPlants(selection)
  const plain = <T,>(
    id: CanvasContextMenuItemId,
    labelKey: string,
    target: T | null,
    run: (target: T) => void,
  ): CanvasContextMenuCommand => ({
    id,
    label: options.translate(labelKey),
    disabled: target === null,
    run: () => {
      if (target !== null) run(target)
    },
  })
  const calendarTarget = calendarTargetFor(selection)
  const planningEntries: readonly CanvasContextMenuEntry[] = [
    plain('add-to-calendar', 'canvas.contextMenu.addToCalendar', calendarTarget, options.addToCalendar),
    ...plants ? [plain('set-unit-cost', 'canvas.contextMenu.setUnitCost', oneSpecies, options.setUnitCost)] : [],
    SEPARATOR,
  ]
  const plantEntries: readonly CanvasContextMenuEntry[] = plants
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
        plain('species-details', 'canvas.contextMenu.speciesDetails', oneSpecies, options.openSpeciesDetail),
        SEPARATOR,
      ]
    : []

  // Rename zone… names one lone zone; a locked one keeps the item, disabled.
  const loneZone = calendarTarget?.kind === 'zone' ? calendarTarget.zoneId : null
  const renameZoneId = loneEditableZoneId(selection)
  const zoneEntries: readonly CanvasContextMenuEntry[] = loneZone === null
    ? []
    : [{
        id: 'rename-zone',
        label: options.translate('canvas.contextMenu.renameZone'),
        disabled: renameZoneId === null,
        run: () => {
          if (renameZoneId === null) return
          openRenameZoneDialog({
            zoneId: renameZoneId,
            name: options.summary?.zones[0]?.name ?? null,
            rename: (zoneId, name) => commands.renameZone(zoneId, name),
            returnFocus: () => request.returnFocus(),
          })
        },
      }, SEPARATOR]

  // Profile this line: a lone Line zone or Measure guide, locked or not, since a profile edits nothing.
  const lineTarget = profileLineTarget(selection, options.summary)
  const profileLine = options.profileLine
  const profileEntries: readonly CanvasContextMenuEntry[] = profileLine && lineTarget
    ? [{
        id: 'profile-line',
        label: options.translate('canvas.contextMenu.profileLine'),
        disabled: !profileLine.available,
        run: () => {
          if (profileLine.available) profileLine.profile(lineTarget)
        },
      }, SEPARATOR]
    : []

  const arrange = [
    edit('bring-to-front', !can.edit, () => commands.bringToFront()),
    edit('send-to-back', !can.edit, () => commands.sendToBack()),
    SEPARATOR,
    edit('group', !can.group, () => commands.groupSelected()),
    edit('ungroup', !can.ungroup, () => commands.ungroupSelected()),
  ]

  return [
    ...finishEntries,
    edit('cut', !deletable, () => {
      commands.copy()
      commands.deleteSelected()
    }),
    edit('copy', !can.copy, () => commands.copy()),
    paste,
    edit('duplicate', !can.edit, () => commands.duplicateSelected()),
    SEPARATOR,
    ...plantEntries,
    ...zoneEntries,
    ...profileEntries,
    ...planningEntries,
    {
      id: 'arrange',
      label: options.translate('menu.edit.arrange'),
      disabled: arrange.every((entry) => 'separator' in entry || entry.disabled),
      submenu: arrange,
    },
    edit('rotate', !can.rotate, () => openRotateSelectionDialog({
      rotate: (degrees) => commands.rotateSelected(degrees),
      returnFocus: () => request.returnFocus(),
    })),
    ...request.saveSelectionAsObjectStamp
      ? [edit('save-as-stamp', !can.saveAsStamp, request.saveSelectionAsObjectStamp)]
      : [],
    SEPARATOR,
    ...edgeEntries,
    edit('lock', !can.edit, () => commands.lockSelected()),
    edit('unlock', !can.unlock, () => commands.unlockSelected()),
    SEPARATOR,
    edit('delete', !deletable, () => commands.deleteSelected(), { danger: true }),
  ]
}

function editCommand(
  id: CanvasEditAction,
  disabled: boolean,
  run: () => void,
  translate: (key: string) => string,
  characterKeys: boolean,
  extra: Partial<CanvasContextMenuCommand>,
): CanvasContextMenuCommand {
  const definition = canvasCommandDefinitions.find(
    (candidate): candidate is CanvasEditCommandDefinition => candidate.kind === 'edit' && candidate.id === id,
  )
  if (!definition) throw new Error(`Missing Canvas edit command '${id}'`)
  // Only real shortcuts: Deselect's Esc hint belongs to the map, not this menu.
  const shortcut = definition.shortcuts ? canvasCommandDisplayKey(definition, characterKeys) : undefined
  return {
    id,
    label: translate(definition.labelKey),
    ...(shortcut
      ? {
          shortcut: formatShortcut(shortcut, translate),
          keyShortcuts: canvasCommandAriaKeys(definition, characterKeys),
        }
      : {}),
    disabled,
    run: () => {
      if (!disabled) run()
    },
    ...extra,
  }
}

/**
 * Add to calendar… aims at the selected plants (the Calendar's "Selected on
 * map" target, editable plants only), else at one lone zone; null otherwise.
 */
function calendarTargetFor(selection: CanvasDesignObjectSelectionModel): CalendarAddTarget | null {
  if (selection.plantNamePinning.plantIds.length > 0) return { kind: 'selected-plants' }
  const targets = [...selection.editableTargets, ...selection.lockedTargets]
  const [only] = targets
  return targets.length === 1 && only?.kind === 'zone' ? { kind: 'zone', zoneId: only.id } : null
}

/** The lone Line zone or Measure guide a menu acts on, or null. */
function profileLineTarget(
  selection: CanvasDesignObjectSelectionModel,
  summary: MapSelectionSummary | null,
): { readonly kind: 'zone' | 'measurement-guide'; readonly id: string } | null {
  const targets = [...selection.editableTargets, ...selection.lockedTargets]
  const [only] = targets
  if (targets.length !== 1 || !only) return null
  if (only.kind === 'measurement-guide') return { kind: 'measurement-guide', id: only.id }
  return only.kind === 'zone' && summary?.zones.length === 1 && summary.zones[0]!.zoneType === 'line'
    ? { kind: 'zone', id: only.id }
    : null
}
