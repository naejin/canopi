# Print and Inspection Lens reading proposal

This is an **unaccepted, development-only prototype**, tracked by `canopi-j0hd`.
The pending product decision is `canopi-n29c`.
It explores spacing-aware PDF marks and plant names directly inside the Inspection
Lens frame. The production PDF policy and list-based lens remain unchanged.

From `desktop/web`, run:

```bash
npm run dev -- --mode web --port 4188 --host 127.0.0.1
```

Open `http://127.0.0.1:4188/app/?prototype=readability&variant=inline` and use Open
Design to import a planted `.canopi` file. The three lens variants are `inline`,
`connected`, and `expanded`. Bottom arrows or keyboard Left/Right change the URL;
editable fields retain normal keys. Click the overview to hold a location, or
choose Follow pointer. Lens magnification is independent of the main Canvas.
Hover/focus a name to highlight its exact plant; activate it to centre only the
prototype lens. The ochre rectangle shows the inspected ground coverage.

## Questions and recommendation

- `inline`: names close to their plants with short connectors. Recommended as
  the starting point: less eye movement and less line crossing.
- `connected`: names at the frame edges with connector lines. Explicit links, but
  long lines can cross in dense patches.
- `expanded`: a larger frame holds a broader labelled neighbourhood, at the cost
  of covering more of the overview. This may work as an optional expansion.

The PDF comparison uses actual production layout, embedded font shaping, SVG
preview, and PDF encoding. It includes an overview and a 2.8×3.4m Print Area around
the inspected location, with complete legends/continuations. Save sample PDF
downloads either version. The proposed copy changes plant mark operations only:
radius capped to 42% of projected nearest distinct spacing, a provisional 0.35mm
radius floor, solid round marks below 0.8mm radius, and a provisional 0.12mm stroke
floor for other symbols. Authored non-round recipes and colours remain; no species
appearance is substituted. These are comparison values, not approved paper defaults.

The orchard comparison exposes a second problem: compact marks reveal the planting
pattern, but retaining every full Annotation and distance on the overview still
creates severe text crowding. **The prototype deliberately retains that text**;
it does not claim the entire print-readability problem is solved. The recommended
next policy to discuss is a navigation overview with full text on detail sheets,
and an explicit choice when a note would otherwise have no readable printed home.
Do not implement silent omission, automatic detail pages, or a new note-reference
scheme without settling that choice with the user. ADR 0024 remains authoritative
until an accepted revision records the new print-content policy.

## Isolation and verification

The code is colocated in `components/canvas/prototype-reading/`. The existing Web
Canvas checks both `import.meta.env.DEV` and `prototype=readability` before loading
it. Both production bundles exclude the prototype. It only reads Canvas query
snapshots; pointer, label, zoom, and variant actions affect local prototype state.
Normal surrounding app commands remain normal commands. No prototype rendering
code should be promoted to production; rebuild the selected direction with craft
and TDD and delete this experiment after the decision is captured.

TypeScript, the eight Web Canvas host tests, and both edition builds passed.
Actual browser inspection used the private 2,201-plant orchard, all three lens
variants, name focus/highlight, PDF overview/detail previews, and a two-page PDF
download with the existing encoder. A dense patch displayed ten positions with
ten directly associated names. The Scene snapshot remained byte-for-byte equal.
Screenshots, PDFs and the source Design stay local under ignored `.tmp/` paths.
No prototype tests were added; physical paper, native platform behavior, long-name
wrapping and production performance are not established by this experiment.
