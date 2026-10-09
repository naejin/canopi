// Follow mode's camera half (canopi-f47t.53; design check A3; U54 Q13–Q15, Q17, Q12): the jumps through showPlace and
// the exits on outside moves, a Design activation and a story presentation.
import { signal } from '@preact/signals'
import { describe, expect, it, vi } from 'vitest'
import type { GeoPoint, ViewCamera } from '../../canvas/runtime/view/types'
import { startCameraFollow, type FollowView } from './follow'

const FIX: GeoPoint = { lon: 12.3456789, lat: 45.6789012 }
const MOVED: GeoPoint = { lon: 12.3476789, lat: 45.6789012 }

/** A view whose camera jumps at once, as the driver's 'none' moves do, and settles when the test says. */
function fakeView(start: ViewCamera = { center: { lon: 3.87, lat: 43.61 }, zoom: 14, bearingDeg: 30, pitchDeg: 0 }) {
  let live = start
  const settledCamera = signal<ViewCamera>(start)
  const showPlace = vi.fn((place: GeoPoint, zoom: number, _options: { readonly motion: 'jump' }) => {
    live = { ...live, center: { ...place }, zoom }
    return true
  })
  const view: FollowView = { settledCamera, captureCamera: () => live, showPlace }
  return {
    view,
    showPlace,
    live: () => live,
    /** The user moved the camera: the live frame now, the settled camera 150 ms later. */
    move(camera: Partial<ViewCamera>) { live = { ...live, ...camera } },
    settle() { settledCamera.value = { ...live } },
  }
}

function setup(view = fakeView()) {
  const current = signal<FollowView | null>(view.view)
  const designIdentity = signal<object>({})
  const presenting = signal(false)
  const onEnd = vi.fn()
  const follow = startCameraFollow({ view: current, designIdentity, presenting, onEnd })
  return { follow, view, current, designIdentity, presenting, onEnd }
}

/** One screen pixel in degrees of longitude at this zoom (512 px tiles; Web Mercator x is linear in longitude). */
function pixelDegreesLon(zoom: number): number {
  return 360 / (512 * 2 ** zoom)
}

