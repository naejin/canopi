import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const color = value => rgb(...[1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255));
export async function generate(fixture, fontBytes, subset = true) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle('Canopi provisional PDF evaluation');
  doc.setCreationDate(new Date('2026-09-09T00:00:00Z'));
  doc.setModificationDate(new Date('2026-09-09T00:00:00Z'));
  const fonts = {};
  for (const [id, bytes] of Object.entries(fontBytes)) fonts[id] = await doc.embedFont(bytes, { subset });
  const measurements = [];
  for (const plan of fixture.pages) {
    const page = doc.addPage([plan.width, plan.height]);
    for (const op of plan.ops) {
      if (op.kind === 'text') {
        measurements.push({ text: op.text, font: op.font, previewWidth: op.previewWidth, pdfWidth: fonts[op.font].widthOfTextAtSize(op.text, op.size) });
        page.drawText(op.text, { x: op.x, y: plan.height - op.y, size: op.size, font: fonts[op.font], color: color(op.color) });
      } else if (op.kind === 'rect') page.drawRectangle({ x: op.x, y: plan.height - op.y - op.height, width: op.width, height: op.height, borderWidth: op.stroke, borderColor: color(op.color) });
      else if (op.kind === 'line') page.drawLine({ start: { x: op.x1, y: plan.height - op.y1 }, end: { x: op.x2, y: plan.height - op.y2 }, thickness: op.width, color: color(op.color) });
      else if (op.kind === 'clip') page.pushOperators(pushGraphicsState(), rectangle(op.x, plan.height - op.y - op.h, op.w, op.h), clip(), endPath());
      else if (op.kind === 'unclip') page.pushOperators(popGraphicsState());
      else if (op.kind === 'marker') {
        const { x, y, radius: r } = op;
        if (op.shape === 0) page.drawCircle({ x, y: plan.height - y, size: r, color: color(op.color) });
        else if (op.shape === 1) page.drawRectangle({ x: x - r, y: plan.height - y - r, width: r * 2, height: r * 2, color: color(op.color) });
        else page.drawSvgPath(`M 0 ${-r} L ${r} ${r} L ${-r} ${r} Z`, { x, y: plan.height - y, color: color(op.color) });
      }
    }
  }
  return { blob: new Blob([await doc.save()], { type: 'application/pdf' }), measurements };
}
