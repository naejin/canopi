import type { PlantSymbolId } from '../../canvas/runtime/scene'
import { getPlantSymbolShapes, plantSymbolShapePath } from '../../canvas/runtime/plant-symbol-recipes'

interface PlantSymbolGlyphProps {
  symbol: PlantSymbolId
  className?: string
  size?: number
}

export function PlantSymbolGlyph({ symbol, className, size = 24 }: PlantSymbolGlyphProps) {
  return (
    <svg className={className} width={size} height={size} viewBox="-1 -1 2 2"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      {getPlantSymbolShapes(symbol, size).map((shape, index) => (
        <path key={index} d={plantSymbolShapePath(shape)} fill="currentColor" fill-opacity="1" fill-rule="nonzero" />
      ))}
    </svg>
  )
}