describe('camera follow', () => {
  it('jumps to the fix at max(zoom, 17) on the click, keeping the bearing to the driver, and at the current zoom on later fixes', () => {
    const f = setup()
    expect(f.follow.follow(FIX, true)).toBe(true)
    expect(f.view.showPlace).toHaveBeenLastCalledWith(FIX, 17, { motion: 'jump' })
    f.view.settle()
    f.view.move({ zoom: 18.5 })
    f.view.settle()
    expect(f.follow.follow(MOVED, false)).toBe(true)
    expect(f.view.showPlace).toHaveBeenLastCalledWith(MOVED, 18.5, { motion: 'jump' })
    f.view.settle()
    expect(f.follow.follow(FIX, true)).toBe(true)
    expect(f.view.showPlace).toHaveBeenLastCalledWith(FIX, 18.5, { motion: 'jump' })
    expect(f.onEnd).not.toHaveBeenCalled()
  })

  it('keeps following through its own jump\'s settle, a zoom about the centre and a turn, which keep the fix centred', () => {
    const f = setup()
    f.follow.follow(FIX, true)
    f.view.settle()
    f.view.move({ zoom: 19 })
    f.view.settle()
    f.view.move({ bearingDeg: 75 })
    f.view.settle()
    expect(f.onEnd).not.toHaveBeenCalled()
  })

  it('ends on an outside move once the camera settles away from follow\'s jump, and never jumps again', () => {
    const f = setup()
    f.follow.follow(FIX, true)
    f.view.settle()
    f.view.move({ center: { lon: FIX.lon + 0.001, lat: FIX.lat } })
    f.view.settle()
    expect(f.onEnd).toHaveBeenCalledOnce()
    const jumps = f.view.showPlace.mock.calls.length
    expect(f.follow.follow(MOVED, false)).toBe(false)
    expect(f.view.showPlace).toHaveBeenCalledTimes(jumps)
  })

  it('compares the live camera on each fix before jumping: a pan not yet settled ends follow and the fix moves nothing', () => {
    const f = setup()
    f.follow.follow(FIX, true)
    f.view.settle()
    f.view.move({ center: { lon: FIX.lon, lat: FIX.lat + 0.001 } })
    expect(f.follow.follow(MOVED, false)).toBe(false)
    expect(f.onEnd).toHaveBeenCalledOnce()
    expect(f.view.live().center).toEqual({ lon: FIX.lon, lat: FIX.lat + 0.001 })
  })

  it('has a tolerance of about one pixel: rounding and a re-origin\'s round trip through the plane keep following', () => {
    const f = setup()
    f.follow.follow(FIX, true)
    f.view.settle()
    // A re-origin moves the session plane, not the ground: the settled camera comes back with the same lon/lat, to float noise.
    const halfPixel = pixelDegreesLon(17) / 2
    f.view.move({ center: { lon: FIX.lon + halfPixel, lat: FIX.lat + 1e-9 } })
    f.view.settle()
    expect(f.onEnd).not.toHaveBeenCalled()
    f.view.move({ center: { lon: FIX.lon + 3 * pixelDegreesLon(17), lat: FIX.lat } })
    f.view.settle()
    expect(f.onEnd).toHaveBeenCalledOnce()
  })

  it('a settle that was due before follow\'s jump is no outside move', () => {
    const view = fakeView()
    const f = setup(view)
    f.follow.follow(FIX, true)
    // The settled camera still shows the pre-jump frame; a re-read of the view (a new canvas surface) must not end follow.
    f.current.value = { ...view.view }
    expect(f.onEnd).not.toHaveBeenCalled()
  })

  it('accepts a settled camera on the fix when the jump was queued and the read-back still showed the old frame', () => {
    let live: ViewCamera = { center: { lon: 3.87, lat: 43.61 }, zoom: 14, bearingDeg: 0, pitchDeg: 0 }
    const settledCamera = signal<ViewCamera>(live)
    const queued: ViewCamera[] = []
    const view: FollowView = {
      settledCamera,
      captureCamera: () => live,
      showPlace: (place, zoom) => { queued.push({ ...live, center: { ...place }, zoom }); return true },
    }
    const f = setup({ view, showPlace: vi.fn(), live: () => live, move: () => {}, settle: () => {} })
    f.follow.follow(FIX, true)
    live = queued[0]!
    settledCamera.value = live
    expect(f.onEnd).not.toHaveBeenCalled()
  })

  it('ends when another Design becomes current, and when a story presentation starts (U54 Q17, Q12)', () => {
    const design = setup()
    design.follow.follow(FIX, true)
    design.designIdentity.value = {}
    expect(design.onEnd).toHaveBeenCalledOnce()

    const story = setup()
    story.follow.follow(FIX, true)
    story.presenting.value = true
    story.presenting.value = false
    expect(story.onEnd).toHaveBeenCalledOnce()
  })

  it('ends at once when started during a story presentation, and waits for a canvas without jumping', () => {
    const presenting = signal(true)
    const onEnd = vi.fn()
    startCameraFollow({ view: signal(null), designIdentity: signal({}), presenting, onEnd })
    expect(onEnd).toHaveBeenCalledOnce()

    const f = setup()
    f.current.value = null
    expect(f.follow.follow(FIX, true)).toBe(true)
    expect(f.view.showPlace).not.toHaveBeenCalled()
  })

  it('stops watching once disposed: no exit and no jump after', () => {
    const f = setup()
    f.follow.follow(FIX, true)
    f.follow.dispose()
    f.view.move({ center: MOVED })
    f.view.settle()
    f.designIdentity.value = {}
    expect(f.onEnd).not.toHaveBeenCalled()
    expect(f.follow.follow(MOVED, false)).toBe(false)
  })
})
