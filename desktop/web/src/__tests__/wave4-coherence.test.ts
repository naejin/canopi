import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const RETAINED_CSS_MODULES = [
  '../App.module.css',
  '../components/shared/ShellNotice.module.css',
  '../components/shared/CommandPalette.module.css',
  '../components/shared/TitleBar.module.css',
  '../components/shared/Dropdown.module.css',
  '../components/shared/SettingsModal.module.css',
  '../components/shared/WelcomeScreen.module.css',
  '../components/canvas/BottomPanel.module.css',
  '../components/panels/PanelBar.module.css',
  '../components/panels/Panels.module.css',
  '../components/panels/FavoritesPanel.module.css',
  '../components/canvas/CanvasToolbar.module.css',
  '../components/canvas/DisplayLegend.module.css',
  '../components/canvas/DisplayModeControls.module.css',
  '../components/canvas/ZoomControls.module.css',
  '../components/canvas/BottomPanelLauncher.module.css',
  '../components/canvas/LayerPanel.module.css',
  '../components/canvas/LocationTab.module.css',
  '../components/plant-db/PlantDb.module.css',
  '../components/plant-db/MoreFiltersPanel.module.css',
  '../components/plant-db/FilterChip.module.css',
  '../components/plant-db/RangeSlider.module.css',
  '../components/plant-db/ThresholdSlider.module.css',
] as const

function readCssSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const FORBIDDEN_DECLARATIONS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'font-size', pattern: /font-size:\s*\d+px/ },
  { name: 'padding', pattern: /padding(?:-(?:top|right|bottom|left))?:\s*(?![^;]*calc\()[^;]*\d+px/ },
  { name: 'margin', pattern: /margin(?:-(?:top|right|bottom|left))?:\s*(?![^;]*calc\()[^;]*\d+px/ },
  { name: 'gap', pattern: /gap:\s*\d+px/ },
  { name: 'border-radius', pattern: /border-radius:\s*\d+px/ },
  { name: 'transition', pattern: /transition(?:-(?:property|duration|timing-function|delay))?:\s*(?!var\()[^;]*\d+(?:ms|s)/ },
]

describe('wave 4 retained-surface coherence guard', () => {
  it('avoids raw font, spacing, radius, and transition declarations in retained CSS modules', () => {
    const violations: string[] = []

    for (const path of RETAINED_CSS_MODULES) {
      const text = readCssSource(path)
      const lines = text.split('\n')

      lines.forEach((line, index) => {
        for (const rule of FORBIDDEN_DECLARATIONS) {
          if (rule.pattern.test(line)) {
            violations.push(`${path}:${index + 1} ${rule.name}: ${line.trim()}`)
          }
        }
      })
    }

    expect(violations).toEqual([])
  })
})
