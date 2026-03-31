import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCanvasColor,
  isThemeManagedZoneFill,
  refreshCanvasTheme,
} from '../canvas/theme-refresh'

function makeLayer(findMap: Record<string, unknown[]>) {
  return {
    find: vi.fn((selector: string) => findMap[selector] ?? []),
    batchDraw: vi.fn(),
  }
}

describe('refreshCanvasTheme', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('refreshes cached colors from CSS variables and updates live annotation nodes', () => {
    const container = document.createElement('div')
    container.style.setProperty('--canvas-plant-label', '#101010')
    container.style.setProperty('--canvas-plant-label-muted', '#202020')
    container.style.setProperty('--canvas-guide-line', '#2f4f4f')
    container.style.setProperty('--canvas-guide-smart', '#b5432a')
    container.style.setProperty('--canvas-stack-badge-bg', '#5a7d3a')
    container.style.setProperty('--canvas-stack-badge-text', '#f8f4ed')
    container.style.setProperty('--canvas-annotation-text', '#303030')
    container.style.setProperty('--canvas-annotation-stroke', '#404040')
    container.style.setProperty('--canvas-annotation-surface', '#faf9f6')
    container.style.setProperty('--canvas-zone-stroke', '#505050')
    container.style.setProperty('--canvas-zone-fill', 'rgba(1, 2, 3, 0.4)')
    container.style.setProperty('--canvas-selection', 'rgba(10, 20, 30, 0.2)')
    container.style.setProperty('--canvas-selection-stroke', 'rgba(20, 30, 40, 0.6)')
    container.style.setProperty('--canvas-selection-anchor-fill', '#f5f4f0')
    document.body.appendChild(container)

    const plantLabel = { fill: vi.fn() }
    const botanicalLabel = { fill: vi.fn() }
    const stackBadgeBg = { fill: vi.fn() }
    const stackBadgeText = { fill: vi.fn() }
    const annotationText = { fill: vi.fn() }
    const guideLine = { stroke: vi.fn() }
    const smartGuide = { stroke: vi.fn() }
    const measurePill = { getClassName: () => 'Rect', fill: vi.fn() }
    const measureText = { getClassName: () => 'Text', fill: vi.fn() }
    const measureGroup = {
      getChildren: () => [measurePill, measureText],
    }
    const annotationLine = {
      getClassName: () => 'Line',
      closed: () => false,
      fillEnabled: () => false,
      fill: () => '',
      stroke: vi.fn(),
    }
    let managedZoneFill = 'rgba(45, 95, 63, 0.1)'
    const zoneShape = {
      getAttr: vi.fn(() => true),
      setAttr: vi.fn(),
      fill: vi.fn((value?: string) => {
        if (typeof value === 'undefined') return managedZoneFill
        managedZoneFill = value
        return zoneShape
      }),
      stroke: vi.fn(),
    }

    const plantsLayer = makeLayer({
      '.plant-label': [plantLabel],
      '.plant-botanical': [botanicalLabel],
      '.stackBadgeBg': [stackBadgeBg],
      '.stackBadgeText': [stackBadgeText],
    })
    const annotationsLayer = makeLayer({
      '.annotation-text': [annotationText],
      '.measure-label': [measureGroup],
      '.shape': [annotationLine],
      '.guide-line': [guideLine],
      '.smart-guide': [smartGuide],
    })
    const zonesLayer = makeLayer({
      '.shape': [zoneShape],
    })
    const transformer = {
      borderStroke: vi.fn(),
      anchorStroke: vi.fn(),
      anchorFill: vi.fn(),
      getLayer: () => ({ batchDraw: vi.fn() }),
    }

    refreshCanvasTheme(
      container,
      new Map([
        ['plants', plantsLayer as any],
        ['annotations', annotationsLayer as any],
        ['zones', zonesLayer as any],
      ]),
      transformer as any,
    )

    expect(getCanvasColor('annotation-stroke')).toBe('#404040')
    expect(getCanvasColor('guide-line')).toBe('#2f4f4f')
    expect(getCanvasColor('stack-badge-text')).toBe('#f8f4ed')
    expect(getCanvasColor('selection-anchor-fill')).toBe('#f5f4f0')
    expect(plantLabel.fill).toHaveBeenCalledWith('#101010')
    expect(botanicalLabel.fill).toHaveBeenCalledWith('#202020')
    expect(stackBadgeBg.fill).toHaveBeenCalledWith('#5a7d3a')
    expect(stackBadgeText.fill).toHaveBeenCalledWith('#f8f4ed')
    expect(annotationText.fill).toHaveBeenCalledWith('#303030')
    expect(guideLine.stroke).toHaveBeenCalledWith('#2f4f4f')
    expect(smartGuide.stroke).toHaveBeenCalledWith('#b5432a')
    expect(measurePill.fill).toHaveBeenCalledWith('#404040')
    expect(measureText.fill).toHaveBeenCalledWith('#faf9f6')
    expect(annotationLine.stroke).toHaveBeenCalledWith('#404040')
    expect(zoneShape.stroke).toHaveBeenCalledWith('#505050')
    expect(zoneShape.fill).toHaveBeenCalledWith('rgba(1, 2, 3, 0.4)')
    expect(transformer.anchorFill).toHaveBeenCalledWith('#f5f4f0')
  })

  it('preserves custom zone fills while still updating theme-managed fills', () => {
    const container = document.createElement('div')
    container.style.setProperty('--canvas-zone-stroke', '#505050')
    container.style.setProperty('--canvas-zone-fill', 'rgba(1, 2, 3, 0.4)')
    document.body.appendChild(container)

    let managedFill = 'rgba(45, 95, 63, 0.1)'
    let customFill = '#ff00aa'
    const managedZone = {
      getAttr: vi.fn(() => true),
      setAttr: vi.fn(),
      fill: vi.fn((value?: string) => {
        if (typeof value === 'undefined') return managedFill
        managedFill = value
        return managedZone
      }),
      stroke: vi.fn(),
    }
    const customZone = {
      getAttr: vi.fn(() => false),
      setAttr: vi.fn(),
      fill: vi.fn((value?: string) => {
        if (typeof value === 'undefined') return customFill
        customFill = value
        return customZone
      }),
      stroke: vi.fn(),
    }

    refreshCanvasTheme(
      container,
      new Map([
        ['zones', makeLayer({ '.shape': [managedZone, customZone] }) as any],
      ]),
    )

    expect(managedZone.fill).toHaveBeenCalledWith('rgba(1, 2, 3, 0.4)')
    expect(customZone.fill).not.toHaveBeenCalledWith('rgba(1, 2, 3, 0.4)')
    expect(customZone.setAttr).toHaveBeenCalledWith('data-theme-managed-fill', false)
  })
})

describe('isThemeManagedZoneFill', () => {
  it('recognizes both light and dark default zone fills as theme-managed', () => {
    expect(isThemeManagedZoneFill(null)).toBe(true)
    expect(isThemeManagedZoneFill('rgba(45, 95, 63, 0.1)')).toBe(true)
    expect(isThemeManagedZoneFill('rgba(200,180,150,0.06)')).toBe(true)
    expect(isThemeManagedZoneFill('#ff00aa')).toBe(false)
  })
})
