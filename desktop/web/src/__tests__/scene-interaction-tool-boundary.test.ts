import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function readSource(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

describe('Scene Interaction tool module boundaries', () => {
  it('keeps Annotation Text editor state behind the text tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const textToolSource = readSource('../canvas/runtime/interaction/text-annotation-tool.ts')

    expect(interactionSource).toContain('createTextAnnotationTool')
    expect(interactionSource).not.toContain('HTMLTextAreaElement')
    expect(interactionSource).not.toContain('_textarea')
    expect(interactionSource).not.toContain('_textWorldPosition')
    expect(textToolSource).toContain('appendTextAnnotationToDraft')
  })

  it('keeps Zone drawing draft state behind the zone drawing tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const zoneToolSource = readSource('../canvas/runtime/interaction/zone-drawing-tool.ts')

    expect(interactionSource).toContain('createZoneDrawingTool')
    expect(interactionSource).not.toContain('_polygonDraftVertices')
    expect(interactionSource).not.toContain('_polygonActiveWorld')
    expect(interactionSource).not.toContain('appendRectangleZoneToDraft')
    expect(interactionSource).not.toContain('appendEllipseZoneToDraft')
    expect(interactionSource).not.toContain('appendPolygonZoneToDraft')
    expect(zoneToolSource).toContain('appendRectangleZoneToDraft')
    expect(zoneToolSource).toContain('appendEllipseZoneToDraft')
    expect(zoneToolSource).toContain('appendPolygonZoneToDraft')
  })

  it('keeps Object Stamp source state behind the object stamp tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const objectStampSource = readSource('../canvas/runtime/interaction/object-stamp-tool.ts')

    expect(interactionSource).toContain('createObjectStampTool')
    expect(interactionSource).not.toContain('_objectStampSource')
    expect(interactionSource).not.toContain('_sampleObjectStampSource')
    expect(interactionSource).not.toContain('_placeObjectStamp')
    expect(objectStampSource).toContain('ObjectStampSource')
    expect(objectStampSource).toContain('cloneGroupMembersForObjectStamp')
  })

  it('keeps Plant Spacing source state behind the plant spacing tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const plantSpacingSource = readSource('../canvas/runtime/interaction/plant-spacing-tool.ts')

    expect(interactionSource).toContain('createPlantSpacingTool')
    expect(interactionSource).not.toContain('_plantSpacingSource')
    expect(interactionSource).not.toContain('_plantSpacingIntervalText')
    expect(interactionSource).not.toContain('_plantSpacingGeneratedPositions')
    expect(interactionSource).not.toContain('_commitPlantSpacingPreview')
    expect(plantSpacingSource).toContain('PlantSpacingSource')
    expect(plantSpacingSource).toContain('createPlantSpacingOverlay')
  })

  it('keeps active tool drag state generic in the scene interaction router', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')

    expect(interactionSource).toContain('ToolPointerDrag')
    expect(interactionSource).not.toContain("'plant-spacing-drag'")
    expect(interactionSource).not.toContain("this._mode = 'rectangle'")
    expect(interactionSource).not.toContain("this._mode = 'ellipse'")
    expect(interactionSource).not.toContain("this._mode === 'rectangle'")
    expect(interactionSource).not.toContain("this._mode === 'ellipse'")
  })
})
