import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'

import { createMapLibreEmptyStyle } from '../maplibre/config'
import { contrastRatio } from '../canvas/plant-colors'
import { getCanvasColor, refreshCanvasColorCache, CANVAS_COLOR_CSS_VARS } from '../canvas/theme-refresh'
import {
  CANVAS_MAP_BACKDROP_COLORS,
  getLabelHalo,
  getMapTextColor,
  getPlantSymbolEdgeColor,
  getStackBadgeBackgroundColor,
  getStackBadgeTextColor,
  resolveBackdropInk,
  setCanvasMapBackdrop,
  type CanvasMapBackdrop,
} from '../canvas/runtime/scene-visuals'

const GLOBAL_CSS = readFileSync('src/styles/global.css', 'utf8')
const THEMES = {
  light: readDeclarations(GLOBAL_CSS, '\n:root {'),
  dark: readDeclarations(GLOBAL_CSS, '\n[data-theme="dark"] {'),
} as const
const BACKDROPS: readonly CanvasMapBackdrop[] = ['basemap', 'dark-basemap', 'satellite', 'paper']

function readDeclarations(css: string, opener: string): Map<string, string> {
  const start = css.indexOf(opener)
  if (start < 0) throw new Error(`Missing block ${opener.trim()}`)
  const block = css.slice(start + opener.length, css.indexOf('\n}', start)).replace(/\/\*[\s\S]*?\*\//g, '')
  const declarations = new Map<string, string>()
  for (const match of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) declarations.set(match[1]!, match[2]!.trim())
  return declarations
}

function applyUiTheme(theme: keyof typeof THEMES): void {
  const container = document.createElement('div')
  for (const cssVar of Object.values(CANVAS_COLOR_CSS_VARS)) {
    const token = THEMES[theme].get(cssVar)
    if (token) container.style.setProperty(cssVar, token)
  }
  refreshCanvasColorCache(container)
}

describe('canvas label ink follows the map backdrop, not the UI theme', () => {
  afterEach(() => {
    applyUiTheme('light')
    setCanvasMapBackdrop('basemap')
  })

  for (const theme of ['light', 'dark'] as const) {
    for (const backdrop of BACKDROPS) {
      it(`${theme} UI over ${backdrop}: labels, annotations and halos contrast with the backdrop`, () => {
        applyUiTheme(theme)
        setCanvasMapBackdrop(backdrop)
        const background = CANVAS_MAP_BACKDROP_COLORS[backdrop]

        const ink = getMapTextColor()
        expect(contrastRatio(ink, background), `ink ${ink} on ${background}`).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(ink, getLabelHalo(12).color), 'halo under the ink').toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(getStackBadgeBackgroundColor(), background)).toBeGreaterThanOrEqual(4.5)
        expect(contrastRatio(getStackBadgeTextColor(), getStackBadgeBackgroundColor())).toBeGreaterThanOrEqual(4.5)

        // A plant painted in the backdrop colour still gets a contrasting edge.
        const edge = getPlantSymbolEdgeColor(background)
        expect(contrastRatio(edge, background)).toBeGreaterThanOrEqual(3)
      })
    }
  }

  it('resolves the same ink in both UI themes', () => {
    for (const backdrop of BACKDROPS) {
      setCanvasMapBackdrop(backdrop)
      applyUiTheme('light')
      const light = [getMapTextColor(), getLabelHalo(12).color, getStackBadgeBackgroundColor()]
      applyUiTheme('dark')
      const dark = [getMapTextColor(), getLabelHalo(12).color, getStackBadgeBackgroundColor()]
      expect(dark, backdrop).toEqual(light)
    }
  })

  it('keeps cream text on a dark halo over satellite imagery', () => {
    setCanvasMapBackdrop('satellite')
    expect(getMapTextColor()).toBe('#FFF3D6')
    expect(getLabelHalo(12).color).toBe('#14100A')
  })

  it('treats no background as the map’s own paper colour', () => {
    const background = createMapLibreEmptyStyle().layers[0]!
    expect(background.type).toBe('background')
    const paint = (background as { paint?: Record<string, unknown> }).paint
    expect(String(paint?.['background-color']).toLowerCase()).toBe(CANVAS_MAP_BACKDROP_COLORS.paper.toLowerCase())
  })

  it('resolves ink for the inspection lens paper, which follows the UI theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      applyUiTheme(theme)
      const paper = getCanvasColor('background')
      const ink = resolveBackdropInk(paper)
      expect(contrastRatio(ink.text, paper), theme).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(ink.badgeBackground, paper), theme).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(getPlantSymbolEdgeColor(paper, paper), paper), theme).toBeGreaterThanOrEqual(3)
    }
  })

  it('reports whether the backdrop changed', () => {
    setCanvasMapBackdrop('basemap')
    expect(setCanvasMapBackdrop('basemap')).toBe(false)
    expect(setCanvasMapBackdrop('satellite')).toBe(true)
  })
})
