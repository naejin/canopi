// Tool rail and action glyphs on the 20×20 grid: 1.6 stroke, round caps, currentColor.

interface IconProps {
  className?: string
}

export type ToolIconName =
  | 'select'
  | 'hand'
  | 'plant-stamp'
  | 'plant-spacing'
  | 'object-stamp'
  | 'polygon'
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'measurement-guide'
  | 'undo'
  | 'redo'

const TOOL_ICON_PATHS: Record<ToolIconName, string> = {
  select: 'M5 3l10.5 6.6-4.7 1.3-2.1 4.6z',
  hand: 'M7 11V5.2a1.3 1.3 0 0 1 2.6 0V10M9.6 9.6V4a1.3 1.3 0 0 1 2.6 0v5.6M12.2 9.6V5.4a1.3 1.3 0 0 1 2.6 0V12c0 3.6-2.3 6-5.6 6-2.6 0-3.8-1.2-4.8-3.2L3 11.6a1.3 1.3 0 0 1 2.2-1.3L7 12.4',
  'plant-stamp': 'M10 17.5v-7M10 10.5C10 7 7.7 5 4 5c0 3.5 2.3 5.5 6 5.5zM10 10.5c0-3.5 2.3-5.5 6-5.5 0 3.5-2.3 5.5-6 5.5z',
  'plant-spacing': 'M2.5 16.5h15M4 16.5l1.5-1.5M4 16.5l1.5 1.5M16 16.5l-1.5-1.5M16 16.5l-1.5 1.5M5 11V8M5 8c0-1.7 1-2.8 2.6-2.8 0 1.7-1 2.8-2.6 2.8zM10 11V8M10 8c0-1.7 1-2.8 2.6-2.8 0 1.7-1 2.8-2.6 2.8zM15 11V8M15 8c0-1.7 1-2.8 2.6-2.8 0 1.7-1 2.8-2.6 2.8z',
  'object-stamp': 'M8 3.5h4v4l3.5 1.2V11h-11V8.7L8 7.5zM3.5 13.5h13v2.5h-13z',
  polygon: 'M4 7l6-4 6 4.5-2.2 8H6.2z',
  rectangle: 'M3.5 5.5h13v9h-13z',
  ellipse: 'M17 10c0 3-3.1 5.5-7 5.5S3 13 3 10s3.1-5.5 7-5.5S17 7 17 10z',
  line: 'M4 16L16 4',
  text: 'M4.5 6V4.5h11V6M10 4.5v11M7.5 15.5h5',
  'measurement-guide': 'M3 13.5L13.5 3l3.5 3.5L6.5 17zM6.5 10l1.6 1.6M9 7.5l1.6 1.6M11.5 5l1.6 1.6',
  undo: 'M7.5 12L3.5 8l4-4M3.5 8h8.5a4.5 4.5 0 0 1 0 9H9',
  redo: 'M12.5 12l4-4-4-4M16.5 8H8a4.5 4.5 0 0 0 0 9h3',
}

export function ToolIcon({ name, className }: IconProps & { readonly name: ToolIconName }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d={TOOL_ICON_PATHS[name]} />
    </svg>
  )
}

export function PaletteIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M10 3C6.13 3 3 5.91 3 9.5C3 12.54 5.29 15 8.11 15H9.28C9.85 15 10.31 15.46 10.31 16.03C10.31 16.84 10.98 17.5 11.79 17.5C15.22 17.5 18 14.72 18 11.29C18 6.71 14.19 3 10 3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="9" r="1" fill="currentColor" />
      <circle cx="10" cy="7" r="1" fill="currentColor" />
      <circle cx="13" cy="9" r="1" fill="currentColor" />
      <circle cx="8.5" cy="12" r="1" fill="currentColor" />
    </svg>
  )
}

export function PlantSymbolIcon({ className }: IconProps) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      data-icon="plant-symbol-marker"
    >
      <circle
        data-icon-part="marker"
        cx="10"
        cy="10"
        r="6.5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        data-icon-part="sprout"
        d="M10 14V8.8M10 9.6C8.6 8.2 7.1 7.8 5.8 8.4C6.5 9.9 8.2 10.4 10 9.6ZM10 9.6C11 7.9 12.8 7.2 14.2 7.6C13.8 9.3 12.1 10.2 10 9.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
