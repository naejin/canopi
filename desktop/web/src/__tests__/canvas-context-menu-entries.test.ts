import { describe, expect, it, vi } from 'vitest'
import {
  buildCanvasContextMenuEntries,
  type CanvasContextMenuCommand,
  type CanvasContextMenuEntry,
  type CanvasContextMenuEntryOptions,
  type CanvasContextMenuItemId,
} from '../app/canvas-context-menu/entries'
import type {
  CanvasContextMenuCommands,
  CanvasContextMenuRequest,
} from '../canvas/runtime/app-adapter'
import type { CanvasDesignObjectSelectionModel } from '../canvas/runtime/runtime'
import { t } from '../i18n'

function createCommands(overrides: Partial<CanvasContextMenuCommands> = {}): CanvasContextMenuCommands {
  return {
    copy: vi.fn(),
    pasteAt: vi.fn(),
    canPaste: vi.fn(() => true),
    duplicateSelected: vi.fn(),
    toggleSelectedPlantNamePins: vi.fn(),
    deleteSelected: vi.fn(),
    selectAll: vi.fn(),
    selectSameSpecies: vi.fn(),
    bringToFront: vi.fn(),
    sendToBack: vi.fn(),
    lockSelected: vi.fn(),
    unlockSelected: vi.fn(),
    groupSelected: vi.fn(),
    ungroupSelected: vi.fn(),
    ...overrides,
  }
}

function selection(overrides: Partial<CanvasDesignObjectSelectionModel> = {}): CanvasDesignObjectSelectionModel {
  return {
    editableTargets: [],
    lockedTargets: [],
    blockedTargets: [],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    sameSpeciesReferenceCanonicalName: null,
    ...overrides,
  }
}

const TWO_APPLES = selection({
  editableTargets: [{ kind: 'plant', id: 'apple-1' }, { kind: 'plant', id: 'apple-2' }],
  sameSpeciesReferenceCanonicalName: 'Malus domestica',
  plantNamePinning: { plantIds: ['apple-1', 'apple-2'], allPinned: false },
})

const ONE_ZONE = selection({ editableTargets: [{ kind: 'zone', id: 'zone-1' }] })

const PLANT_AND_ZONE = selection({
  editableTargets: [{ kind: 'plant', id: 'apple-1' }, { kind: 'zone', id: 'zone-1' }],
  plantNamePinning: { plantIds: ['apple-1'], allPinned: true },
})

function build(
  model: CanvasDesignObjectSelectionModel | null,
  options: {
    readonly commands?: CanvasContextMenuCommands
    readonly saveSelectionAsObjectStamp?: () => void
    readonly openPlantAppearance?: CanvasContextMenuEntryOptions['openPlantAppearance']
    readonly returnFocus?: () => void
  } = {},
) {
  const commands = options.commands ?? createCommands()
  const openPlantAppearance = options.openPlantAppearance ?? vi.fn()
  const request: CanvasContextMenuRequest = {
    anchor: { left: 300, top: 200, right: 300, bottom: 200 },
    world: { x: 12, y: 34 },
    selection: model,
    commands,
    ...(options.saveSelectionAsObjectStamp ? { saveSelectionAsObjectStamp: options.saveSelectionAsObjectStamp } : {}),
    returnFocus: options.returnFocus ?? vi.fn(),
  }
  const entries = buildCanvasContextMenuEntries(request, { translate: t, openPlantAppearance })
  return { entries, commands, openPlantAppearance, request }
}

function ids(entries: readonly CanvasContextMenuEntry[]): string[] {
  return entries.map((entry) => 'separator' in entry ? '—' : entry.id)
}

function item(entries: readonly CanvasContextMenuEntry[], id: CanvasContextMenuItemId): CanvasContextMenuCommand {
  const found = entries.find((entry): entry is CanvasContextMenuCommand => 'id' in entry && entry.id === id)
  if (!found) throw new Error(`missing ${id}`)
  return found
}

