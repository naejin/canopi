import { describe, expect, it } from 'vitest'

import { createDefaultScenePersistedState } from './scene'
import { computeScenePhysicalExtentMeters } from './scene-physical-extent'

describe('Scene physical extent', () => {
  it('has no radial extent without physical Scene geometry', () => {
    expect(computeScenePhysicalExtentMeters(createDefaultScenePersistedState())).toBeNull()
  })

  it('uses a Placed Plant center as physical point geometry', () => {
    const scene = createDefaultScenePersistedState()
    scene.plants.push({
      kind: 'plant',
      id: 'plant-1',
      locked: false,
      canonicalName: 'Malus domestica',
      commonName: null,
      color: null,
      stratum: null,
      canopySpreadM: null,
      position: { x: 30, y: 40 },
      rotationDeg: null,
      scale: null,
      notes: null,
      plantedDate: null,
      quantity: null,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBe(50)
  })

  it('uses every Polygonal Zone vertex as physical geometry', () => {
    const scene = createDefaultScenePersistedState()
    scene.zones.push({
      kind: 'zone',
      locked: false,
      name: 'zone-1',
      zoneType: 'polygon',
      points: [
        { x: 3, y: 4 },
        { x: 60, y: 80 },
        { x: -6, y: 8 },
      ],
      rotationDeg: 0,
      fillColor: null,
      notes: null,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBe(100)
  })

  it('uses an Annotation anchor without treating readable text as physical geometry', () => {
    const scene = createDefaultScenePersistedState()
    scene.annotations.push({
      kind: 'annotation',
      locked: false,
      id: 'annotation-1',
      annotationType: 'text',
      position: { x: -120, y: 160 },
      text: 'Extent',
      fontSize: 160,
      rotationDeg: 45,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBe(200)
  })

  it('includes both endpoints of a Measurement Guide', () => {
    const scene = createDefaultScenePersistedState()
    scene.measurementGuides.push({
      kind: 'measurement-guide',
      id: 'guide-1',
      locked: false,
      start: { x: 3, y: 4 },
      end: { x: 60, y: 80 },
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBe(100)
  })

  it('uses the effective world corners of a rotated Rectangular Zone', () => {
    const scene = createDefaultScenePersistedState()
    scene.zones.push({
      kind: 'zone',
      locked: false,
      name: 'rotated-rectangle',
      zoneType: 'rect',
      points: [
        { x: 1, y: 3 },
        { x: 5, y: 3 },
        { x: 5, y: 5 },
        { x: 1, y: 5 },
      ],
      rotationDeg: 90,
      fillColor: null,
      notes: null,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBeCloseTo(Math.sqrt(52), 10)
  })

  it('uses the true radial extremum of a rotated Elliptical Zone', () => {
    const scene = createDefaultScenePersistedState()
    scene.zones.push({
      kind: 'zone',
      locked: false,
      name: 'rotated-ellipse',
      zoneType: 'ellipse',
      points: [
        { x: -2 * Math.SQRT2, y: 2 * Math.SQRT2 },
        { x: 5, y: 3 },
      ],
      rotationDeg: 45,
      fillColor: null,
      notes: null,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBeCloseTo(Math.sqrt(50), 10)
  })

  it('solves a non-cardinal rotated Elliptical Zone extremum', () => {
    const scene = createDefaultScenePersistedState()
    const rotationRad = Math.PI / 6
    const localCenter = { x: 0.6, y: 5.6 }
    scene.zones.push({
      kind: 'zone',
      locked: false,
      name: 'general-rotated-ellipse',
      zoneType: 'ellipse',
      points: [
        {
          x: localCenter.x * Math.cos(rotationRad) - localCenter.y * Math.sin(rotationRad),
          y: localCenter.x * Math.sin(rotationRad) + localCenter.y * Math.cos(rotationRad),
        },
        { x: 5, y: 3 },
      ],
      rotationDeg: 30,
      fillColor: null,
      notes: null,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBeCloseTo(Math.sqrt(76.96), 10)
  })

  it('uses center distance plus radius for a circular Elliptical Zone', () => {
    const scene = createDefaultScenePersistedState()
    scene.zones.push({
      kind: 'zone',
      locked: false,
      name: 'circle',
      zoneType: 'ellipse',
      points: [
        { x: 3, y: 4 },
        { x: 10, y: 10 },
      ],
      rotationDeg: 73,
      fillColor: null,
      notes: null,
    })

    expect(computeScenePhysicalExtentMeters(scene)).toBe(15)
  })
})
