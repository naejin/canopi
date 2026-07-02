import { signal } from '@preact/signals'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesignNotebookWorkbench } from '../app/design-notebook/workbench'
import { DesignNotebookPanel } from '../components/panels/DesignNotebookPanel'

describe('DesignNotebookPanel', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
  })

  afterEach(() => {
    render(null, container)
    container.remove()
  })

  it('renders a searchable All Designs ledger and opens rows through the workbench', async () => {
    const activePath = signal<string | null>('/designs/terrace.canopi')
    const openDesign = vi.fn().mockImplementation(async (path: string) => {
      activePath.value = path
    })
    const workbench = createDesignNotebookWorkbench({
      activePath,
      loadEntries: vi.fn().mockResolvedValue([
        {
          path: '/designs/terrace.canopi',
          name: 'Terrace Guild',
          updated_at: '2026-06-20T08:00:00.000Z',
          plant_count: 12,
        },
        {
          path: '/designs/forest-edge.canopi',
          name: 'Forest Edge',
          updated_at: '2026-06-22T08:00:00.000Z',
          plant_count: 7,
        },
      ]),
      openDesign,
    })

    await act(async () => {
      render(<DesignNotebookPanel workbench={workbench} />, container)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(container.querySelector('[aria-label="Design Notebook"]')).not.toBeNull()
    expect(container.textContent).toContain('Terrace Guild')
    expect(container.textContent).toContain('Forest Edge')
    expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain('Terrace Guild')

    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search designs"]')
    if (!search) throw new Error('Missing notebook search input')

    await act(async () => {
      search.value = 'forest'
      search.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })

    expect(container.textContent).not.toContain('Terrace Guild')
    expect(container.textContent).toContain('Forest Edge')

    const row = container.querySelector<HTMLButtonElement>('button[data-design-path="/designs/forest-edge.canopi"]')
    if (!row) throw new Error('Missing Forest Edge row')

    await act(async () => {
      row.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(openDesign).toHaveBeenCalledWith('/designs/forest-edge.canopi')
    expect(container.querySelector('button[aria-current="true"]')?.textContent).toContain('Forest Edge')
  })
})
