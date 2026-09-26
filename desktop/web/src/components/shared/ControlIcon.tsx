// Small glyphs for shared controls (chevrons, checks, close, search, notices).
// 20x20 grid, 1.6 stroke, round caps, currentColor; filled dots are drawn as circles.

const dot = (x: number, y: number, r = 1.35) => `M${x + r} ${y}a${r} ${r} 0 1 1-${2 * r} 0 ${r} ${r} 0 0 1 ${2 * r} 0z`

const STROKED = {
  'chevron-down': 'M5 8l5 5 5-5',
  'chevron-right': 'M8 5l5 5-5 5',
  check: 'M4 10.5l4 4 8-9',
  close: 'M5 5l10 10M15 5L5 15',
  search: 'M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM17 17l-3.8-3.8',
  alert: 'M10 3.5l7.5 13h-15zM10 8.5v3.5M10 14.5h.01',
  info: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 9v5M10 6.5h.01',
  clock: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM10 6v4l2.5 2.5',
} as const

const FILLED = {
  more: dot(5, 10) + dot(10, 10) + dot(15, 10),
  star: 'M10 2.2l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z',
} as const

export type ControlIconName = keyof typeof STROKED | keyof typeof FILLED

export function ControlIcon({ name, size = 16, className }: {
  readonly name: ControlIconName
  readonly size?: 16 | 18 | 20
  readonly className?: string
}) {
  const filled = name in FILLED
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false"
      fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style={{ flexShrink: 0 }}>
      <path d={filled ? FILLED[name as keyof typeof FILLED] : STROKED[name as keyof typeof STROKED]} />
    </svg>
  )
}
