export const mm = value => value * 72 / 25.4;
export const paper = { width: mm(210), height: mm(297) };
export const names = [
  { text: 'Cerisier de Sainte-Lucie', font: 'latin' },
  { text: 'Elaeagnus × ebbingei', font: 'latin' },
  { text: 'Яблоня домашняя', font: 'latin' },
  { text: '苹果树', font: 'sc' },
  { text: 'ローズマリー', font: 'jp' },
  { text: '검은딸기나무', font: 'kr' },
  { text: 'Rosmarinus officinalis var. angustifolius', font: 'latin' },
  { text: 'Érable 日本語 한국어 25 m²', font: 'jp' },
];
const colors = ['#476C38', '#756B8B', '#9B582F', '#335B5B', '#526846', '#955C78', '#76642F', '#45526F'];

// Synthetic 6 × 6 garden at 4 m spacing, following the existing zoom corpus.
// Coordinates, symbols and page dimensions are evaluation inputs, not production rules.
export function createFixture(measure) {
  const plants = Array.from({ length: 36 }, (_, i) => ({ x: 5 + i % 6 * 4, y: 7 + Math.floor(i / 6) * 4, species: i % names.length }));
  const pages = [];
  const text = (ops, value, x, y, size = 10, font = 'latin') => ops.push({ kind: 'text', text: value, x, y, size, font, color: '#211D18', previewWidth: measure(value, font, size) });
  const line = (ops, x1, y1, x2, y2, color = '#211D18', width = mm(0.25)) => ops.push({ kind: 'line', x1, y1, x2, y2, color, width });
  const rect = (ops, x, y, width, height, color = '#777777') => ops.push({ kind: 'rect', x, y, width, height, color, stroke: mm(0.25) });
  const marker = (ops, x, y, species) => ops.push({ kind: 'marker', x, y, radius: mm(1.3), shape: species % 3, color: colors[species] });
  const areas = [{ x: 0, y: 0, w: 14.5, h: 23.7 }, { x: 13.5, y: 0, w: 14.5, h: 23.7 }];
  for (let index = 0; index < 3; index++) {
    const ops = [];
    const overview = index === 0;
    const frame = { x: mm(10), y: mm(28), w: mm(overview ? 190 : 145), h: mm(237) };
    const scale = overview ? mm(190) / 32 : mm(10); // detail 1:100, in pt per Design metre
    const area = overview ? { x: 0, y: 0, w: 32, h: 38 } : areas[index - 1];
    const point = (x, y) => [frame.x + (x - area.x) * scale, frame.y + (y - area.y) * scale];
    text(ops, `Canopi PDF evaluation · ${overview ? 'Overview' : 'Detail'} · ${index + 1}/3`, mm(10), mm(13), 14);
    text(ops, 'Provisional geometry · A4 · print at actual size', mm(10), mm(20), 9);
    rect(ops, frame.x, frame.y, frame.w, frame.h);
    ops.push({ kind: 'clip', ...frame });
    const [zx, zy] = point(2, 3);
    rect(ops, zx, zy, 30 * scale, 31 * scale);
    const visible = plants.filter(p => p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h);
    for (const plant of visible) marker(ops, ...point(plant.x, plant.y), plant.species);
    if (overview) {
      areas.forEach((a, i) => {
        const [x, y] = point(a.x, a.y);
        rect(ops, x, y, a.w * scale, a.h * scale, '#333333');
        text(ops, `Page ${i + 2}`, x + mm(2), y + mm(5));
      });
      text(ops, 'AVATAR Toffee office é Ø Ł ß Æ × m²', ...point(2, 36), 10);
    } else {
      text(ops, 'Keep access clear', ...point(area.x + 1, 2), 10);
      text(ops, 'Pommier · Яблоня', ...point(area.x + 1, 4), 10);
      text(ops, '庭園 · 정원 · Jardin', ...point(area.x + 1, 6), 10, 'jp');
    }
    ops.push({ kind: 'unclip' });
    if (!overview) {
      const legendSpecies = [...new Set(visible.map(p => p.species))].sort((a, b) => a - b);
      let y = mm(34);
      text(ops, 'Plants on this page', mm(160), y, 10);
      y += mm(9);
      for (const species of legendSpecies) {
        const name = names[species];
        marker(ops, mm(162), y - mm(1), species);
        // Wrap at spaces where available; grapheme boundaries keep CJK and combining marks intact.
        // This bounded fixture does not implement production Unicode line-breaking policy.
        const parts = name.text.includes(' ') ? name.text.split(/(?<= )/u) : [...new Intl.Segmenter().segment(name.text)].map(s => s.segment);
        const lines = [];
        let current = '';
        for (const part of parts) {
          if (measure(current + part, name.font, 10) > mm(34) && current) { lines.push(current.trimEnd()); current = ''; }
          current += part;
        }
        if (current) lines.push(current.trimEnd());
        for (const value of lines) {
          if (measure(value, name.font, 10) > mm(34)) throw new Error(`Fixture legend line overflow: ${value}`);
          text(ops, value, mm(166), y, 10, name.font);
          y += mm(4.8);
        }
        y += mm(4);
      }
    }
    const startX = mm(10), startY = mm(276), length = mm(50);
    line(ops, startX, startY, startX + length, startY);
    line(ops, startX, startY - mm(1), startX, startY + mm(1));
    line(ops, startX + length, startY - mm(1), startX + length, startY + mm(1));
    text(ops, `50 mm calibration · ${(length / scale).toFixed(2)} m on plan`, startX, mm(283), 9);
    text(ops, overview ? 'Numbered frames identify detail coverage' : `1:100 · ${index === 1 ? 'Next: page 3' : 'Previous: page 2'} · 1 m overlap`, mm(70), mm(283), 9);
    pages.push({ ...paper, ops });
  }
  return { provisional: true, plants: plants.length, pages, names };
}
