import { signal } from '@preact/signals'
import { afterEach, describe, expect, it } from 'vitest'
import { finishSiteProfile } from '../app/lidar/profile'
import { endSiteDataTransients, setPin } from '../app/lidar/site-transients'
import { pinSiteDataPoint } from '../app/lidar/site-values'
import { activePanel, selectPanel, sidePanel } from '../app/shell/state'
import { setCurrentCanvasSession } from '../canvas/session'
import {
  createGalleryCanvasRuntimeAppAdapter,
  createGalleryMapContributionAdapter,
} from '../../ui-gallery/gallery-workspace-runtime'
import { designFixture } from '../../ui-gallery/fixtures'
import { createTestCanvasQuerySurface } from './support/canvas-query-surface'
import { createTestCanvasRuntimeSurfaces } from './support/canvas-runtime-surfaces'

// The gallery stands in for Desktop (its Site data surface, profile.spec.ts and values.spec.ts), so its canvas hands
// taps and finished Profile lines to Desktop's Site data, and its map draws the pin and the line; `edition=web` has none.
describe('UI gallery workspace runtime', () => {
  afterEach(() => {
    endSiteDataTransients()
    setCurrentCanvasSession(null)
    sidePanel.value = null
    activePanel.value = 'canvas'
  })

  it('carries Desktop’s Site data capabilities: a tap no tool uses pins, Profile’s finished line is profiled', () => {
    const adapter = createGalleryCanvasRuntimeAppAdapter(designFixture(), 'desktop')
    expect(adapter.pinAt).toBe(pinSiteDataPoint)
    expect(adapter.finishProfile).toBe(finishSiteProfile)
  })

  it('carries none on Web', () => {
    const adapter = createGalleryCanvasRuntimeAppAdapter(designFixture(), 'web')
    expect(adapter.pinAt).toBeUndefined()
    expect(adapter.finishProfile).toBeUndefined()
  })

  it('reads Desktop’s pin into its map contributions, and none on Web', () => {
    const queries = createTestCanvasQuerySurface()
    setCurrentCanvasSession(createTestCanvasRuntimeSurfaces({ queries }))
    selectPanel('site-data')
    setPin({ lon: 2.35, lat: 48.85 })
    const store = { sessionIdentity: signal<object>({}), hasCurrentDesign: () => true }

    const desktop = createGalleryMapContributionAdapter(store, { state: 'site-data', edition: 'desktop' })
    expect(desktop.read(queries)?.overlays.site).toEqual({ pin: [2.35, 48.85], profileLine: null })
    expect(desktop.readSiteHover?.()).toBeNull()

    const web = createGalleryMapContributionAdapter(store, { state: 'site-data', edition: 'web' })
    expect(web.read(queries)?.overlays.site).toBeNull()
    expect(web.readSiteHover).toBeUndefined()
  })
})
