import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activeTool } from '../canvas/session-state'
import { activePanel, sidePanel } from '../app/shell/state'
import { settingsHydrated } from '../app/settings/persistence'
import { settingsDraft } from '../app/settings/controller'
import { settingsModalOpen } from '../app/settings/modal-state'
import * as documentActions from '../app/document-session/actions'
import { handleSettingsModalShortcut, initShortcuts } from '../shortcuts/manager'
import { setCurrentCanvasSession } from '../canvas/session'

describe('shortcut manager canvas tool switching', () => {
  beforeEach(() => {
    activePanel.value = 'canvas'
    sidePanel.value = null
    activeTool.value = 'select'
    settingsHydrated.value = true
    settingsDraft.value = null
    settingsModalOpen.value = false
    setCurrentCanvasSession(null)
    initShortcuts()
  })

  afterEach(() => {
    setCurrentCanvasSession(null)
    activeTool.value = 'select'
    settingsHydrated.value = false
    settingsDraft.value = null
    settingsModalOpen.value = false
  })

  it('routes tool shortcuts through the live canvas session when mounted', () => {
    const setTool = vi.fn()
    setCurrentCanvasSession({
      setTool,
    } as any)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r' }))

    expect(setTool).toHaveBeenCalledWith('rectangle')
    expect(activeTool.value).toBe('rectangle')
  })

  it('falls back to priming the mirror tool state before session mount', () => {
    setCurrentCanvasSession(null)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }))

    expect(activeTool.value).toBe('text')
  })

  it('keeps panel shortcuts aligned with the command registry mapping', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '2', ctrlKey: true }))

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe('plant-db')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true }))

    expect(activePanel.value).toBe('canvas')
    expect(sidePanel.value).toBe(null)
  })

  it('routes file shortcuts through document-session actions', () => {
    const saveSpy = vi.spyOn(documentActions, 'saveCurrentDesign').mockResolvedValue(undefined)
    const saveAsSpy = vi.spyOn(documentActions, 'saveAsCurrentDesign').mockResolvedValue(undefined)
    const openSpy = vi.spyOn(documentActions, 'openDesign').mockResolvedValue(undefined)
    const newSpy = vi.spyOn(documentActions, 'newDesignAction').mockResolvedValue(undefined)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'S', ctrlKey: true, shiftKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }))

    expect(saveSpy).toHaveBeenCalledTimes(1)
    expect(saveAsSpy).toHaveBeenCalledTimes(1)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(newSpy).toHaveBeenCalledTimes(1)
  })

  it('opens the settings modal with Ctrl+,', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))

    expect(settingsModalOpen.value).toBe(true)
    expect(settingsDraft.value).not.toBeNull()
  })

  it('consumes modal shortcuts before app-level shortcuts', async () => {
    type ModalShortcutEvent = Parameters<typeof handleSettingsModalShortcut>[0]

    settingsModalOpen.value = true
    settingsDraft.value = {
      preferences: {
        theme: 'light',
        locale: 'en',
        checkUpdatesEnabled: true,
        updateChannel: 'stable',
      },
      currentDesign: {
        enabled: false,
        sourceDesign: null,
        name: '',
        description: '',
      },
    }
    const preventDefault = vi.fn()

    const saveHandled = handleSettingsModalShortcut({
      key: 's',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      preventDefault,
    } as ModalShortcutEvent)
    await Promise.resolve()
    await Promise.resolve()

    expect(saveHandled).toBe(true)
    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(settingsModalOpen.value).toBe(false)

    settingsModalOpen.value = true
    const suppressed = handleSettingsModalShortcut({
      key: 'n',
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
      preventDefault: vi.fn(),
    } as ModalShortcutEvent)

    expect(suppressed).toBe(true)
  })
})
