import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Popups portal to <body>, so only the z-index scale decides whether a menu
// opened inside a dialog shows above it. A raw number here once put the
// Settings language list behind the Settings dialog.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

function token(css: string, name: string): number {
  const match = new RegExp(`${name}:\\s*(\\d+)`).exec(css)
  if (!match) throw new Error(`missing ${name}`)
  return Number(match[1])
}

const FILES = {
  dropdown: '../components/shared/Dropdown.module.css',
  datePicker: '../components/shared/DatePicker.module.css',
  actionMenu: '../components/shared/ActionMenu.module.css',
  appearance: '../components/canvas/appearance.module.css',
  tooltip: '../components/shared/ButtonTooltip.module.css',
  workspaceDialog: '../components/shared/WorkspaceDialog.module.css',
  aboutDialog: '../components/shared/AboutCanopiDialog.module.css',
  savedViewDialogs: '../components/shared/SavedViewDialogs.module.css',
  saveProblem: '../components/shared/save-problem-dialog.module.css',
  problemReport: '../components/shared/ProblemReportDialog.module.css',
  commandPalette: '../components/shared/CommandPalette.module.css',
  pdfExport: '../components/canvas-pdf/canvas-pdf.module.css',
  storyPresenter: '../components/stories/StoryPresenter.module.css',
} as const

describe('stacking order', () => {
  const global = read('../styles/global.css')

  it('puts popups above every dialog and full-window surface, and tooltips above popups', () => {
    const fullWindow = token(global, '--z-full-window')
    const toast = token(global, '--z-toast')
    const dialog = token(global, '--z-dialog')
    const alert = token(global, '--z-dialog-alert')
    const popover = token(global, '--z-popover')
    const tooltip = token(global, '--z-tooltip')
    expect(fullWindow).toBeLessThan(toast)
    expect(toast).toBeLessThan(dialog)
    expect(dialog).toBeLessThan(alert)
    expect(alert).toBeLessThan(popover)
    expect(popover).toBeLessThan(tooltip)
  })

  it('layers dialogs, popups and full-window surfaces only through the scale tokens', () => {
    for (const [name, path] of Object.entries(FILES)) {
      const css = read(path)
      const raw = [...css.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1]))
      // In-flow layers inside a surface may stay small; anything that competes
      // with dialogs must use a token.
      expect(raw.filter((value) => value > 40), name).toEqual([])
    }
  })

  it('floats portalled popups on the popover layer', () => {
    expect(read(FILES.dropdown)).toMatch(/\.menuFloating\s*\{[^}]*z-index:\s*var\(--z-popover\)/)
    expect(read(FILES.datePicker)).toMatch(/\.calendarFloating\s*\{[^}]*z-index:\s*var\(--z-popover\)/)
    expect(read(FILES.actionMenu)).toMatch(/\.menu\s*\{[^}]*z-index:\s*var\(--z-popover\)/)
    expect(read(FILES.appearance)).toMatch(/\.menu\s*\{[^}]*z-index:\s*var\(--z-popover\)/)
    expect(read(FILES.tooltip)).toMatch(/z-index:\s*var\(--z-tooltip\)/)
  })
})
