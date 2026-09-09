export const MM = 72 / 25.4
// Provisional physical dimensions; the print-review bead owns final calibration.
export const PRINT = { margin: 10 * MM, legend: 42 * MM, gutter: 5 * MM, text: 10, line: 13,
  legendRule: '#d8d2c8', legendGap: 2, legendSampleGap: .8 * MM, marker: 1.5 * MM, stroke: .25 * MM, header: 22 * MM, footer: 17 * MM, ink: '#24211c' } as const
