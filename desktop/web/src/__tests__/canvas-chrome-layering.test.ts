import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readCssSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

function classZIndex(source: string, className: string): number {
  const rule = new RegExp(`\\.${className}\\s*\\{(?<body>[\\s\\S]*?)\\}`).exec(source)
  if (!rule?.groups?.body) {
    throw new Error(`Missing .${className} CSS rule`)
  }
  const declaration = /z-index:\s*(?<value>-?\d+)\s*;/.exec(rule.groups.body)
  if (!declaration?.groups?.value) {
    throw new Error(`Missing .${className} z-index declaration`)
  }
  return Number.parseInt(declaration.groups.value, 10)
}

describe('canvas chrome layering', () => {
  it('keeps plant styling popovers above the Location Notice stacking context', () => {
    const panelsCss = readCssSource('../components/panels/Panels.module.css')
    const toolbarCss = readCssSource('../components/canvas/CanvasToolbar.module.css')
    const locationNoticeZIndex = classZIndex(panelsCss, 'basemapFeedback')
    const toolbarZIndex = classZIndex(toolbarCss, 'toolbar')

    expect(toolbarZIndex).toBeGreaterThan(locationNoticeZIndex)
  })
})
