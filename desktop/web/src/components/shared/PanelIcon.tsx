import type { Panel } from '../../app/shell/state'

const PANEL_ICON_STROKE_WIDTH = 1.5

const panelIcons: Record<Panel, () => preact.JSX.Element> = {
  'species-key': () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="5" cy="6" r="2" />
      <path d="m5 10 2.5 4h-5Z" />
      <rect x="3" y="18" width="4" height="4" rx=".5" />
      <path d="M11 6h10M11 13h10M11 20h10" />
    </svg>
  ),
  layers: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </svg>
  ),
  canvas: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={PANEL_ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    </svg>
  ),
  location: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={PANEL_ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a11 11 0 0 1 0 16" />
      <path d="M12 4a11 11 0 0 0 0 16" />
      <path d="M4 12h16" />
    </svg>
  ),
  templates: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={PANEL_ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 6.5h18" />
      <path d="M5 6.5v12" />
      <path d="M19 6.5v12" />
      <path d="M7 18.5h10" />
      <path d="M8.5 10.5h7" />
      <path d="M8.5 13.5h4" />
    </svg>
  ),
  'plant-db': () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={PANEL_ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.9C15.5 4.9 17 3.5 19 2c1 2 2 4.5 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  ),
  'design-notebook': () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={PANEL_ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" />
      <path d="M4 5.5v16" />
      <path d="M8 7h8" />
      <path d="M8 11h6" />
    </svg>
  ),
  favorites: () => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={PANEL_ICON_STROKE_WIDTH}
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
}

export function PanelIcon({ panel }: { readonly panel: Panel }) {
  const Icon = panelIcons[panel]
  return <Icon />
}
