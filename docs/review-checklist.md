# Release review checklist

Run before tagging a release and again on each platform build from the Release Candidate workflow ([release workflow](guides/native-and-release.md#release-workflow)). Drive the real hosts: `cargo tauri dev` (or the packaged app) and `npm run dev:web` (or the packaged Web artifact). The UI gallery proves layout only. Use an isolated profile ([editions](guides/editions.md#development-hosts)) and never a real user Design.

Check every section in light and dark, English and French, and a 720 px tall window.

## Start and files

1. Start Canopi with a fresh profile: the Start screen offers New Design and says where Designs will appear; no notice or error shows.
2. New Design: "Where is your site?" opens over a country-level view; search a town and press Enter; the map flies there and the Design opens as a Draft (save status "Draft").
3. Place a plant, wait two seconds: the save status changes without a prompt. Close the window and reopen: the Draft is on the Start screen with its sketch and counts.
4. Save as… to a `.canopi` file, close (Ctrl W), reopen from Recent Designs: objects are where they were. Duplicate the name in another folder: both rows show a file name or folder.
5. Edit the file outside Canopi while it is open, then change something: the "Changed outside Canopi" choice appears; nothing is written silently.
6. Open a 1.x Design or an earlier 2.0 preview file: it is refused with "Made with an older version of Canopi" and the file is unchanged.
7. Recent Designs › More: Show in folder opens the folder; Remove from list forgets the row and keeps the file.
8. File › Revert to the version when opened…: confirms, then restores the opened version as one Undo step.

## Map canvas and tools

1. Pan, zoom and search a place (Ctrl K): the view moves; no object moves. Fit to Design frames the objects inside the visible map area, not under the open panel.
2. Layers › Background: switch Satellite, Map (each style) and None; map labels and plant labels stay readable in both themes.
3. Contours and Hillshading switch on and off and say "from online elevation".
4. Each tool (Place plants, Plant a row, Place a stamp, Polygon, Rectangle, Ellipse, Line zone, Text note, Measure) shows a tool card with its keys; Esc ends the tool, then clears the selection.
5. Place plants without a species: the chooser lists species in the Design, Favorites, Recent and a search; the pointer preview shows the mature-width ring and "x m to <name>".
6. Plant a row with an Interval: the count updates; Shift keeps the line on 45°. Undo removes the whole row at once.
7. Right-click a plant: the menu shows the commands in plain words with shortcuts and fits the window; disabled commands stay visible. Menu key and Shift F10 open it with the map focused.
8. Rotate… by 30° and with the handle; arrow keys nudge by 10 cm, Shift arrows by 1 m; locked objects do not move or turn.
9. Select two zones and plants: the selection chip names them; Rename zone… names a zone and the Calendar target shows the new name; an unnamed zone reads "Rectangle zone · 120 m²".
10. Save a selection as a stamp (Favorites and stamps › Save selection), place it with [ and ] turned; copies are unlocked and selected; the source is unchanged. Export the stamp and import it again.
11. Lock an object, then Edit › Unlock all: one Undo step unlocks everything.
12. Plants in this Design › Display on the map: Species, Stratum (legend swatch recolours a stratum, Reset stratum colors) and One color; Symbol size 50–200 %; Labels None, Codes, Names; the chip reads "Codes shown for X of Y plants in view".
13. Symbol picker: four families, every symbol takes the chosen colour and reads at 50 %.
14. Tab to the map: a blue focus ring shows; F6 and Shift F6 cycle title bar, tools, map and panel; a screen reader announces "Design map".

## Plant catalog and finder

1. Open the Plant catalog (Ctrl 3): the first rows are edible and multi-use species; sort by Name, Height and Edibility; quick filters and Filters tokens add and remove one by one.
2. Search "pomme" in French and "apple" in English: results match; a species with no French name shows "(en)".
3. Species details: key facts first, "Not recorded" for missing data, photos with source and licence, Place, and for a placed species its code, count, Select them and Zoom to them.
4. Ctrl F in Plants in this Design, Budget, Consortium and Favorites: the same finder, accent-insensitive and typo-tolerant; matches are ringed on the map with Zoom to them and Select all.
5. Selected on map, Stratum and Form narrow each list and show counts.
6. Start with the plant database missing (rename it in an isolated profile): the notice says search and details are off and Designs are safe; the app stays usable.

## Data library and analyses (Desktop)

1. Layers › Add data › Terrain or height from files…: the dialog names the accepted files, says "Covers your site." with the span for a matching tile and warns for a distant one; a taken name is refused with a suggestion.
2. Import runs with progress and Cancel under Site data while you keep editing; the item appears when ready with legend, opacity, Fit to data and Read values.
3. Analyze… › Slope on a ground-elevation item: the result nests under its source with its unit; Details show Calculated from, processing history and Run again with changes….
4. Refresh a result: it reruns in place with the same item, the earlier run stays in the processing history and every Design showing it sees the new result. An Out of date badge names its reason (source, recipe or tool changed).
5. Data library dialog: the footer states the size on this computer and Show in folder opens the folder; Remove from Design keeps the item in the library; Delete everywhere warns and removes it.
6. Without the GeoLibre tool on the machine: import still works (the raster engine is built in), new runs say the tool is unavailable by name, and saved results still display.
7. Alt ↑ and Alt ↓ reorder Site data rows and the change survives reopening the Design.

## Planning panels

1. Calendar: Add action, Range, One day and Unscheduled; Completed switch; a Design without actions says "No actions yet". The week starts on Monday in French and Sunday in English.
2. Right-click plants › Add to calendar…: the action targets those plants; a zone target shows the zone's name or shape and size.
3. Budget: Set unit cost… from the right-click menu opens the species' price; change the currency (prices are relabelled, not converted); File › Export › Budget as CSV… writes a file that opens in a spreadsheet.
4. Consortium: assign strata (Emergent, High, Mid, Low) and phases; the map's stratum colours and the Stratum filter follow; the matrix counts species per cell.
5. Point at a Budget, Calendar or Consortium row: the plants are ringed on the map in ochre; switch theme while highlighted and the ring recolours.

## Saved views and stories

1. View › Save current view… with a name and title; change zoom and background; View › Saved views › the view flies back and restores background, layers, labels and focused species; no object moves.
2. Manage views…: rename, delete (Undo restores it); deleting a view a story uses lists the stories first.
3. Stories (Ctrl 9): add three steps from views, edit title and text with bold, italic, bullets and a link, add a picture with a description; a picture over 1 MB is reduced; drag and Alt ↑ / ↓ reorder; Duplicate, Move to and Delete with Undo.
4. Present: card beside the live map, step dots, Previous, Next, Finish, arrow keys, Space, Esc; leaving restores the map and focus; the Design is unchanged (no save status change).
5. Present › Full screen on Linux and Windows; on macOS the button is absent (no fallback yet) and presenting still fills the window.
6. Saved-view pictures on Windows WebView2 and Linux WebKitGTK: every saved view and story step shows a picture, not an empty frame, after saving and after reopening the Design.

## PDF export

1. File › Export › Planting plan (PDF)… (Ctrl P): paper, Include, plant colours As in the Design, Grayscale and Black, north arrow and scale; the preview updates with each change.
2. Add field sheet over a dense corner; Split into readable sheets on a large page; move a page by dragging and with the arrow keys; page thumbnails follow.
3. The key is grouped Tree, Shrub, Herbaceous, Climber, Other with "(continued)"; species without a name in the language carry "(en)" explained in the header; page 1 lists the symbols used.
4. Find in key (Ctrl F) opens the page with the entry ringed.
5. Save PDF on each desktop WebView (WebKitGTK, WKWebView, WebView2): the file opens in a PDF reader with fonts embedded and CJK names intact in the Japanese locale. The CI PDF probe covers the worker and CSP, not the save dialog.
6. Web: the same export downloads a file; its key is one ungrouped list (known limit).

## Settings and shell

1. Settings › Appearance: theme and language switch live, including menus, dates and number formats (175,473 / 175 473).
2. Map and imagery: add a Google key (masked, Show reveals it), switch to free imagery and back, Remove key; the key never appears in a Problem report bundle.
3. New Designs: set satellite, symbol size and labels; a new Design starts with them and an existing Design keeps its own.
4. Keyboard: turn single-key shortcuts off; tool keys and N stop, Ctrl shortcuts, Delete, Esc, arrows and F keys work, and menus and F1 hide the keys that are off.
5. Files and data: Show in folder opens the Drafts and Data library folders.
6. Help › Report a problem…: the report folder holds a summary and a bundle without Design contents, paths or the key; Getting started and About Canopi open. About shows the release version.
7. 720 px tall and 1024 px wide window: the panel rail folds into More panels, the tool rail into More tools with Undo and Redo visible, menus scroll, the credits pill folds to (i), and a panel highlight and the selection chip stay in the visible map area.
8. Dialogs are modal: with one open, menus, shortcuts and the map do not respond.

## Web Edition and phones

1. Open the packaged Web artifact at its configured base: the shell loads without missing assets or Tauri requests; New Design, Open a .canopi file…, Download a copy and "Saved in this browser" work.
2. Browser catalog: browse, a two-character search and a filter work; sort offers Recommended and Name.
3. Import a GeoJSON file, export GeoJSON and Budget CSV, export the PDF; reload the page: the Draft is back.
4. Site data says "Terrain and height data need Canopi Desktop."; a Design with terrain data from Desktop keeps it after a Web round trip.
5. Phone (a real device, portrait and landscape, not only a resized window): the top bar with Menu, name, Undo and search; the four-tool strip; the bottom sheet with Layers, Plants, Catalog, More opening to half and full height by drag, tap and arrow keys; targets at least 44 px; typing in a field does not zoom the page; the notch and home indicator are clear.
6. Present a story on the phone: swipe moves steps; Esc or Finish returns to the panel.
7. Open the 1.x Web storage profile: it is ignored and the app starts empty without an error.

## Platform builds

1. Linux deb and AppImage, macOS arm64 and x64 dmg, Windows exe and msi from the candidate run: clean start, the bundled plant catalog loads, About shows the version, no console errors on start.
2. On each: create, edit, save, reopen and switch Designs; species search, detail, favourite and placement; undo and redo; place search and fit; theme and locale switch; export a PDF.
3. Record run id, commit, DB SHA-256, tester, date and results in the release bead before promoting.
