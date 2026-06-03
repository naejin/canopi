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
    expect(interactionSource).toContain('createTextAnnotationToolAdapter')
    expect(interactionSource).not.toContain('_textTool')
    expect(interactionSource).not.toContain('hasActiveEditor')
    expect(interactionSource).not.toContain('HTMLTextAreaElement')
    expect(interactionSource).not.toContain('_textarea')
    expect(interactionSource).not.toContain('_textWorldPosition')
    expect(textToolSource).toContain('appendTextAnnotationToDraft')
    expect(textToolSource).toContain('createTextAnnotationToolAdapter')
  })

  it('keeps Zone drawing draft state behind the zone drawing tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const zoneToolSource = readSource('../canvas/runtime/interaction/zone-drawing-tool.ts')

    expect(interactionSource).toContain('createZoneDrawingTool')
    expect(interactionSource).toContain('createZoneDrawingToolAdapters')
    expect(interactionSource).not.toContain('_zoneDrawing')
    expect(interactionSource).not.toContain('hasPolygonDraft')
    expect(interactionSource).not.toContain('preservePolygonDraft')
    expect(interactionSource).not.toContain('_polygonDraftVertices')
    expect(interactionSource).not.toContain('_polygonActiveWorld')
    expect(interactionSource).not.toContain('appendRectangleZoneToDraft')
    expect(interactionSource).not.toContain('appendEllipseZoneToDraft')
    expect(interactionSource).not.toContain('appendPolygonZoneToDraft')
    expect(zoneToolSource).toContain('appendRectangleZoneToDraft')
    expect(zoneToolSource).toContain('appendEllipseZoneToDraft')
    expect(zoneToolSource).toContain('appendPolygonZoneToDraft')
    expect(zoneToolSource).toContain('createZoneDrawingToolAdapters')
  })

  it('keeps Object Stamp source state behind the object stamp tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const objectStampSource = readSource('../canvas/runtime/interaction/object-stamp-tool.ts')

    expect(interactionSource).toContain('createObjectStampTool')
    expect(interactionSource).toContain('createObjectStampToolAdapter')
    expect(interactionSource).not.toContain('_objectStampTool')
    expect(interactionSource).not.toContain('_objectStampSource')
    expect(interactionSource).not.toContain('_sampleObjectStampSource')
    expect(interactionSource).not.toContain('_placeObjectStamp')
    expect(objectStampSource).toContain('ObjectStampSource')
    expect(objectStampSource).toContain('cloneGroupMembersForObjectStamp')
    expect(objectStampSource).toContain('createObjectStampToolAdapter')
  })

  it('keeps Plant Spacing source state behind the plant spacing tool module', () => {
    const interactionSource = readSource('../canvas/runtime/scene-interaction.ts')
    const plantSpacingSource = readSource('../canvas/runtime/interaction/plant-spacing-tool.ts')

    expect(interactionSource).toContain('createPlantSpacingTool')
    expect(interactionSource).toContain('createPlantSpacingToolAdapter')
    expect(interactionSource).not.toContain('_plantSpacingTool')
    expect(interactionSource).not.toContain('shouldBeginDrag')
    expect(interactionSource).not.toContain('updatePreviewFromEvent')
    expect(interactionSource).not.toContain('commitDragFromEvent')
    expect(interactionSource).not.toContain('_plantSpacingSource')
    expect(interactionSource).not.toContain('_plantSpacingIntervalText')
    expect(interactionSource).not.toContain('_plantSpacingGeneratedPositions')
    expect(interactionSource).not.toContain('_commitPlantSpacingPreview')
    expect(plantSpacingSource).toContain('PlantSpacingSource')
    expect(plantSpacingSource).toContain('createPlantSpacingOverlay')
    expect(plantSpacingSource).toContain('createPlantSpacingToolAdapter')
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