describe('canvas context menu entries', () => {
  it('lists plant commands in plain words, grouped, with Delete last and in red', () => {
    const { entries } = build(TWO_APPLES, { saveSelectionAsObjectStamp: vi.fn() })

    expect(ids(entries)).toEqual([
      'cut', 'copy', 'paste', 'duplicate', '—',
      'select-same-species', 'plant-color', 'plant-symbol', 'toggle-plant-names', '—',
      'bring-to-front', 'send-to-back', '—',
      'group', 'ungroup', 'save-as-stamp', '—',
      'lock', 'unlock', '—',
      'delete',
    ])
    const labels = entries.flatMap((entry) => 'label' in entry ? [entry.label] : [])
    expect(labels).toEqual([
      'Cut', 'Copy', 'Paste', 'Duplicate',
      'Select all of this species', 'Plant color', 'Plant symbol', 'Show name',
      'Bring to front', 'Send to back',
      'Group', 'Ungroup', 'Save as stamp',
      'Lock', 'Unlock',
      'Delete',
    ])
    expect(item(entries, 'delete').danger).toBe(true)
    expect(entries.filter((entry) => 'danger' in entry && entry.danger)).toHaveLength(1)
    expect(item(entries, 'plant-color').opensDialog).toBe(true)
    expect(item(entries, 'plant-symbol').opensDialog).toBe(true)
  })

  it('shows the menu-bar shortcuts beside each command', () => {
    const { entries } = build(TWO_APPLES)

    expect(item(entries, 'cut').shortcut).toBe('Ctrl X')
    expect(item(entries, 'copy').shortcut).toBe('Ctrl C')
    expect(item(entries, 'paste').shortcut).toBe('Ctrl V')
    expect(item(entries, 'duplicate').shortcut).toBe('Ctrl D')
    expect(item(entries, 'select-same-species').shortcut).toBe('Ctrl Shift A')
    expect(item(entries, 'bring-to-front').shortcut).toBe(']')
    expect(item(entries, 'group').shortcut).toBe('Ctrl G')
    expect(item(entries, 'lock').shortcut).toBe('Ctrl Shift L')
    expect(item(entries, 'lock').keyShortcuts).toBe('Control+Shift+L Meta+Shift+L')
    expect(item(entries, 'delete').shortcut).toBe('Del')
    expect(item(entries, 'delete').keyShortcuts).toBe('Delete Backspace')
    expect(item(entries, 'copy').keyShortcuts).toBe('Control+C Meta+C')
  })

  it('leaves plant commands out for zones', () => {
    const { entries } = build(ONE_ZONE)

    expect(ids(entries)).not.toContain('select-same-species')
    expect(ids(entries)).not.toContain('plant-color')
    expect(ids(entries)).not.toContain('plant-symbol')
    expect(ids(entries)).not.toContain('toggle-plant-names')
    expect(ids(entries)).not.toContain('save-as-stamp')
    expect(item(entries, 'duplicate').disabled).toBe(false)
    expect(item(entries, 'group').disabled).toBe(true)
    expect(item(entries, 'ungroup').disabled).toBe(true)
    expect(item(entries, 'unlock').disabled).toBe(true)
  })

  it('keeps plant commands for a mixed selection, disabling Select all of this species', () => {
    const { entries } = build(PLANT_AND_ZONE)

    expect(item(entries, 'select-same-species').disabled).toBe(true)
    expect(item(entries, 'plant-color').disabled).toBe(false)
    expect(item(entries, 'plant-symbol').disabled).toBe(false)
    expect(item(entries, 'toggle-plant-names').label).toBe('Hide name')
    expect(item(entries, 'group').disabled).toBe(false)
  })

  it('offers only Paste and Select all on the empty map', () => {
    const { entries, commands } = build(null)

    expect(ids(entries)).toEqual(['paste', 'select-all'])
    item(entries, 'paste').run()
    item(entries, 'select-all').run()
    expect(commands.pasteAt).toHaveBeenCalledWith({ x: 12, y: 34 })
    expect(commands.selectAll).toHaveBeenCalledOnce()
    expect(item(build(null, { commands: createCommands({ canPaste: () => false }) }).entries, 'paste').disabled)
      .toBe(true)
  })

  it('keeps inapplicable commands visible but disabled, and running them does nothing', () => {
    const locked = selection({
      lockedTargets: [{ kind: 'plant', id: 'locked-apple' }],
      blockedTargets: [{
        target: { kind: 'plant', id: 'locked-apple' },
        reason: 'locked-design-object',
        layerName: 'plants',
      }],
      plantNamePinning: { plantIds: [], allPinned: false },
    })
    const commands = createCommands({ canPaste: () => false })
    const { entries } = build(locked, { commands, saveSelectionAsObjectStamp: vi.fn() })

    const enabled = entries.flatMap((entry) => 'id' in entry && !entry.disabled ? [entry.id] : [])
    expect(enabled).toEqual(['save-as-stamp', 'unlock'])
    for (const entry of entries) {
      if ('id' in entry && entry.disabled) entry.run()
    }
    for (const command of Object.values(commands)) {
      if (command !== commands.canPaste) expect(command).not.toHaveBeenCalled()
    }
  })

  it('runs each command on the request’s scene-edit surface', () => {
    const save = vi.fn()
    const commands = createCommands()
    const withGroups = selection({
      editableTargets: [{ kind: 'group', id: 'group-1' }, { kind: 'plant', id: 'apple-1' }],
      sameSpeciesReferenceCanonicalName: 'Malus domestica',
      plantNamePinning: { plantIds: ['apple-1'], allPinned: false },
    })
    const { entries } = build(withGroups, { commands, saveSelectionAsObjectStamp: save })
    const run = (id: CanvasContextMenuItemId) => item(entries, id).run()

    run('copy')
    expect(commands.copy).toHaveBeenCalledOnce()
    run('cut')
    expect(commands.copy).toHaveBeenCalledTimes(2)
    expect(commands.deleteSelected).toHaveBeenCalledOnce()
    run('paste')
    expect(commands.pasteAt).toHaveBeenCalledWith({ x: 12, y: 34 })
    run('duplicate')
    expect(commands.duplicateSelected).toHaveBeenCalledOnce()
    run('select-same-species')
    expect(commands.selectSameSpecies).toHaveBeenCalledOnce()
    run('toggle-plant-names')
    expect(commands.toggleSelectedPlantNamePins).toHaveBeenCalledOnce()
    run('bring-to-front')
    expect(commands.bringToFront).toHaveBeenCalledOnce()
    run('send-to-back')
    expect(commands.sendToBack).toHaveBeenCalledOnce()
    run('group')
    expect(commands.groupSelected).toHaveBeenCalledOnce()
    run('ungroup')
    expect(commands.ungroupSelected).toHaveBeenCalledOnce()
    run('save-as-stamp')
    expect(save).toHaveBeenCalledOnce()
    run('lock')
    expect(commands.lockSelected).toHaveBeenCalledOnce()
    run('delete')
    expect(commands.deleteSelected).toHaveBeenCalledTimes(2)
  })

  it('opens the plant color and symbol popovers beside the item, returning focus to the map', () => {
    const openPlantAppearance = vi.fn<CanvasContextMenuEntryOptions['openPlantAppearance']>()
    const returnFocus = vi.fn()
    const { entries } = build(TWO_APPLES, { openPlantAppearance, returnFocus })

    item(entries, 'plant-color').run({ left: 400, top: 250, right: 600, bottom: 280 } as DOMRect)
    expect(openPlantAppearance).toHaveBeenCalledWith('color', expect.anything())
    const anchor = openPlantAppearance.mock.calls[0]![1]
    expect(anchor.getBoundingClientRect()).toEqual({ top: 250, right: 600 })
    anchor.focus()
    expect(returnFocus).toHaveBeenCalledOnce()

    item(entries, 'plant-symbol').run()
    expect(openPlantAppearance).toHaveBeenLastCalledWith('symbol', expect.anything())
    expect(openPlantAppearance.mock.calls[1]![1].getBoundingClientRect()).toEqual({ top: 200, right: 300 })
  })

  it('disables Group for measurement guides and blocked selections, and offers Ungroup only for groups', () => {
    const guide = build(selection({
      editableTargets: [{ kind: 'plant', id: 'p' }, { kind: 'measurement-guide', id: 'g' }],
    })).entries
    expect(item(guide, 'group').disabled).toBe(true)

    const blocked = build(selection({
      editableTargets: [{ kind: 'group', id: 'group-1' }, { kind: 'plant', id: 'p' }],
      blockedTargets: [{ target: { kind: 'plant', id: 'missing' }, reason: 'missing-design-object', layerName: null }],
    })).entries
    expect(item(blocked, 'group').disabled).toBe(true)
    expect(item(blocked, 'ungroup').disabled).toBe(true)

    const group = build(selection({ editableTargets: [{ kind: 'group', id: 'group-1' }] })).entries
    expect(item(group, 'group').disabled).toBe(true)
    expect(item(group, 'ungroup').disabled).toBe(false)
  })
})
