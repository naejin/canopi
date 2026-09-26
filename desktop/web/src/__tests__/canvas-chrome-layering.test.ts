import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readCssSource(path: string): string {
  return readFileSync(`src/${path}`, 'utf8')
}

function classZIndex(path: string, className: string): number {
  const source = readCssSource(path)
  const rule = new RegExp(`\\.${className}\\s*\\{(?<body>[\\s\\S]*?)\\}`).exec(source)
  if (!rule?.groups?.body) throw new Error(`Missing .${className} CSS rule in ${path}`)
  const declaration = /z-index:\s*(?<value>-?\d+)\s*;/.exec(rule.groups.body)
  if (!declaration?.groups?.value) throw new Error(`Missing .${className} z-index declaration`)
  return Number.parseInt(declaration.groups.value, 10)
}

describe('floating chrome layering', () => {
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

  it('keeps plant styling popovers above the rail that opens them', () => {
    expect(classZIndex('components/canvas/appearance.module.css', 'menu'))
      .toBeGreaterThan(classZIndex('components/canvas/ToolRail.module.css', 'rail'))
  })
})
