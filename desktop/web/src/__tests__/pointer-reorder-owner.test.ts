import { afterEach, describe, expect, it, vi } from 'vitest'
import { PointerReorderOwner } from '../components/shared/usePointerReorder'

const owners: { dispose(): void }[] = []
afterEach(() => { owners.splice(0).forEach(owner => owner.dispose()); document.body.replaceChildren() })

function pointer(target: EventTarget, type: string, pointerId = 1) {
  target.dispatchEvent(new PointerEvent(type, { pointerId, button: 0, bubbles: true }))
}

function start<S>(owner: PointerReorderOwner<S>, session: S, pointerId = 1, captureFails = false) {
  const row = document.createElement('div')
  row.setPointerCapture = vi.fn(() => { if (captureFails) throw new Error('unavailable') })
  row.releasePointerCapture = vi.fn()
  document.body.append(row)
  row.addEventListener('pointerdown', event => owner.begin(event, session), { once: true })
  pointer(row, 'pointerdown', pointerId)
  return row
}

describe('panel reorder lifetime', () => {
  it('continues after capture loss and row removal, ignoring other pointers and cleaning up after release', () => {
    const move = vi.fn(), finish = vi.fn(), cancel = vi.fn()
    const owner = new PointerReorderOwner({ move, finish, cancel }); owners.push(owner)
    const row = start(owner, 'stamp')
    pointer(document, 'pointermove', 2)
    expect(move).not.toHaveBeenCalled()
    pointer(row, 'lostpointercapture'); row.remove()
    pointer(document, 'pointermove'); pointer(document, 'pointerup')
    pointer(document, 'pointermove'); pointer(document, 'pointerup')
    expect(move).toHaveBeenCalledTimes(1)
    expect(finish).toHaveBeenCalledTimes(1)
    expect(cancel).not.toHaveBeenCalled()
    expect(row.releasePointerCapture).toHaveBeenCalledWith(1)
  })

  it('cancels on pointer cancellation and disposal even when capture was unavailable', () => {
    const move = vi.fn(), finish = vi.fn(), cancel = vi.fn()
    const owner = new PointerReorderOwner({ move, finish, cancel }); owners.push(owner)
    start(owner, 'first', 1, true)
    pointer(document, 'pointercancel', 2)
    expect(cancel).not.toHaveBeenCalled()
    pointer(document, 'pointercancel')
    expect(cancel).toHaveBeenCalledWith('first')
    start(owner, 'second', 2, true); owner.dispose()
    pointer(document, 'pointerup', 2)
    expect(cancel).toHaveBeenCalledWith('second')
    expect(finish).not.toHaveBeenCalled()
  })

  it('keeps a newer preview when an earlier committed gesture finishes asynchronously', async () => {
    let preview: string | null = null
    let complete!: () => void
    const saved = new Promise<void>(resolve => { complete = resolve })
    const owner = new PointerReorderOwner<string>({
      move: session => { preview = session },
      finish: (_session, _event, isCurrent) => { void saved.then(() => { if (isCurrent()) preview = null }) },
      cancel: () => { preview = null },
    }); owners.push(owner)
    start(owner, 'first'); pointer(document, 'pointermove'); pointer(document, 'pointerup')
    start(owner, 'second'); pointer(document, 'pointermove')
    complete(); await saved
    expect(preview).toBe('second')
    owner.dispose()
    expect(preview).toBeNull()
  })

  it('invalidates a pending completion when its panel is disposed', () => {
    let isCurrent!: () => boolean
    const owner = new PointerReorderOwner({ move: vi.fn(), finish: (_s, _e, current) => { isCurrent = current }, cancel: vi.fn() }); owners.push(owner)
    start(owner, 'first'); pointer(document, 'pointerup')
    expect(isCurrent()).toBe(true)
    owner.dispose()
    expect(isCurrent()).toBe(false)
  })
})
