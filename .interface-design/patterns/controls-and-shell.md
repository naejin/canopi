# Controls and shell

Read the [design system](../system.md) first. Boards: DesignSystem, DesignSystemDark, Rules, Start, LocateSite, Menus, SaveStates, Settings, SettingsDark, ProblemReport, Shortcuts, EmptyStates, LoadingStates, ErrorStates, PdfExport, PdfKeyPage, WebWorkspace, WebPhone, WebPhoneSearch, French, FrenchDialogs.

## Title bar and menus

- The place field searches only on Enter; while a name waits, its popup says "Press Enter to search". The Design name is a button that renames (F2).
- Save status is a live region: Saved, Saving… (not announced), Draft with Save as…, Couldn't save (alert) with Details… (the reason and Retry / Save as…), Changed outside Canopi (alert) with Resolve…. Web shows "Saved in this browser" and Download a copy.
- Menus (native on macOS): File (new, open, recent, rename, save, revert, Add data… and Data library… on Desktop, Import GeoJSON…, Export ▸ PDF, GeoJSON, Budget CSV, Settings…, Close, Quit), Edit (history, clipboard, Find plants, selection, species commands, grouping and Arrange ▸, Rotate…, Lock, Unlock, Unlock all, stamps), View (zoom, fit, place search, saved views, Grid/Snap/Rulers, Labels ▸, Tool names, panels Ctrl 1–9, Background, Theme), Tools (every tool with its key), Help (Keyboard shortcuts F1, Getting started, Report a problem…, About).
- Checkable items are `menuitemcheckbox` (Labels are radio items); a check column is reserved when a menu has any. Plant color, Plant symbol, Species details, Add to calendar… and Set unit cost… live in the right-click menu, not Edit. Below 760 px the menubar becomes one Menu button with submenus inline, and Help, Settings and the Web file icons move into it.

## Start and new Designs

- Start: left column with logo, one line of purpose, New Design (Ctrl N, primary) and Open Design… (Ctrl O), Settings, Keyboard shortcuts, Report a problem…. Right: Search your Designs (by name), Recent Designs, Drafts (dashed tile; deleting confirms inline and names the draft).
- A recent row: a symbolic sketch thumbnail (72 × 52, from the file: zones as ink outlines, plants as ochre dots, north up, no map, no network), name, "2,201 plants · 24 zones", relative date and More (Show in folder, Remove from list, which keeps the file).
- First run (nothing recent, no Drafts): no search; the section title sits over an `EmptyState` that says where Designs will appear and offers New Design.
- New Design opens "Where is your site?" over the world map: a combobox with results (coordinates offered only when the input reads as coordinates), attribution, and Skip. Then "Start your Design" beside the labelled tool rail: draw a zone, open the catalog, rename and Save as….

## Dialogs, notices and states

- Dialogs: Literata 20 title, body 14.5, footer actions right-aligned and wrapping, a leading ghost action aligned with the text. Modal, focus-trapped, Esc closes and returns focus. Everything else is inert under the scrim: no press, focus, key or shortcut reaches the title bar, rails, dock, chips or notices.
- Saved views: Save current view… has Name (selected, default "View n") and an optional Title. Manage views… lists each view with its thumbnail (64 × 44), Go to, Rename in place (Enter keeps, Esc cancels only the rename) and Delete.
- Notices: info (surface-alt), warning (amber), error (red, alert). Toasts are dark, carry Undo when it applies, and do not time out while hovered or focused.
- Notices never cover controls. An app-wide notice (the catalog database missing or damaged; a Web shell notice) takes its own row under the title bar, as wide as it, and lowers `--chrome-rail-top` while it shows.
- Empty states say what goes here and give the one action to start. Loading keeps the frame: inline "Searching…", row skeletons, a progress bar for long opens. Errors say what happened, what is safe and the next step ("Restart Canopi" on Desktop, "Reload" on Web).

## Settings

A wide dialog with a section list on the left (`nav`, the current section `aria-current="page"`; a scrolling row under 640 px) and one section on the right under a Literata heading.

- Appearance: theme, language, tool names.
- Map and imagery: Satellite imagery as a segmented Free imagery / My Google key. The key field is masked and a saved key is never put in the page; Show reveals only what is typed; Save key, Remove key (which chooses Free imagery); a note says the key stays on this device. Then Map style and Soften background.
- New Designs: Open on satellite, symbol size (50–200 %), labels (None, Codes, Names); applied once when a Design is created.
- Keyboard: Single-key shortcuts and Show all shortcuts (closes Settings, opens F1). Remapping is not offered and the section says so.
- Files and data: Desktop lists Drafts and Data library with their paths and Show in folder; Web says Designs and Drafts stay in the browser.
- About: the version and About Canopi… (closes Settings, opens About).

## Export planting plan

A side sheet (280 px) beside the live preview, top to bottom: Back to Design and the title; paper; plant colours as a segmented radio group (As in the Design, Grayscale, Black); Include (plants, zones, notes, measurement guides) plus a "North arrow and scale" switch; the selected page's options (Fit, zoom, orientation, Split into readable sheets, Inspect); Find in key (Ctrl F); Add field sheet and Whole Design; page thumbnails with key pages nested; Save PDF with the page count.

Displacement stays on the preview (drag, or arrow keys on the focused page). No map backgrounds and no manual symbol size (ADR 0008). The key is automatic (on the sheet when it fits, otherwise on following pages), grouped by plant habit (Tree, Shrub, Herbaceous, Climber, Other), marks names missing in the chosen language "(en)", and never truncates.

## Controls

- Dropdown (`components/shared/Dropdown.tsx`), never a native `<select>`; its accessible name includes the current value. DatePicker, never `<input type="date">`.
- Segmented controls are radio groups; the selected segment has an ink border. Switches are checkboxes with `role="switch"`. Radios are custom with a visible ring.
- Sliders show their value and have accessible names.

## Web on phones

- Phone sizes: narrower than 640 px, or wider than tall, shorter than 480 px and narrower than 960 px. Wider windows keep the rails and dock; the 760 px narrow rules apply between 640 and 760 px. Safe-area insets apply; inputs are 16 px.
- Top bar: 8 px from the edges and below the notch, 52 px tall with 44 px buttons: Menu, the Design name over its save status (the status action waits in File), Undo, and Search a place (a card over the bar with Back and the field; Ctrl K opens it).
- Tool strip (left): Select, Pan, Place plants and Polygon zone as 44 px buttons, then More tools (a soft accent while it holds the active tool). Undo is in the top bar, Redo in Edit; Grid, Snap and Rulers in View.
- Zoom: a column on the right, midway down the visible map: zoom in, zoom out, the scale ratio menu; the inspection button beside its top. Fit to Design is in View.
- Sheet: across the bottom, resting at peek (handle and tabs), half, or full up to the top bar. The handle is a 44 px button: a press steps peek, half, full; ArrowUp/Down, PageUp/Down, Home and End move between heights. Three text tabs (Layers, Plants, Catalog), then More with the other panels; a second press on the open tab rests the sheet at peek, which closes the panel.
- Landscape: the sheet rests at peek in the bottom right corner and opens along the right edge below the top bar (half 360 px wide, full up to 560 px).
- The sheet covers the map's bottom (or right) edge in the visible map frame, so fitting, the selection chip, the legend and the credits keep above it.
