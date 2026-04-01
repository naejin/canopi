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

export function FreeformIcon({ className }: IconProps) {
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
        d="M2 13C4 13 4 7 6 7C8 7 8 13 10 13C12 13 12 7 14 7C16 7 16 11 18 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
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

export function MeasureIcon({ className }: IconProps) {
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
      {/* Ruler body */}
      <rect
        x="2"
        y="7"
        width="16"
        height="6"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      {/* Tick marks */}
      <line x1="5" y1="7" x2="5" y2="10" stroke="currentColor" strokeWidth="1" />
      <line x1="8" y1="7" x2="8" y2="9" stroke="currentColor" strokeWidth="1" />
      <line x1="11" y1="7" x2="11" y2="10" stroke="currentColor" strokeWidth="1" />
      <line x1="14" y1="7" x2="14" y2="9" stroke="currentColor" strokeWidth="1" />
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

export function PlantStampIcon({ className }: IconProps) {
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
      {/* Stem */}
      <line
        x1="10"
        y1="17"
        x2="10"
        y2="10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Left leaf */}
      <path
        d="M10 12C10 12 6 11 5 8C7 7 10 9 10 12Z"
        fill="currentColor"
        opacity="0.7"
      />
      {/* Right leaf */}
      <path
        d="M10 10C10 10 14 9 15 6C13 5 10 7 10 10Z"
        fill="currentColor"
        opacity="0.7"
      />
      {/* Main leaf / bud */}
      <path
        d="M10 10C10 10 7 6 10 3C13 6 10 10 10 10Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function DimensionIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="1.5" />
      <line x1="4" y1="6" x2="4" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <line x1="16" y1="6" x2="16" y2="14" stroke="currentColor" strokeWidth="1.5" />
      <text x="10" y="8" textAnchor="middle" fill="currentColor" fontSize="6" fontFamily="system-ui">m</text>
    </svg>
  )
}

export function PatternFillIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="14" height="14" rx="1" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <circle cx="7" cy="7" r="1.5" fill="currentColor" opacity="0.6" />
      <circle cx="13" cy="7" r="1.5" fill="currentColor" opacity="0.6" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" opacity="0.6" />
      <circle cx="7" cy="13" r="1.5" fill="currentColor" opacity="0.6" />
      <circle cx="13" cy="13" r="1.5" fill="currentColor" opacity="0.6" />
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

export function ArrowIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="4" y1="16" x2="14" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <polyline points="9,5 15,5 15,11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function CalloutIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="3" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <polyline points="6,14 8,18 10,14" fill="currentColor" opacity="0.6" />
      <line x1="5" y1="7" x2="15" y2="7" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <line x1="5" y1="10" x2="12" y2="10" stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  )
}

export function AlignLeftIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="3" y1="2" x2="3" y2="18" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="4" width="12" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="5" y="12" width="8" height="4" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

export function AlignCenterIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="10" y1="2" x2="10" y2="18" stroke="currentColor" strokeWidth="1" strokeDasharray="2 2" />
      <rect x="3" y="4" width="14" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="5" y="12" width="10" height="4" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

export function AlignRightIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <line x1="17" y1="2" x2="17" y2="18" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="4" width="12" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="7" y="12" width="8" height="4" rx="1" fill="currentColor" opacity="0.7" />
    </svg>
  )
}

export function DistributeHIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="5" width="4" height="10" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="8" y="7" width="4" height="6" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="14" y="4" width="4" height="12" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

export function DistributeVIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="5" y="2" width="10" height="4" rx="1" fill="currentColor" opacity="0.5" />
      <rect x="7" y="8" width="6" height="4" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="4" y="14" width="12" height="4" rx="1" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

export function MinimapIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="16" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <rect x="10" y="10" width="6" height="5" rx="0.5" stroke="currentColor" strokeWidth="1" fill="currentColor" opacity="0.2" />
      <circle cx="6" cy="7" r="1.5" fill="currentColor" opacity="0.4" />
      <circle cx="9" cy="5" r="1" fill="currentColor" opacity="0.4" />
    </svg>
  )
}

export function GuideIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Vertical guide line */}
      <line x1="7" y1="1" x2="7" y2="19" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      {/* Horizontal guide line */}
      <line x1="1" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
      {/* Snap indicator dot at intersection */}
      <circle cx="7" cy="13" r="2" fill="currentColor" opacity="0.6" />
    </svg>
  )
}
