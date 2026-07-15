import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePointerResize } from '../components/shared/usePointerResize'

interface ResizeSession {
  readonly startedAt: number
}

describe('usePointerResize', () => {
  let container: HTMLDivElement
  let preview: ReturnType<typeof vi.fn<(session: ResizeSession, event: PointerEvent) => void>>
  let commit: ReturnType<typeof vi.fn<(session: ResizeSession, event: PointerEvent) => void>>
  let rollback: ReturnType<typeof vi.fn<(session: ResizeSession) => void>>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.innerHTML = ''
    document.body.appendChild(container)
    preview = vi.fn()
    commit = vi.fn()
    rollback = vi.fn()
  })

  afterEach(() => {
    render(null, container)
    container.remove()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  })

  function renderHarness(): {
    handle: HTMLDivElement
    setPointerCapture: ReturnType<typeof vi.fn>
    releasePointerCapture: ReturnType<typeof vi.fn>
  } {
    function Harness() {
      const onPointerDown = usePointerResize<ResizeSession>({
        cursor: 'row-resize',
        begin: (event) => ({ startedAt: event.clientY }),
        preview: (session, event) => {
          preview(session, event)
          return event.clientY !== session.startedAt
        },
        commit,
        rollback,
      })

      return <div data-resize-handle onPointerDown={onPointerDown} />
    }

    act(() => render(<Harness />, container))
    const handle = container.querySelector<HTMLDivElement>('[data-resize-handle]')
    expect(handle).not.toBeNull()
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(handle!, { setPointerCapture, releasePointerCapture })
    return { handle: handle!, setPointerCapture, releasePointerCapture }
  }

  function pointer(
    target: EventTarget,
    type: string,
    pointerId: number,
    clientY: number,
  ): void {
    target.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      button: 0,
      pointerId,
      clientX: 40,
      clientY,
    }))
  }

  it('previews and commits one captured pointer, then restores the exact prior body styles', () => {
    document.body.style.cursor = 'wait'
    document.body.style.userSelect = 'text'
    const { handle, setPointerCapture, releasePointerCapture } = renderHarness()

    act(() => {
      pointer(handle, 'pointerdown', 7, 300)
      pointer(document, 'pointermove', 99, 250)
      pointer(document, 'pointermove', 7, 250)
      pointer(document, 'pointerup', 7, 240)
    })

    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(preview.mock.calls.map(([, event]) => event.clientY)).toEqual([250, 240])
    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0]?.[0]).toEqual({ startedAt: 300 })
    expect(commit.mock.calls[0]?.[1].clientY).toBe(240)
    expect(rollback).not.toHaveBeenCalled()
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(document.body.style.cursor).toBe('wait')
    expect(document.body.style.userSelect).toBe('text')
  })

  it('does not preview or commit a pointer press released without movement', () => {
    const { handle } = renderHarness()

    act(() => {
      pointer(handle, 'pointerdown', 2, 300)
      pointer(document, 'pointermove', 2, 300)
      pointer(document, 'pointerup', 2, 300)
    })

    expect(preview).not.toHaveBeenCalled()
    expect(commit).not.toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
  })

  it('rolls back moved previews on pointer cancellation without committing', () => {
    const { handle, releasePointerCapture } = renderHarness()

    act(() => {
      pointer(handle, 'pointerdown', 3, 300)
      pointer(document, 'pointermove', 3, 260)
      pointer(document, 'pointercancel', 3, 260)
    })

    expect(preview).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledWith({ startedAt: 300 })
    expect(releasePointerCapture).toHaveBeenCalledWith(3)
  })

  it('commits a moved preview once when pointer capture is lost', () => {
    const { handle, releasePointerCapture } = renderHarness()

    act(() => {
      pointer(handle, 'pointerdown', 4, 300)
      pointer(document, 'pointermove', 4, 275)
      pointer(handle, 'lostpointercapture', 4, 275)
      pointer(document, 'pointerup', 4, 250)
    })

    expect(commit).toHaveBeenCalledOnce()
    expect(commit.mock.calls[0]?.[1].clientY).toBe(275)
    expect(rollback).not.toHaveBeenCalled()
    expect(releasePointerCapture).not.toHaveBeenCalled()
  })

  it('rolls back and releases capture when the owner unmounts during a drag', () => {
    document.body.style.cursor = 'crosshair'
    document.body.style.userSelect = 'all'
    const { handle, releasePointerCapture } = renderHarness()

    act(() => {
      pointer(handle, 'pointerdown', 5, 300)
      pointer(document, 'pointermove', 5, 280)
      render(null, container)
      pointer(document, 'pointermove', 5, 260)
      pointer(document, 'pointerup', 5, 260)
    })

    expect(preview).toHaveBeenCalledOnce()
    expect(commit).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledWith({ startedAt: 300 })
    expect(releasePointerCapture).toHaveBeenCalledWith(5)
    expect(document.body.style.cursor).toBe('crosshair')
    expect(document.body.style.userSelect).toBe('all')
  })

  it('installs teardown before an immediate drag and unmount can race passive effects', () => {
    function ImmediateHarness() {
      const onPointerDown = usePointerResize<ResizeSession>({
        cursor: 'row-resize',
        begin: (event) => ({ startedAt: event.clientY }),
        preview: (session, event) => {
          preview(session, event)
          return true
        },
        commit,
        rollback,
      })
      return <div data-immediate-resize-handle onPointerDown={onPointerDown} />
    }

    document.body.style.cursor = 'wait'
    document.body.style.userSelect = 'text'
    render(<ImmediateHarness />, container)
    const handle = container.querySelector<HTMLDivElement>('[data-immediate-resize-handle]')!
    const releasePointerCapture = vi.fn()
    Object.assign(handle, {
      setPointerCapture: vi.fn(),
      releasePointerCapture,
    })

    pointer(handle, 'pointerdown', 6, 300)
    pointer(document, 'pointermove', 6, 280)
    render(null, container)

    expect(rollback).toHaveBeenCalledWith({ startedAt: 300 })
    expect(releasePointerCapture).toHaveBeenCalledWith(6)
    expect(document.body.style.cursor).toBe('wait')
    expect(document.body.style.userSelect).toBe('text')
  })

  it('serializes hook instances through one global resize and body-style owner', () => {
    const firstRollback = vi.fn()
    const firstRelease = vi.fn()
    const secondCommit = vi.fn()
    const secondRelease = vi.fn()

    function DualHarness() {
      const onFirstPointerDown = usePointerResize<ResizeSession>({
        cursor: 'row-resize',
        begin: (event) => ({ startedAt: event.clientY }),
        preview: () => true,
        commit: vi.fn(),
        rollback: firstRollback,
      })
      const onSecondPointerDown = usePointerResize<ResizeSession>({
        cursor: 'col-resize',
        begin: (event) => ({ startedAt: event.clientY }),
        preview: () => true,
        commit: secondCommit,
        rollback: vi.fn(),
      })
      return (
        <>
          <div data-first-resize onPointerDown={onFirstPointerDown} />
          <div data-second-resize onPointerDown={onSecondPointerDown} />
        </>
      )
    }

    act(() => render(<DualHarness />, container))
    const first = container.querySelector<HTMLElement>('[data-first-resize]')!
    const second = container.querySelector<HTMLElement>('[data-second-resize]')!
    Object.assign(first, { setPointerCapture: vi.fn(), releasePointerCapture: firstRelease })
    Object.assign(second, { setPointerCapture: vi.fn(), releasePointerCapture: secondRelease })
    document.body.style.cursor = 'wait'
    document.body.style.userSelect = 'text'

    act(() => {
      pointer(first, 'pointerdown', 11, 300)
      pointer(document, 'pointermove', 11, 280)
      pointer(second, 'pointerdown', 12, 300)
    })

    expect(firstRollback).toHaveBeenCalledOnce()
    expect(firstRelease).toHaveBeenCalledWith(11)
    expect(document.body.style.cursor).toBe('col-resize')

    act(() => {
      pointer(document, 'pointermove', 12, 260)
      pointer(document, 'pointerup', 12, 260)
    })

    expect(secondCommit).toHaveBeenCalledOnce()
    expect(secondRelease).toHaveBeenCalledWith(12)
    expect(document.body.style.cursor).toBe('wait')
    expect(document.body.style.userSelect).toBe('text')
  })
})
