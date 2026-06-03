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
})
