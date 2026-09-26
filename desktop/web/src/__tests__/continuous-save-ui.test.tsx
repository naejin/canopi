import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  answerSaveProblem,
  requestSaveProblemDecision,
  saveProblem,
} from '../app/document-session/save-problem'
import { createDesignDraftsController } from '../app/design-drafts'
import { locale } from '../app/settings/state'
import { DraftList } from '../components/shared/DraftList'
import { SaveProblemDialog } from '../components/shared/SaveProblemDialog'
import { CommandPalette } from '../components/shared/CommandPalette'
import { commandPaletteOpen } from '../commands/registry'
import { SaveStatusLabel } from '../components/shared/SaveStatusLabel'
import { createMemoryDesignSessionStore } from '../app/document-session/store'
import { createBrowserAppDataStore } from '../web/browser-app-data'
import { createBrowserDesignSessionController } from '../web/browser-design-session'
import { WebWelcomeScreen } from '../web/WebWelcomeScreen'
import type { CanopiFile } from '../types/design'

let container: HTMLDivElement

beforeEach(() => {
  locale.value = 'en'
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  answerSaveProblem('cancel')
  render(null, container)
  container.remove()
})

function buttons(): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button'))
}

function labels(): string[] {
  return buttons().map((button) => button.textContent ?? '')
}

describe('SaveStatusLabel', () => {
  it('shows quiet saving and saved text', async () => {
    const onRetry = vi.fn()
    await act(async () => {
      render(<SaveStatusLabel status="saving" onRetry={onRetry} onResolveConflict={vi.fn()} />, container)
    })
    expect(container.textContent).toBe('Saving…')
    expect(buttons()).toHaveLength(0)

    await act(async () => {
      render(<SaveStatusLabel status="saved" onRetry={onRetry} onResolveConflict={vi.fn()} />, container)
    })
    expect(container.textContent).toBe('Saved')
    expect(container.querySelector('[role="status"]')).not.toBeNull()
  })

  it('offers Retry after a failed save and the conflict dialog after an outside change', async () => {
    const onRetry = vi.fn()
    const onResolveConflict = vi.fn()
    await act(async () => {
      render(<SaveStatusLabel status="error" onRetry={onRetry} onResolveConflict={onResolveConflict} />, container)
    })
    expect(container.textContent).toContain("Couldn't save")
    buttons()[0]?.click()
    expect(onRetry).toHaveBeenCalledOnce()

    await act(async () => {
      render(<SaveStatusLabel status="conflict" onRetry={onRetry} onResolveConflict={onResolveConflict} />, container)
    })
    expect(labels()).toEqual(['Changed outside Canopi'])
    buttons()[0]?.click()
    expect(onResolveConflict).toHaveBeenCalledOnce()
  })
})

describe('SaveProblemDialog', () => {
  it('asks Retry, Discard changes or Cancel when a replacement cannot write first', async () => {
    await act(async () => {
      render(<SaveProblemDialog />, container)
    })
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()

    let decision: Promise<string> | null = null
    await act(async () => {
      decision = requestSaveProblemDecision({ kind: 'flush-failed', purpose: 'replace', conflict: false })
    })
    expect(container.textContent).toContain("Couldn't save your changes")
    expect(labels()).toEqual(['Retry', 'Discard changes', 'Cancel'])
    expect(document.activeElement?.textContent).toBe('Retry')

    await act(async () => {
      buttons()[1]?.click()
    })
    await expect(decision).resolves.toBe('discard')
    expect(saveProblem.value).toBeNull()
    expect(container.querySelector('[role="alertdialog"]')).toBeNull()
  })

  it('names closing without saving, and hides Retry while a conflict is pending', async () => {
    await act(async () => {
      render(<SaveProblemDialog />, container)
      void requestSaveProblemDecision({ kind: 'flush-failed', purpose: 'close', conflict: false })
    })
    expect(labels()).toEqual(['Retry', 'Close without saving', 'Cancel'])

    await act(async () => {
      void requestSaveProblemDecision({ kind: 'flush-failed', purpose: 'replace', conflict: true })
    })
    expect(labels()).toEqual(['Cancel', 'Discard changes'])
    expect(container.textContent).toContain('changed outside Canopi')
  })

  it('offers every conflict resolution and cancels on Escape', async () => {
    let decision: Promise<string> | null = null
    await act(async () => {
      render(<SaveProblemDialog />, container)
      decision = requestSaveProblemDecision({ kind: 'conflict', fileGone: false })
    })
    expect(container.textContent).toContain('Changed outside Canopi')
    expect(labels()).toEqual([
      'Keep my version',
      "Use the file's version",
      'Save mine as a copy…',
      'Cancel',
    ])

    await act(async () => {
      container.querySelector('[role="alertdialog"]')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      )
    })
    await expect(decision).resolves.toBe('cancel')
  })

  it('offers Save As or recreating the file when it was moved or deleted', async () => {
    let decision: Promise<string> | null = null
    await act(async () => {
      render(<SaveProblemDialog />, container)
      decision = requestSaveProblemDecision({ kind: 'conflict', fileGone: true })
    })
    expect(container.textContent).toContain('File moved or deleted')
    expect(labels()).toEqual(['Save As…', 'Keep my version', 'Cancel'])
    await act(async () => {
      buttons()[1]?.click()
    })
    await expect(decision).resolves.toBe('keep-mine')
  })

  it('keeps focus inside the dialog: Tab wraps and a backdrop press does not take focus away', async () => {
    await act(async () => {
      render(<SaveProblemDialog />, container)
    })
    await act(async () => {
      void requestSaveProblemDecision({ kind: 'flush-failed', purpose: 'replace', conflict: false })
    })
    const [retry, , cancel] = buttons()
    expect(document.activeElement).toBe(retry)

    cancel!.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    cancel!.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(retry)

    const shiftTab = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    retry!.dispatchEvent(shiftTab)
    expect(document.activeElement).toBe(cancel)

    const overlay = container.querySelector('[data-save-problem-overlay]')!
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    overlay.dispatchEvent(press)
    expect(press.defaultPrevented).toBe(true)
  })

  it('cancels an older request when a newer one arrives', async () => {
    const older = requestSaveProblemDecision({ kind: 'conflict', fileGone: false })
    const newer = requestSaveProblemDecision({ kind: 'flush-failed', purpose: 'close', conflict: false })
    await expect(older).resolves.toBe('cancel')
    answerSaveProblem('retry')
    await expect(newer).resolves.toBe('retry')
  })
})

