import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readCssSource(path: string): string {
  return readFileSync(`src/${path}`, 'utf8')
}

function classZIndex(path: string, className: string): number {
  const source = readCssSource(path)
  const rule = new RegExp(`\\.${className}\\s*\\{(?<body>[\\s\\S]*?)\\}`).exec(source)
  if (!rule?.groups?.body) throw new Error(`Missing .${className} CSS rule in ${path}`)
  const declaration = /z-index:\s*(?:(?<value>-?\d+)|var\((?<token>--z-[a-z-]+)\))\s*;/.exec(rule.groups.body)
  if (declaration?.groups?.value) return Number.parseInt(declaration.groups.value, 10)
  if (declaration?.groups?.token) return scaleToken(declaration.groups.token)
  throw new Error(`Missing .${className} z-index declaration`)
}

/** Resolves a stacking scale token from global.css. */
function scaleToken(name: string): number {
  const match = new RegExp(`${name}:\\s*(-?\\d+)`).exec(readCssSource('styles/global.css'))
  if (!match?.[1]) throw new Error(`Missing ${name} in global.css`)
  return Number.parseInt(match[1], 10)
}

function ruleBody(path: string, selector: string): string {
  const source = readCssSource(path)
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const rule = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'm').exec(source)
  if (!rule?.groups?.body) throw new Error(`Missing ${selector} CSS rule in ${path}`)
  return rule.groups.body
}

describe('floating chrome layering', () => {
  it('lays app-wide notices over the map on the opaque surface, under their translucent error tint', () => {
    // The last background layer is the surface, so the map never shows through the tint.
    const onSurface = /background:\s*linear-gradient\(var\(--color-danger-bg\),\s*var\(--color-danger-bg\)\),\s*var\(--color-surface\)\s*;/
    expect(ruleBody('web/BrowserAppShell.module.css', '.notice[data-tone="error"]')).toMatch(onSurface)
    expect(ruleBody('components/shared/DegradedBanner.module.css', '.banner .notice[data-notice-tone="error"]')).toMatch(onSurface)
  })

  it('stacks the title bar over the dock, the dock over the rails and chips, and all of them over map status', () => {
    const titleBar = classZIndex('components/shared/WorkspaceTitleBar.module.css', 'titleBar')
    const dock = classZIndex('components/shared/SidePanelDock.module.css', 'dock')
    const rails = [
      classZIndex('components/canvas/ToolRail.module.css', 'rail'),
      classZIndex('components/shared/PanelRail.module.css', 'rail'),
      classZIndex('components/canvas/ViewChip.module.css', 'chip'),
      classZIndex('components/canvas/ZoomControls.module.css', 'group'),
    ]
    const mapStatus = classZIndex('components/panels/Panels.module.css', 'basemapFeedback')

    expect(titleBar).toBeGreaterThan(dock)
    for (const rail of rails) {
      expect(dock).toBeGreaterThan(rail)
      expect(rail).toBeGreaterThan(mapStatus)
    }
  })

  it('stacks the phone sheet under the top bar and over the rails and status chips it can cover', () => {
    const sheet = classZIndex('components/shared/PhoneSheet.module.css', 'sheet')
    expect(classZIndex('components/shared/WorkspaceTitleBar.module.css', 'titleBar')).toBeGreaterThan(sheet)
    for (const [file, name] of [
      ['components/canvas/ToolRail.module.css', 'rail'],
      ['components/canvas/ZoomControls.module.css', 'group'],
      ['components/canvas/SelectionChip.module.css', 'chip'],
      ['components/canvas/SpeciesFocusChip.module.css', 'chip'],
      ['components/canvas/CanvasOverview.module.css', 'notice'],
    ] as const) {
      expect(sheet).toBeGreaterThan(classZIndex(file, name))
    }
  })

  it('keeps plant styling popovers above the rail that opens them', () => {
    expect(classZIndex('components/canvas/appearance.module.css', 'menu'))
      .toBeGreaterThan(classZIndex('components/canvas/ToolRail.module.css', 'rail'))
  })
})
