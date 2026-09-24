import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LibraryReference } from '../../ui-gallery/library-reference/LibraryReference'
import { createLibraryReference } from '../../ui-gallery/library-reference/model'

let root: HTMLDivElement
beforeEach(() => { root = document.createElement('div'); document.body.append(root) })
afterEach(() => { render(null, root); root.remove() })
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent)?.trim() === name)
  if (!found) throw new Error(`Button missing: ${name}`)
  return found
}
async function click(name: string) { await act(() => { button(name).click() }) }
async function input(node: HTMLInputElement, value: string) { await act(() => { node.value = value; node.dispatchEvent(new Event('input', { bubbles: true })) }) }

describe('clickable Data Library reference', () => {
  it('preserves search across import and details, and never auto-attaches the new item', async () => {
    const model = createLibraryReference()
    await act(() => { render(<LibraryReference model={model} />, root) })
    await input(root.querySelector<HTMLInputElement>('input[type="search"]')!, 'North')
    await click('+ Import')
    await click('Use selected files')
    await click('Import 2 files')
    expect(model.items.value.filter(item => item.status === 'importing')).toHaveLength(1)
    await click('Complete import')
    await click('← Back to library')
    expect(root.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('North')
    expect(model.layers.value.orchard).toEqual([])
  })

  it('returns focus to the item after details and reuses the item through real Add and Remove buttons', async () => {
    const model = createLibraryReference()
    await act(() => { render(<LibraryReference model={model} />, root) })
    const item = document.getElementById('item-terrain')!
    await act(() => { item.click() })
    await click('← Back to library')
    expect(document.activeElement?.id).toBe('item-terrain')
    await click('Add Orchard terrain to Design')
    await click('Open Layers')
    const nameButton = [...root.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Orchard terrainElevation')!
    await act(() => { nameButton.click() })
    await click('Remove from Design')
    expect(model.layers.value.orchard).toEqual([])
    await click('Open Data Library')
    expect(button('Add Orchard terrain to Design').disabled).toBe(false)
  })

  it('Escape dismisses an unsubmitted picker without cancelling background work', async () => {
    const model = createLibraryReference()
    await act(() => { render(<LibraryReference model={model} />, root) })
    await click('+ Import')
    await act(() => { root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(root.querySelector('input[type="search"]')).not.toBeNull()
    expect(model.items.value).toHaveLength(3)
    await act(() => { model.importFiles('Background import', ['a.tif']) })
    await act(() => { root.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(model.items.value.find(item => item.name === 'Background import')?.status).toBe('importing')
  })

  it('finds a renamed dependent result when source deletion is refused', async () => {
    const model = createLibraryReference()
    await act(() => { render(<LibraryReference model={model} />, root) })
    await click('Actions for North field slope')
    await click('Rename')
    await input(root.querySelector<HTMLInputElement>('form input')!, 'Orchard gradient')
    await click('Save name')
    await click('Actions for North field terrain')
    await click('Delete from library')
    await click('Show related data')
    expect(root.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('Orchard gradient')
    expect(document.getElementById('item-slope')).not.toBeNull()
    expect(model.items.value).toHaveLength(3)
  })
})