describe('save dialog modality', () => {
  it('hides the command palette while the save dialog asks', async () => {
    commandPaletteOpen.value = true
    await act(async () => {
      render(<><CommandPalette /><SaveProblemDialog /></>, container)
    })
    expect(container.querySelector('[role="dialog"]')).not.toBeNull()

    let decision!: Promise<unknown>
    await act(async () => {
      decision = requestSaveProblemDecision({ kind: 'revert' })
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull()

    await act(async () => {
      answerSaveProblem('cancel')
      await decision
    })
    commandPaletteOpen.value = false
  })
})

describe('DraftList', () => {
  const drafts = [
    { id: 'draft-a', name: 'Untitled', updatedAt: new Date().toISOString() },
    { id: 'draft-b', name: 'Orchard', updatedAt: '2026-01-02T00:00:00.000Z' },
  ]

  it('renders nothing without drafts', async () => {
    await act(async () => {
      render(<DraftList drafts={[]} locale="en" onOpen={vi.fn()} onDelete={vi.fn()} />, container)
    })
    expect(container.innerHTML).toBe('')
  })

  it('opens a draft and deletes one only after an inline confirmation', async () => {
    const onOpen = vi.fn()
    const onDelete = vi.fn()
    await act(async () => {
      render(<DraftList drafts={drafts} locale="en" onOpen={onOpen} onDelete={onDelete} />, container)
    })
    expect(container.textContent).toContain('Drafts')
    expect(container.textContent).toContain('Untitled Design')
    expect(container.textContent).toContain('today')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('li button')?.click()
    })
    expect(onOpen).toHaveBeenCalledWith('draft-a')

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Delete draft: Orchard"]',
    )
    expect(deleteButton?.querySelector('[role="tooltip"]')?.textContent).toContain('Delete draft: Orchard')
    await act(async () => {
      deleteButton?.click()
    })
    expect(onDelete).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Delete this draft?')

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Cancel')?.click()
    })
    expect(container.textContent).not.toContain('Delete this draft?')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete draft: Orchard"]')?.click()
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Delete')?.click()
    })
    expect(onDelete).toHaveBeenCalledWith('draft-b')
  })
})

describe('Design Drafts controller', () => {
  it('lists drafts and drops a deleted one', async () => {
    const listDrafts = vi.fn(async () => [
      { id: 'a', name: 'A', updated_at: '2026-01-01T00:00:00.000Z' },
      { id: 'b', name: 'B', updated_at: '2026-01-02T00:00:00.000Z' },
    ])
    const deleteDraft = vi.fn(async () => undefined)
    const controller = createDesignDraftsController({ listDrafts, deleteDraft })

    await controller.load()
    expect(controller.drafts.value.map((draft) => draft.id)).toEqual(['a', 'b'])

    await controller.remove('a')
    expect(deleteDraft).toHaveBeenCalledWith('a')
    expect(controller.drafts.value.map((draft) => draft.id)).toEqual(['b'])
    controller.dispose()
  })

  it('shows no drafts when listing fails', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const controller = createDesignDraftsController({
      listDrafts: vi.fn(async () => {
        throw new Error('app data unavailable')
      }),
    })
    await controller.load()
    expect(controller.drafts.value).toEqual([])
    logError.mockRestore()
  })
})

describe('WebWelcomeScreen', () => {
  it('lists browser Drafts, opens one and deletes another', async () => {
    const values = new Map<string, string>()
    const appDataStore = createBrowserAppDataStore({
      storage: {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, value) },
        removeItem: (key) => { values.delete(key) },
      },
    })
    for (const name of ['Kitchen Garden', 'Hedge']) {
      appDataStore.saveDraft({ id: `draft-${name}`, file: design(name), now: '2026-01-01T00:00:00.000Z' })
    }
    const store = createMemoryDesignSessionStore()
    const controller = createBrowserDesignSessionController({ store, appDataStore })

    await act(async () => {
      render(<WebWelcomeScreen controller={controller} />, container)
    })
    expect(container.textContent).toContain('Kitchen Garden')
    expect(container.textContent).toContain('Hedge')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Delete draft: Kitchen Garden"]')?.click()
    })
    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent === 'Delete')?.click()
    })
    expect(container.textContent).not.toContain('Kitchen Garden')
    expect(appDataStore.listDrafts().map((draft) => draft.id)).toEqual(['draft-Hedge'])

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('li button'))
        .find((button) => button.textContent?.includes('Hedge'))?.click()
    })
    expect(store.readDesignName()).toBe('Hedge')
  })
})

function design(name: string): CanopiFile {
  return {
    version: 7,
    name,
    description: null,
    plant_species_colors: {},
    plant_species_symbols: {},
    layers: [],
    plants: [],
    zones: [],
    annotations: [],
    measurement_guides: [],
    groups: [],
    consortiums: [],
    timeline: [],
    budget: [],
    budget_currency: 'EUR',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}
