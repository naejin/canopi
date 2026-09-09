# Compact PDF legend proposal — temporary

`canopi-ed32` is a disposable visual study, not an accepted print-layout change.
The question is how to compact the plant legend while preserving field readability.
The current recommendation is A; the user has not yet selected a direction.
ADR 0024 and production legend dimensions remain unchanged.

## Run

From `desktop/web`:

```bash
npm run dev -- --mode web --port 4188 --host 127.0.0.1
```

Open `http://127.0.0.1:4188/app/?legendPrototype=1&variant=A`, load a Design,
then choose File → Export to PDF. The comparison uses the first displayed page
with a legend. If the overview is a navigation sheet, select a detail page.
The bottom bar and arrow keys cycle A/B/C and update the URL. Back to PDF workspace
exits the comparison. Closing and reopening PDF re-enables the URL-selected study.

Both the development build and explicit `legendPrototype=1` toggle are required.
`CanvasPdfDialog` dynamically loads
`components/canvas-pdf/legend-prototype/LegendPrototype.tsx` through a Preact hook
host; production bypasses and removes the entire prototype import. Keep imports
inside that development gate. The English annotations are review material, not
new localized product copy. The study does not change a Design, production setup
or normal PDF saving. Its separate download is labelled Prototype.

## Compared structures

All use the current 10 pt Noto text and 3 mm authored symbol samples. Complete names
wrap, using the names already resolved by the PDF workflow, including canonical
fallback. The comparison does not introduce a new naming rule.

- A: the existing 42 mm sidebar, with 2 pt entry gaps instead of 6 pt, a tighter
  symbol/name gutter, inline appearance samples when they fit, and light row rules.
- B: a 76 mm sidebar with two balanced alphabetical columns. It takes 34 mm from
  canvas width and narrower name columns can require additional wrapping.
- C: a 190 mm footer with four alphabetical columns. It trades canvas height for
  full canvas width; these dimensions illustrate an A4 portrait sheet.

For the reviewed 24-species orchard excerpt, legend heights are 170 mm current,
136 mm A, 91 mm B and 41 mm C. A reduces height by 20%; across the full 117-entry
legend, it reduces measured height from 848 mm to 665 mm (22%). These are shaped
layout measurements, not physical readability approval or promised savings for
every Design. The full list still requires pagination. The prototype expands to
show it completely and disables its comparison download when it exceeds one A4
sheet; production continuation-page rules remain unchanged.

The two-page comparison PDF contains the current and chosen legends at actual
physical size. Poppler verifies identical complete text for all 24 entries and
renders the chosen layout successfully. Both edition builds exclude prototype
code and copy; TypeScript and the existing PDF dialog/continuation checks pass.
No prototype-specific tests were added, following the prototype skill. Private
screenshots, PDFs and source Designs stay ignored under `.tmp/`.

After the user chooses, record the decision in bd, rebuild the accepted layout
with craft/TDD, align the production guide, and delete this directory, the host
gate and this guide. Do not promote the disposable layout algorithm directly.
