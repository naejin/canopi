import { useLayoutEffect, useRef } from 'preact/hooks'

interface PointerReorderOptions<Session> {
  move(session: Session, event: PointerEvent): void
  finish(session: Session, event: PointerEvent, isCurrent: () => boolean): void
  cancel(session: Session): void
}

interface ActiveReorder<Session> {
  readonly session: Session
  readonly target: HTMLElement
  readonly pointerId: number
  readonly options: PointerReorderOptions<Session>
}

/** Owns listeners and completion lifetime; row reflow may release capture without ending a drag. */
export class PointerReorderOwner<Session> {
  private active: ActiveReorder<Session> | null = null
  private generation = 0
  private disposed = false

  constructor(private options: PointerReorderOptions<Session>) {}

  update(options: PointerReorderOptions<Session>): void { this.options = options }

  begin = (event: PointerEvent, session: Session): void => {
    if (this.disposed || event.button !== 0 || !(event.currentTarget instanceof HTMLElement)) return
    this.abort()
    this.generation += 1
    const active = { session, target: event.currentTarget, pointerId: event.pointerId, options: this.options }
    this.active = active
    document.addEventListener('pointermove', this.move)
    document.addEventListener('pointerup', this.finish)
    document.addEventListener('pointercancel', this.cancel)
    try {
      active.target.setPointerCapture(active.pointerId)
    } catch {
      // Document listeners retain the gesture when capture is unavailable.
    }
  }

  dispose(): void {
    this.disposed = true
    this.abort()
  }

  private move = (event: PointerEvent): void => {
    const active = this.match(event)
    if (!active) return
    try {
      active.options.move(active.session, event)
    } catch (error) {
      this.abort()
      throw error
    }
  }

  private finish = (event: PointerEvent): void => {
    const active = this.match(event)
    if (!active) return
    const generation = this.generation
    this.release(active)
    if (!this.disposed && generation === this.generation) {
      active.options.finish(active.session, event, () => !this.disposed && generation === this.generation)
    }
  }

  private cancel = (event: PointerEvent): void => {
    if (this.match(event)) this.abort()
  }

  private match(event: PointerEvent): ActiveReorder<Session> | null {
    return this.active?.pointerId === event.pointerId ? this.active : null
  }

  private abort(): void {
    this.generation += 1
    const active = this.active
    if (!active) return
    const generation = this.generation
    this.release(active)
    if (generation === this.generation) active.options.cancel(active.session)
  }

  private release(active: ActiveReorder<Session>): void {
    this.active = null
    document.removeEventListener('pointermove', this.move)
    document.removeEventListener('pointerup', this.finish)
    document.removeEventListener('pointercancel', this.cancel)
    try {
      active.target.releasePointerCapture(active.pointerId)
    } catch {
      // Capture may already have been lost during row reflow.
    }
  }
}

export function usePointerReorder<Session>(options: PointerReorderOptions<Session>) {
  const ref = useRef<PointerReorderOwner<Session> | null>(null)
  if (!ref.current) ref.current = new PointerReorderOwner(options)
  const owner = ref.current
  owner.update(options)
  useLayoutEffect(() => () => owner.dispose(), [owner])
  return owner.begin
}
