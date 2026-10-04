import { describe, expect, it } from 'vitest'
import { mapErrorResourceId } from '../maplibre/map-error-owner'

describe('mapErrorResourceId', () => {
  it.each([
    [{ sourceId: 'terrain-dem', error: new Error('tile') }, 'terrain-dem'],
    [{ layer: { id: 'hillshade-layer' }, error: new Error('draw') }, 'hillshade-layer'],
    [{ error: new Error('sources.panel-target-selection-source: unknown property "id"') }, 'panel-target-selection-source'],
    [{ error: new Error('layers.panel-target-hover-plants.paint.circle-color: color expected') }, 'panel-target-hover-plants'],
    [{ error: new Error('layers.ofm:water.paint.fill-color: color expected') }, 'ofm:water'],
    [{ error: new Error('Layer "contour-minor" already exists on this map.') }, 'contour-minor'],
    [{ error: new Error('Source "terrain-dem" cannot be removed while layer "hillshade-layer" is using it.') }, 'terrain-dem'],
    [{ error: new Error('Cannot remove non-existing layer "panel-target-hover-plants".') }, 'panel-target-hover-plants'],
    [{ error: new Error("The source 'panel-target-hover-source' does not exist in the map's style.") }, 'panel-target-hover-source'],
    [{ message: 'sources.x: bad' }, 'x'],
  ])('names the resource in %j', (event, id) => {
    expect(mapErrorResourceId(event)).toBe(id)
  })

  it.each([
    null,
    'text',
    { error: new Error('WebGL context lost') },
    { error: new Error('Failed to fetch') },
    { sourceId: '' },
  ])('names nothing for %j', (event) => {
    expect(mapErrorResourceId(event)).toBeNull()
  })
})
