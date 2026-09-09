import { PDFDocument } from 'pdfkit';

export async function generate(fixture, fontBytes) {
  const doc = new PDFDocument({ autoFirstPage: false, font: null, compress: true, info: { Title: 'Canopi provisional PDF evaluation', CreationDate: new Date('2026-09-09T00:00:00Z'), ModDate: new Date('2026-09-09T00:00:00Z') } });
  for (const [id, bytes] of Object.entries(fontBytes)) doc.registerFont(id, bytes);
  const chunks = [];
  const output = new Promise(resolve => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(new Blob(chunks, { type: 'application/pdf' }))); });
  const measurements = [];
  for (const page of fixture.pages) {
    doc.addPage({ size: [page.width, page.height], margin: 0 });
    for (const op of page.ops) {
      if (op.kind === 'text') {
        doc.font(op.font).fontSize(op.size).fillColor(op.color);
        measurements.push({ text: op.text, font: op.font, previewWidth: op.previewWidth, pdfWidth: doc.widthOfString(op.text, { features: [] }) });
        doc.text(op.text, op.x, op.y, { baseline: 'alphabetic', lineBreak: false, features: [] });
      } else if (op.kind === 'rect') doc.lineWidth(op.stroke).rect(op.x, op.y, op.width, op.height).stroke(op.color);
      else if (op.kind === 'line') doc.lineWidth(op.width).moveTo(op.x1, op.y1).lineTo(op.x2, op.y2).stroke(op.color);
      else if (op.kind === 'clip') doc.save().rect(op.x, op.y, op.w, op.h).clip();
      else if (op.kind === 'unclip') doc.restore();
      else if (op.kind === 'marker') {
        const { x, y, radius: r } = op;
        if (op.shape === 0) doc.circle(x, y, r);
        else if (op.shape === 1) doc.rect(x - r, y - r, r * 2, r * 2);
        else doc.moveTo(x, y - r).lineTo(x + r, y + r).lineTo(x - r, y + r).closePath();
        doc.fill(op.color);
      }
    }
  }
  doc.end();
  return { blob: await output, measurements };
}
