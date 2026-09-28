# Release review checklist

Run before tagging a release and again on each platform build from the Release Candidate workflow ([release workflow](guides/native-and-release.md#release-workflow)). Drive the real hosts, never the UI gallery, in an isolated profile ([editions](guides/editions.md#development-hosts)) and never on a real user Design.

Check every section in light and dark, English and French, and a 720 px tall window.

## Start and files

1. Fresh profile: the Start screen offers New Design and says where Designs will appear; no notice or error shows.
2. New Design: "Where is your site?" opens over a country-level view; search a town, Enter; the map flies there and the Design opens as a Draft.
3. Place a plant, wait two seconds: the save status changes without a prompt. Reopen the app: the Draft is on the Start screen with its sketch and counts.
4. Save as… to a `.canopi` file, close (Ctrl W), reopen from Recent Designs: objects are where they were; two files with one name show their folders.
5. Edit the open file outside Canopi, then change something: "Changed outside Canopi" offers a choice; nothing is written silently.
6. Open a Canopi 1.2 Design (format 6 or older): "Can’t open this Design · Made with an older version of Canopi; it can’t be opened" (a native dialog on Desktop, a notice on Web) and the file is unchanged. Open a 2.0 preview Design (format 7 or 8): it opens; after one edit the save status reads "Saved as Canopi 2 format" once.
7. Start on a Canopi 1.2 profile (user DB schema 8): Favorites, Recent Designs, the Design notebook and saved stamps are there; a profile from before 1.0 or from a newer Canopi is refused at start with a message and left unchanged.
8. Recent Designs › More: Show in folder opens the folder; Remove from list forgets the row and keeps the file.
9. File › Revert to the version when opened…: confirms, then restores the opened version as one Undo step.

## Map canvas and tools

1. Pan, zoom and search a place (Ctrl K): only the view moves. Fit to Design frames the objects inside the visible map area, not under the open panel.
2. Layers › Background: Satellite, Map (each style) and None; map and plant labels stay readable in both themes.
3. Online elevation › Contour lines and Hillshading switch on and off.
4. Every tool shows a tool card with its keys; Esc ends the tool, then clears the selection.
5. Place plants without a species: the chooser lists species in the Design, Favorites, Recent and a search; the preview shows the mature-width ring and "x m to <name>".
6. Plant a row with an Interval: the count updates; Shift keeps 45°; Undo removes the whole row.
7. Right-click a plant: the menu shows commands in plain words with shortcuts and fits the window; disabled ones stay visible; Menu key and Shift F10 open it.
8. Rotate… by 30° and with the handle; arrow keys nudge the selection by 10 cm, Shift arrows by 1 m, and pan the map when nothing is selected; locked objects do not move or turn.
9. Select zones and plants: the chip names them; Rename zone… renames and the Calendar target follows; an unnamed zone reads "Rectangle zone · 120 m²".
10. Save a selection as a stamp, place it turned with [ and ]; copies are unlocked and selected, the source unchanged. Export the stamp and import it again.
11. Lock an object, then Edit › Unlock all: one Undo step unlocks everything.
12. Plants in this Design › Display on the map: Species, Stratum (legend swatch recolours a stratum, Reset stratum colors) and One color; Symbol size 50–200 %; Labels None, Codes, Names; the chip reads "Codes shown for X of Y plants in view".
13. Symbol picker: four families; every symbol takes the chosen colour and reads at 50 %.
14. Tab to the map: a focus ring shows; F6 and Shift F6 cycle title bar, tools, map and panel; a screen reader announces "Design map".

## Plant catalog and finder

1. Plant catalog (Ctrl 3): the first rows are edible and multi-use species; sort by Name, Height and Edibility; quick filters and Filters tokens add and remove one by one.
2. Search "pomme" in French and "apple" in English: results match; a species with no French name shows "(en)".
3. Species details: key facts first, "Not recorded" for gaps, photos with source and licence, Place, and for a placed species its code, count, Select them and Zoom to them.
4. Ctrl F in Plants in this Design, Budget, Consortium and Favorites: one finder, accent-insensitive and typo-tolerant; matches are ringed on the map with Zoom to them and Select all.
5. Selected on map, Stratum and Form narrow each list with counts.
6. Start with the plant database missing: the notice says search and details are off and Designs are safe; the app stays usable.

## Data library and analyses (Desktop)

1. On a machine with no GDAL installed, Layers › Add data › Terrain or height from files…: the dialog names the accepted files, says "Covers your site." for a matching tile and warns for a distant one; a taken name is refused with a suggestion.
2. Import runs with progress and Cancel under Site data while you keep editing; the item appears with legend, opacity, Fit to data and Read values.
3. Analyze… › Slope on a ground-elevation item runs through the bundled GeoLibre tool (no install): the result nests under its source with its unit; Details show Calculated from, processing history and Run again with changes….
4. Refresh a result: same item, the earlier run stays in the processing history, every Design showing it sees the new result; Out of date names its reason.
5. Data library dialog: the footer states the size on disk and Show in folder opens it; Remove from Design keeps the item; Delete everywhere warns and removes it.
6. With `CANOPI_GEOLIBRE_BIN` pointing at a missing path (or `cargo tauri dev` without `scripts/build-geolibre-cli.sh`): import still works, Analyze… says "Unavailable: the GeoLibre engine is missing.", and saved results still display.
7. Replace `lidar-library.sqlite` with a damaged file: the Data library dialog says Canopi rebuilt it from the files it keeps and Retry prepares items again; a catalogue saved by a newer Canopi shows the banner "saved by a newer version of Canopi" and the library is read-only.
8. Alt ↑ and Alt ↓ reorder Site data rows and the change survives reopening the Design.

## Planning panels

1. Calendar: Add action, Range, One day and Unscheduled; Completed switch; "No actions yet" when empty; the week starts on Monday in French and Sunday in English.
2. Right-click plants › Add to calendar…: the action targets them; a zone target shows its name or shape and size.
3. Budget: Set unit cost… from the right-click menu; change the currency (relabelled, not converted); File › Export › Budget as CSV… opens in a spreadsheet.
4. Consortium: assign strata and phases; the map's stratum colours and the Stratum filter follow; the matrix counts species per cell.
5. Point at a Budget, Calendar or Consortium row: the plants are ringed in ochre; the ring recolours on a theme switch.

## Saved views and stories

1. View › Save current view…; change zoom and background; View › Saved views › the view flies back and restores background, layers, labels and focused species; no object moves.
2. Manage views…: rename, delete (Undo restores it); deleting a view a story uses lists the stories first.
3. Stories (Ctrl 9): add three steps, edit title and text (bold, italic, bullets, link), add a picture with a description (over 1 MB is reduced); drag and Alt ↑ / ↓ reorder; Duplicate, Move to and Delete with Undo.
4. Present: card beside the live map, step dots, Previous, Next, Finish, arrow keys, Space, Esc; leaving restores the map and focus; the save status does not change.
5. Present › Full screen on Linux and Windows; on macOS the button is absent (no fallback yet) and presenting still fills the window.
6. On WebView2 and WebKitGTK every saved view and story step shows a picture, not an empty frame, after saving and after reopening the Design.

## PDF export

1. File › Export › Planting plan (PDF)… (Ctrl P): paper, Include, plant colours As in the Design, Grayscale and Black, north arrow and scale; the preview follows each change.
2. Add field sheet over a dense corner; Split into readable sheets on a large page; move a page by drag and arrow keys; thumbnails follow.
3. The key is grouped Tree, Shrub, Herbaceous, Climber, Other with "(continued)"; species without a name in the language carry "(en)"; page 1 lists the symbols used.
4. Find in key (Ctrl F) opens the page with the entry ringed.
5. Save PDF on WebKitGTK, WKWebView and WebView2: the file opens with fonts embedded and CJK names intact in Japanese (the CI probe covers the worker and CSP, not the save dialog).
6. Web: the same export downloads a file; its key is one ungrouped list (known limit).

## Settings and shell

1. Settings › Appearance: theme and language switch live, including menus, dates and numbers (175,473 / 175 473).
2. Map and imagery: add a Google key (masked, Show reveals it), switch to free imagery and back, Remove key; the key is absent from a Problem report bundle.
3. New Designs: set satellite, symbol size and labels; a new Design starts with them and an existing Design keeps its own.
4. Keyboard: turn single-key shortcuts off; tool keys and N stop, Ctrl shortcuts, Delete, Esc, arrows and F keys work, and menus and F1 hide the keys that are off.
5. Canvas › Scroll wheel: Zooms the map, then Pans the map; the Select tool card ends in "wheel zooms" or "pinch zooms"; pinch and Ctrl + wheel zoom either way, Shift + wheel pans.
6. Files and data: Show in folder opens the Drafts and Data library folders.
7. Help › Command palette… (Ctrl Shift P) runs a command; Report a problem…: the report folder holds a summary and a bundle without Design contents, paths or the key; Getting started and About Canopi open with the release version.
8. 720 × 1024 px window: the panel rail folds into More panels, the tool rail into More tools with Undo and Redo visible, menus scroll, the credits pill folds to (i), and highlights and the selection chip stay in the visible map area.
9. Dialogs are modal: with one open, menus, shortcuts and the map do not respond.

## Web Edition and phones

1. `npm run package:web`, serve the archive at `/app/`: the shell loads without missing assets or Tauri requests; New Design, Open a .canopi file…, Download a copy and "Saved in this browser" work.
2. Browser catalog: browse, a two-character search and a filter work; sort offers Recommended and Name.
3. Import GeoJSON, export GeoJSON, Budget CSV and the PDF; reload: the Draft is back.
4. Site data says "Terrain and height data need Canopi Desktop."; a Design's Desktop terrain layers survive a Web round trip.
5. Phone (a real device, portrait and landscape): the top bar with Menu, name, Undo and search; the four-tool strip; the bottom sheet with Layers, Plants, Catalog, More opening to half and full height by drag, tap and arrow keys; targets at least 44 px; typing in a field does not zoom the page; the notch and home indicator are clear.
6. Present a story on the phone: swipe moves steps; Esc or Finish returns to the panel.
7. Open the 1.x Web storage profile: it is ignored and the app starts empty without an error.

## Platform builds

1. Linux deb and AppImage, macOS arm64 and x64 dmg, Windows exe and msi from the candidate run: clean start, the bundled plant catalog loads, About shows the version, no console errors on start; CI's `scripts/smoke-bundled-sidecar.sh` step passed for each.
2. On each: create, edit, save, reopen and switch Designs; species search, detail, favourite and placement; undo and redo; place search and fit; theme and locale switch; import a terrain tile and run Slope; export a PDF.
3. Record run id, commit, DB SHA-256, tester, date and results in the release bead before promoting.
