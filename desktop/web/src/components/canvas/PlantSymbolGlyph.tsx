import { useId } from 'preact/hooks'
import type { PlantSymbolId } from '../../canvas/runtime/scene'
import { getPlantSymbolArt, plantSymbolPath } from '../../canvas/runtime/plant-symbol-recipes'

interface PlantSymbolGlyphProps {
  symbol: PlantSymbolId
  className?: string
  size?: number
  /** Paint cut-outs in this colour, as the map does with the outline colour. Without it they are true holes. */
  cutoutColor?: string
}

/** The shared recipe as SVG in `currentColor`; the same contours the map and the PDF draw. */
export function PlantSymbolGlyph({ symbol, className, size = 24, cutoutColor }: PlantSymbolGlyphProps) {
  const maskId = useId()
  const art = getPlantSymbolArt(symbol, size)
  const body = plantSymbolPath(art.body)
  const cutouts = art.cutouts.length > 0 ? plantSymbolPath(art.cutouts) : null
  const punched = cutouts !== null && cutoutColor === undefined
  return (
    <svg className={className} width={size} height={size} viewBox="-1 -1 2 2"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" data-plant-symbol={symbol}>
      {punched && (
        <mask id={maskId} maskUnits="userSpaceOnUse" x="-1" y="-1" width="2" height="2">
          <rect x="-1" y="-1" width="2" height="2" fill="white" />
          <path d={cutouts} fill="black" fill-rule="nonzero" />
        </mask>
      )}
      <path d={body} fill="currentColor" fill-opacity="1" fill-rule="nonzero" mask={punched ? `url(#${maskId})` : undefined} />
      {cutouts !== null && !punched && <path d={cutouts} fill={cutoutColor} fill-rule="nonzero" />}
    </svg>
  )
}
