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

  it('renders recent designs inline and opens them through the document seam', async () => {
    vi.mocked(getRecentFiles).mockResolvedValue([
      { path: '/designs/forest.canopi', name: 'Forest Edge', updated_at: '2026-06-20T00:00:00.000Z', plant_count: 4 },
      { path: '/designs/home.canopi', name: 'Home Guild', updated_at: '2026-06-21T00:00:00.000Z', plant_count: 2 },
    ])

    await renderAndOpenFileMenu()

    expect(container.textContent).toContain('Recent Designs')
    const forest = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('Forest Edge'))
    if (!forest) throw new Error('Missing Forest Edge recent item')

    await act(async () => {
      forest.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(openDesignFromPath).toHaveBeenCalledWith('/designs/forest.canopi')
  })

  it('omits the Recent Designs section when the recent list is empty', async () => {
    vi.mocked(getRecentFiles).mockResolvedValue([])

    await renderAndOpenFileMenu()

    expect(container.textContent).not.toContain('Recent Designs')
  })
})
