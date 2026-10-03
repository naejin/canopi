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
