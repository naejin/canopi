# Appearance editors

Read the [design contract](../system.md). Gallery: ?surface=color or ?surface=symbol, including state=mixed and state=long.

Both editors use SurfaceHeader, AppearanceSelection, and appearance.module.css: title/close, one effective glyph and species/selection band, scrolling choices, fixed apply footer. Width is 328px, clamped to the viewport. Do not restore a separate large preview card.

Color has twelve swatches in six columns, a quiet selectable suggestion, and a Custom color disclosure with saturation/lightness, hue, and validated hex. No empty custom swatch. Suggestion and palette choices only change preview. Invalid hex disables both apply actions.

Symbol has twelve Botanical and four Abstract choices in one four-column keyboard listbox. Choices use neutral ink; selected state uses ochre. The selection band previews effective color. Mixed/inherited status remains available without repeating the chosen symbol as a second headline. Arrow keys preview; only the active choice is a tab stop.

Footer actions distinguish selected plant count from all placed instances/default of one species. Hide the species action for mixed-species selections. Do not add clear/default-reset actions below the footer.

Read runtime name revisions so open editors refresh on locale changes. Mutations stay in the plant-presentation command surface. useAppearancePopover owns synchronous positioning, focus on opening and resize/scroll cleanup. Escape restores the trigger. Custom drags own pointer identity and release on cancellation, blur, selection change, disclosure closure and unmount. Verify both drag and keyboard input.

Glyph artwork belongs in shared plant-symbol recipes, consumed by canvas, UI and PDF. Pass rendered glyph size so small marks omit fine detail.
