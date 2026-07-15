import { useCallback, useLayoutEffect, useRef } from 'preact/hooks'

export interface PointerResizeOptions<Session> {
  readonly cursor: string
  readonly begin: (event: PointerEvent) => Session | null
  readonly preview: (session: Session, event: PointerEvent) => boolean
  readonly commit: (session: Session, event: PointerEvent) => void
  readonly rollback: (session: Session) => void
}

interface ActivePointerResize<Session> {
  readonly pointerId: number
  readonly target: HTMLElement
  readonly session: Session
  readonly options: PointerResizeOptions<Session>
  readonly previousBodyCursor: string
  readonly previousBodyUserSelect: string
  readonly onMove: (event: PointerEvent) => void
  readonly onUp: (event: PointerEvent) => void
  readonly onCancel: (event: PointerEvent) => void
  readonly onLostCapture: (event: PointerEvent) => void
  lastEvent: PointerEvent
  previewed: boolean
  changed: boolean
  captured: boolean
}

interface ActivePointerResizeOwner {
  replaceActiveResize(): void
}

let activePointerResizeOwner: ActivePointerResizeOwner | null = null

class PointerResizeOwner<Session> implements ActivePointerResizeOwner {
  private active: ActivePointerResize<Session> | null = null

  constructor(private options: PointerResizeOptions<Session>) {}

  update(options: PointerResizeOptions<Session>): void {
    this.options = options
  }

  begin(event: PointerEvent): void {
    if (event.button !== 0 || this.active !== null) return
    if (!(event.currentTarget instanceof HTMLElement)) return

    const options = this.options
    const session = options.begin(event)
    if (session === null) return

    activePointerResizeOwner?.replaceActiveResize()
    event.preventDefault()
    const target = event.currentTarget
    const active: ActivePointerResize<Session> = {
      pointerId: event.pointerId,
      target,
      session,
      options,
      previousBodyCursor: document.body.style.cursor,
      previousBodyUserSelect: document.body.style.userSelect,
      onMove: (nextEvent) => this.move(nextEvent),
      onUp: (nextEvent) => this.finishPointerUp(nextEvent),
      onCancel: (nextEvent) => this.cancel(nextEvent),
      onLostCapture: (nextEvent) => this.finishLostCapture(nextEvent),
      lastEvent: event,
      previewed: false,
      changed: false,
      captured: false,
    }
    this.active = active
    activePointerResizeOwner = this

    document.addEventListener('pointermove', active.onMove)
    document.addEventListener('pointerup', active.onUp)
    document.addEventListener('pointercancel', active.onCancel)
    target.addEventListener('lostpointercapture', active.onLostCapture)
    document.body.style.cursor = options.cursor
    document.body.style.userSelect = 'none'

    try {
      target.setPointerCapture(event.pointerId)
      active.captured = true
    } catch {
      // Document listeners still provide a complete lifecycle when capture is unavailable.
    }
  }

  dispose(): void {
    const active = this.active
    if (!active) return
    this.finish(active, active.previewed ? 'rollback' : 'none', true)
  }

  replaceActiveResize(): void {
    const active = this.active
    if (!active) return
    this.finish(active, active.previewed ? 'rollback' : 'none', true)
  }

  private move(event: PointerEvent): void {
    const active = this.match(event)
    if (!active) return
    if (
      event.clientX === active.lastEvent.clientX
      && event.clientY === active.lastEvent.clientY
    ) return
    this.previewAt(active, event)
  }

  private finishPointerUp(event: PointerEvent): void {
    const active = this.match(event)
    if (!active) return
    if (
      event.clientX !== active.lastEvent.clientX
      || event.clientY !== active.lastEvent.clientY
    ) {
      this.previewAt(active, event)
    } else {
      active.lastEvent = event
    }
    this.finish(
      active,
      active.changed ? 'commit' : active.previewed ? 'rollback' : 'none',
      true,
    )
  }

  private cancel(event: PointerEvent): void {
    const active = this.match(event)
    if (!active) return
    this.finish(active, active.previewed ? 'rollback' : 'none', true)
  }

  private finishLostCapture(event: PointerEvent): void {
    const active = this.match(event)
    if (!active) return
    active.captured = false
    this.finish(
      active,
      active.changed ? 'commit' : active.previewed ? 'rollback' : 'none',
      false,
    )
  }

  private previewAt(active: ActivePointerResize<Session>, event: PointerEvent): void {
    active.lastEvent = event
    active.previewed = true
    try {
      active.changed = active.options.preview(active.session, event)
    } catch (error) {
      this.finish(active, 'rollback', true)
      throw error
    }
  }

  private match(event: PointerEvent): ActivePointerResize<Session> | null {
    const active = this.active
    return active?.pointerId === event.pointerId ? active : null
  }

  private finish(
    active: ActivePointerResize<Session>,
    outcome: 'commit' | 'rollback' | 'none',
    releaseCapture: boolean,
  ): void {
    if (this.active !== active) return
    this.active = null
    if (activePointerResizeOwner === this) activePointerResizeOwner = null

    document.removeEventListener('pointermove', active.onMove)
    document.removeEventListener('pointerup', active.onUp)
    document.removeEventListener('pointercancel', active.onCancel)
    active.target.removeEventListener('lostpointercapture', active.onLostCapture)
    document.body.style.cursor = active.previousBodyCursor
    document.body.style.userSelect = active.previousBodyUserSelect

    if (releaseCapture && active.captured) {
      active.captured = false
      try {
        active.target.releasePointerCapture(active.pointerId)
      } catch {
        // Capture may already have been released by the browser or element teardown.
      }
    }

    if (outcome === 'commit') {
      active.options.commit(active.session, active.lastEvent)
    } else if (outcome === 'rollback') {
      active.options.rollback(active.session)
    }
  }
}

export function usePointerResize<Session>(
  options: PointerResizeOptions<Session>,
): (event: PointerEvent) => void {
  const ownerRef = useRef<PointerResizeOwner<Session> | null>(null)
  if (ownerRef.current === null) ownerRef.current = new PointerResizeOwner(options)
  const owner = ownerRef.current
  owner.update(options)

  useLayoutEffect(() => () => owner.dispose(), [owner])
  return useCallback((event: PointerEvent) => owner.begin(event), [owner])
}
