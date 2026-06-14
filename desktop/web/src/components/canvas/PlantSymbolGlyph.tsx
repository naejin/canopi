import type { PlantSymbolId } from '../../canvas/runtime/scene'
import { PLANT_SYMBOL_RECIPES } from '../../canvas/runtime/plant-symbol-recipes'

interface PlantSymbolGlyphProps {
  symbol: PlantSymbolId
  className?: string
}

export function PlantSymbolGlyph({ symbol, className }: PlantSymbolGlyphProps) {
  return (
    <svg
      className={className}
      viewBox="-1 -1 2 2"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      {PLANT_SYMBOL_RECIPES[symbol].map((command, index) => {
        switch (command.kind) {
          case 'circle':
            return (
              <circle
                key={index}
                cx={command.cx}
                cy={command.cy}
                r={command.radius}
                fill={command.fill ? 'currentColor' : 'none'}
                fillOpacity={command.fill ? 0.55 : undefined}
                stroke={command.stroke ? 'currentColor' : 'none'}
                strokeWidth={command.stroke ? 0.14 : undefined}
              />
            )
          case 'rect':
            return (
              <rect
                key={index}
                x={command.x}
                y={command.y}
                width={command.width}
                height={command.height}
                fill={command.fill ? 'currentColor' : 'none'}
                fillOpacity={command.fill ? 0.55 : undefined}
                stroke={command.stroke ? 'currentColor' : 'none'}
                strokeWidth={command.stroke ? 0.14 : undefined}
              />
            )
          case 'path': {
            const first = command.points[0]
            if (!first) return null
            const d = [
              `M ${first[0]} ${first[1]}`,
              ...command.points.slice(1).map((point) => `L ${point[0]} ${point[1]}`),
              command.closed ? 'Z' : '',
            ].join(' ')
            return (
              <path
                key={index}
                d={d}
                fill={command.fill ? 'currentColor' : 'none'}
                fillOpacity={command.fill ? 0.55 : undefined}
                stroke={command.stroke ? 'currentColor' : 'none'}
                strokeWidth={command.stroke ? 0.14 : undefined}
                strokeLinejoin="round"
              />
            )
          }
          case 'lines':
            return (
              <g key={index}>
                {command.segments.map((segment, segmentIndex) => (
                  <line
                    key={segmentIndex}
                    x1={segment[0]}
                    y1={segment[1]}
                    x2={segment[2]}
                    y2={segment[3]}
                    stroke="currentColor"
                    strokeWidth={0.16}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
              </g>
            )
        }
      })}
    </svg>
  )
}
