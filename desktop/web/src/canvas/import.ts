// Gated: re-enable when .canopi background-image persistence is implemented.
// The command entry in commands/registry.ts is commented out.
import Konva from 'konva'
import type { CanvasEngine } from './engine'
import { canvasClean } from '../state/design'

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024 // 10 MB
const TARGET_IMAGE_SIZE_M = 50 // Scale image to fit ~50 meters on its longest side

/**
 * Import a raster image as a background on the base layer.
 * The image is scaled to fit ~50m on its longest side (reasonable for a garden plan)
 * and centered in the current viewport. Semi-transparent for design overlay.
 *
 * NOTE: Konva.Image nodes cannot be serialized/deserialized through the command
 * system because HTMLImageElement is not JSON-serializable. We add directly to
 * the layer instead of using AddNodeCommand. Delete still works (by node ID).
 */
export async function importBackgroundImage(
  engine: CanvasEngine,
  file: File,
): Promise<void> {
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    console.warn(
      `Background image is ${(file.size / 1024 / 1024).toFixed(1)} MB — ` +
        'consider a smaller image for better performance.',
    )
  }

  return new Promise<void>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      const img = new Image()

      img.onload = () => {
        // Scale image so its longest side = TARGET_IMAGE_SIZE_M meters
        const aspect = img.naturalWidth / img.naturalHeight
        let widthM: number, heightM: number
        if (aspect >= 1) {
          widthM = TARGET_IMAGE_SIZE_M
          heightM = TARGET_IMAGE_SIZE_M / aspect
        } else {
          heightM = TARGET_IMAGE_SIZE_M
          widthM = TARGET_IMAGE_SIZE_M * aspect
        }

        // Center in the current viewport
        const stage = engine.stage
        const scale = stage.scaleX()
        const pos = stage.position()
        const centerWorldX = (stage.width() / 2 - pos.x) / scale
        const centerWorldY = (stage.height() / 2 - pos.y) / scale

        const konvaImage = new Konva.Image({
          id: crypto.randomUUID(),
          image: img,
          x: centerWorldX - widthM / 2,
          y: centerWorldY - heightM / 2,
          width: widthM,
          height: heightM,
          draggable: true,
          opacity: 0.7,
          name: 'shape background-image',
        })

        // Add to zones layer (not base — base has listening:false for the grid).
        // Not through command system — HTMLImageElement can't be serialized.
        const layer = engine.layers.get('zones')
        if (layer) {
          layer.add(konvaImage)
          layer.batchDraw()
        }
        // When persistence is implemented, this should be canvas-side dirty
        // (background images are Konva nodes, not non-canvas state).
        canvasClean.value = false

        resolve()
      }

      img.onerror = () => reject(new Error('Failed to decode image'))
      img.src = reader.result as string
    }

    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
