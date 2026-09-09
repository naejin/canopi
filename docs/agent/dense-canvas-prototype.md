# Dense Canvas reading experiment

This is an unaccepted visual proposal, delivered in `canopi-2w64`; user selection
and retirement are tracked in `canopi-bzpg`. Production Canvas
behaviour and the PDF projection rules remain unchanged. Do not promote the
throwaway drawing code into a renderer.

From `desktop/web`, run:

```bash
npm run dev -- --mode web --port 4188 --host 127.0.0.1
```

Open `http://127.0.0.1:4188/app/?prototype=density&variant=adaptive` and use Open
Design to import a local `.canopi` file. The existing Web Canvas hosts four views:

| Key | Reading model |
| --- | --- |
| `current` | Actual production renderer at the same camera position. |
| `adaptive` | Spacing-aware position marks, full symbols where they fit, collision-aware names and notes, hover identification, species spotlight. |
| `lens` | Adaptive overview plus a magnified inspection pane and nearby-plant list. Click the canvas to hold/release; hover list entries to match positions. |
| `strip` | Temporary vertical 1 m reading strip with plants ordered top to bottom. This is a view aid, not an authored Zone or inferred planting row. |

The bottom switcher and left/right arrows change the URL. Arrows retain normal
behaviour in editable controls. The quick zoom buttons cover 50–2000%; drag pans.
Prototype pointer interactions do not edit objects. Normal surrounding app
commands remain normal app commands. Exit by removing `prototype=density`.

The private orchard reference has 2,201 Plants across 117 Species, median nearest
spacing about 0.27 m, and no coincident plant centres. At the existing calibration,
50% is 10 CSS px/m: median separation is only 2.7 px. The production symbols are
about 7 px across there, and the 5 px stack threshold groups neighbouring plants.
The earlier synthetic 1.5 m dense-bed spacing does not represent this density.

Inspection at 50/100/200/500/1000/2000% favours automatic hierarchy with an optional
lens. Individual positions remain present at low zoom; naming every plant there
is physically impossible. At higher zoom the prototype restores names where they
fit without overlapping plant marks or other labels. It preserves stored positions,
species colours and available full-symbol recipes. Reduced marks represent
positions, not canopy dimensions. Hidden notes retain an anchor and hover reveal;
measurement lines remain, with labels admitted when room permits or on hover.

Implementation lives in `components/canvas/prototype-density/`. The Web host
requires `import.meta.env.DEV` and an explicit toggle before loading it. Production
Web and desktop bundles must contain none of its code or styles. Its local Canvas2D
projection reuses an owned read-only print snapshot only for this experiment;
camera gestures use the existing runtime wheel path. No Design fields are added.

This has been visually inspected in local Chromium at DPR 1, not validated across
OSes, touch input or fractional/high DPR. The strip is deliberately vertical and
does not follow diagonal beds. The quadratic spacing scan and simple collision
pass are prototype algorithms, not production performance decisions. True
co-location, selection/editing affordances, accessible inspection, stable label
transitions and both renderer backends need normal implementation design/tests
after the user chooses a direction. Preserve the shared Visual Footprint boundary.

Keep the private source, imported copies and screenshots outside Git. Local review
artifacts may live under ignored `.tmp/dense-canvas-review/`. Once the user chooses,
record the decision in bd, rebuild through the production seams, then delete the
prototype directory, host gate and this temporary guide/link.
