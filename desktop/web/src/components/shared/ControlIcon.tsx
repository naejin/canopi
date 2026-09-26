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
  draft: 'M5 2.5h6.5L15 6v11.5H5zM11.5 2.5V6H15M7.5 10.5h5M7.5 13.5h3',
  help: 'M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0zM7.8 7.8a2.3 2.3 0 0 1 4.4.8c0 1.6-2.2 2-2.2 3.3M10 14.4h.01',
  gear: 'M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2zM8.6 2.6h2.8l.4 2 1.7 1 1.9-.7 1.4 2.4-1.5 1.4v2l1.5 1.4-1.4 2.4-1.9-.7-1.7 1-.4 2H8.6l-.4-2-1.7-1-1.9.7-1.4-2.4 1.5-1.4v-2L3.2 7.3l1.4-2.4 1.9.7 1.7-1z',
  'folder-open': 'M2.5 15.5v-10h5L9 7h6.5v2M2.5 15.5l2.5-6.5h13l-2.5 6.5z',
  plus: 'M10 4v12M4 10h12',
  menu: 'M3.5 5.5h13M3.5 10h13M3.5 14.5h13',
  minus: 'M4 10h12',
  fit: 'M3.5 7v-3.5H7M16.5 7V3.5H13M3.5 13v3.5H7M16.5 13v3.5H13M7.5 8.5h5v3h-5z',
  pin: 'M10 17.5s-5.5-5-5.5-9A5.5 5.5 0 0 1 15.5 8.5c0 4-5.5 9-5.5 9zM10 10.3a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z',
  keyboard: 'M2.5 5.5h15v9h-15zM5.5 8.5h.01M8.5 8.5h.01M11.5 8.5h.01M14.5 8.5h.01M6.5 11.5h7',
  bug: 'M7 7.5a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0zM7 10H3.5M16.5 10H13M7.3 14l-2.8 2M12.7 14l2.8 2M7.3 6.5L5 4.5M12.7 6.5L15 4.5M10 9v6',
  trash: 'M4 6h12M8 6V4.5h4V6M6 6l.8 10.5h6.4L14 6',
  sun: 'M10 13.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM10 2v1.5M10 16.5V18M2 10h1.5M16.5 10H18M4.3 4.3l1.1 1.1M14.6 14.6l1.1 1.1M4.3 15.7l1.1-1.1M14.6 5.4l1.1-1.1',
  'window-minimize': 'M5 10h10',
  'window-maximize': 'M5 5h10v10H5z',
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
