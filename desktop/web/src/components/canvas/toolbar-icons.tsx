// SVG icon components for the canvas toolbar.
// All icons use currentColor so they inherit the button's text color.

interface IconProps {
  className?: string
}

export function SelectIcon({ className }: IconProps) {
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
        d="M4 2L4 14L7.5 10.5L10 16L11.5 15.3L9 9.5L13.5 9.5L4 2Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function HandIcon({ className }: IconProps) {
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
        d="M8 3.5C8 2.67 8.67 2 9.5 2C10.33 2 11 2.67 11 3.5V9H11.5C11.5 9 11.5 7.5 11.5 6.5C11.5 5.67 12.17 5 13 5C13.83 5 14.5 5.67 14.5 6.5V9H15C15 9 15 8 15 7.5C15 6.67 15.67 6 16.5 6C17.33 6 18 6.67 18 7.5V12C18 15.31 15.31 18 12 18H10C7.79 18 6 16.21 6 14V9V3.5C6 2.67 6.67 2 7.5 2C8.33 2 9 2.67 9 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function UndoIcon({ className }: IconProps) {
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
        d="M8 5L4 9L8 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 9H12C14.21 9 16 10.79 16 13C16 15.21 14.21 17 12 17H9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function RedoIcon({ className }: IconProps) {
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
        d="M12 5L16 9L12 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 9H8C5.79 9 4 10.79 4 13C4 15.21 5.79 17 8 17H11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function RectangleIcon({ className }: IconProps) {
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
      <rect
        x="3"
        y="5"
        width="14"
        height="10"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function EllipseIcon({ className }: IconProps) {
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
      <ellipse
        cx="10"
        cy="10"
        rx="7"
        ry="5"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function PolygonIcon({ className }: IconProps) {
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
      {/* Pentagon */}
      <path
        d="M10 2.5L17 7.5L14.5 16H5.5L3 7.5L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function LineIcon({ className }: IconProps) {
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
      <line
        x1="3"
        y1="17"
        x2="17"
        y2="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="3" cy="17" r="2" fill="currentColor" />
      <circle cx="17" cy="3" r="2" fill="currentColor" />
    </svg>
  )
}

export function MeasurementGuideIcon({ className }: IconProps) {
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
      <line
        x1="3"
        y1="12"
        x2="17"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 2"
      />
      <line x1="3" y1="8" x2="3" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="17" y1="8" x2="17" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M7.5 6H12.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M8 4.5L7 6L8 7.5M12 4.5L13 6L12 7.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TextIcon({ className }: IconProps) {
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
        d="M3 4H17"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10 4V16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 16H13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function GridIcon({ className }: IconProps) {
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
      {/* 3×3 grid */}
      <rect x="2" y="2" width="16" height="16" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <line x1="8" y1="2" x2="8" y2="18" stroke="currentColor" strokeWidth="1" />
      <line x1="12" y1="2" x2="12" y2="18" stroke="currentColor" strokeWidth="1" />
      <line x1="2" y1="8" x2="18" y2="8" stroke="currentColor" strokeWidth="1" />
      <line x1="2" y1="12" x2="18" y2="12" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

export function SnapIcon({ className }: IconProps) {
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
      {/* Magnet shape */}
      <path
        d="M5 4C5 4 3 4 3 7V12C3 15.31 5.69 18 9 18H11C14.31 18 17 15.31 17 12V7C17 4 15 4 15 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line x1="5" y1="4" x2="5" y2="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="15" y1="4" x2="15" y2="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      {/* Gap in middle to suggest poles */}
      <line x1="8" y1="2" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function RulerIcon({ className }: IconProps) {
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
      {/* Diagonal ruler */}
      <rect
        x="2.5"
        y="8"
        width="15"
        height="4"
        rx="1"
        transform="rotate(-45 2.5 8)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Tick marks along the ruler diagonal */}
      <line x1="5" y1="10.5" x2="6.5" y2="9" stroke="currentColor" strokeWidth="1" />
      <line x1="8" y1="13.5" x2="9.5" y2="12" stroke="currentColor" strokeWidth="1" />
      <line x1="11" y1="10.5" x2="13" y2="8.5" stroke="currentColor" strokeWidth="1" />
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

export function ObjectStampIcon({ className }: IconProps) {
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
      <rect x="4" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="10" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 10L9 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M12.5 4.5L15.5 4.5L15.5 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SpacingIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx="3" cy="10" r="2" fill="currentColor" opacity="0.6" />
      <circle cx="7.5" cy="10" r="2" fill="currentColor" opacity="0.8" />
      <circle cx="12.5" cy="10" r="2" fill="currentColor" opacity="0.8" />
      <circle cx="17" cy="10" r="2" fill="currentColor" opacity="0.6" />
    </svg>
  )
}
