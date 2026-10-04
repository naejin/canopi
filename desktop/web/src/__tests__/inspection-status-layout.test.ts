import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('the raster inspection status rises above the rulers hint while the hint shows, so the hint never covers it (spec §4.6)', () => {
  // The hint (data-rulers-north-hint) stands above the view chip in the chip's wrapper, a sibling before the status.
  const css = readFileSync('src/components/canvas/inspection-status.module.css', 'utf8')
  const raised = /:global\(\*:has\(> \[data-rulers-north-hint\]\)\) ~ \.status \{(?<body>[^}]*)\}/.exec(css)?.groups?.body ?? ''
  expect(raised).toContain(
    'bottom: calc(var(--chrome-inset) + var(--control-size-3xl) + var(--space-2) + var(--control-size-2xl) + var(--space-2))',
  )
})

it('the status stays at the bottom chrome on a narrow canvas, where the view chip and the rulers hint are hidden', () => {
  // The chip's narrow-canvas rule hides its wrapper but the hint stays in the DOM, so the raised rule must carry the
  // complementary container condition or the status floats over an empty gap.
  const chip = readFileSync('src/components/canvas/ViewChip.module.css', 'utf8')
  const breakpoint = /@container \(max-width: (?<px>\d+)px\) \{\s*\.wrapper \{\s*display: none;/.exec(chip)?.groups?.px
  expect(breakpoint).toBe('600')
  const css = readFileSync('src/components/canvas/inspection-status.module.css', 'utf8')
  const wide = new RegExp(`@container \\(width > ${breakpoint}px\\) \\{(?<body>[\\s\\S]*?)\\n\\}`).exec(css)
  expect(wide?.groups?.body ?? '').toMatch(/:global\(\*:has\(> \[data-rulers-north-hint\]\)\) ~ \.status \{/)
  expect(css.replace(wide?.[0] ?? '', '')).not.toContain('data-rulers-north-hint')
})
