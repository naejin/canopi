import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { locale } from '../app/settings/state'

vi.mock('../ipc/design', async (importOriginal) => {
  const original = await importOriginal<typeof import('../ipc/design')>()
  return {
    ...original,
    getRecentFiles: vi.fn(),
  }
})

vi.mock('../app/document-session/actions', async (importOriginal) => {
  const original = await importOriginal<typeof import('../app/document-session/actions')>()
  return {
    ...original,
    openDesignFromPath: vi.fn().mockResolvedValue(undefined),
  }
})

import { getRecentFiles } from '../ipc/design'
import { openDesignFromPath } from '../app/document-session/actions'
import { MenuBar } from '../components/shared/MenuBar'

describe('MenuBar Recent Designs', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    locale.value = 'en'
    vi.mocked(openDesignFromPath).mockClear()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  async function renderAndOpenFileMenu(): Promise<void> {
    await act(async () => {
      render(<MenuBar />, container)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const fileTrigger = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'File')
    if (!fileTrigger) throw new Error('Missing File menu trigger')
    await act(async () => {
      fileTrigger.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  it('shows Open Recent as a disabled File menu item when there are no recent designs', async () => {
    vi.mocked(getRecentFiles).mockResolvedValue([])

    await renderAndOpenFileMenu()

    const openRecent = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('Open Recent'))
    if (!openRecent) throw new Error('Missing Open Recent item')

    expect(openRecent.disabled).toBe(true)
    expect(openRecent.getAttribute('aria-haspopup')).toBe('menu')
    expect(container.textContent).not.toContain('Forest Edge')
  })

  it('opens recent designs from an Open Recent submenu capped to five entries', async () => {
    vi.mocked(getRecentFiles).mockResolvedValue([
      { path: '/designs/forest.canopi', name: 'Forest Edge', updated_at: '2026-06-20T00:00:00.000Z', plant_count: 4 },
      { path: '/designs/home.canopi', name: 'Home Guild', updated_at: '2026-06-21T00:00:00.000Z', plant_count: 2 },
      { path: '/designs/client-a.canopi', name: 'Client A', updated_at: '2026-06-22T00:00:00.000Z', plant_count: 3 },
      { path: '/designs/client-b.canopi', name: 'Client B', updated_at: '2026-06-23T00:00:00.000Z', plant_count: 1 },
      { path: '/designs/client-c.canopi', name: 'Client C', updated_at: '2026-06-24T00:00:00.000Z', plant_count: 5 },
      { path: '/designs/client-d.canopi', name: 'Client D', updated_at: '2026-06-25T00:00:00.000Z', plant_count: 6 },
    ])

    await renderAndOpenFileMenu()

    const openRecent = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('Open Recent'))
    if (!openRecent) throw new Error('Missing Open Recent item')

    expect(openRecent.disabled).toBe(false)
    expect(openRecent.getAttribute('aria-haspopup')).toBe('menu')
    expect(container.textContent).not.toContain('Forest Edge')

    await act(async () => {
      openRecent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
    })

    expect(container.textContent).toContain('Forest Edge')
    expect(container.textContent).toContain('Client C')
    expect(container.textContent).not.toContain('Client D')

    await act(async () => {
      openRecent.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
    })

    expect(openRecent.getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      openRecent.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' }))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })

    expect(document.activeElement?.textContent).toContain('Forest Edge')

    const forest = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('Forest Edge'))
    if (!forest) throw new Error('Missing Forest Edge recent item')

    await act(async () => {
      forest.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(openDesignFromPath).toHaveBeenCalledWith('/designs/forest.canopi')
  })
})
