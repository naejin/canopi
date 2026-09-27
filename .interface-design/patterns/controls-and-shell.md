# Controls and shell

Read the [design system](../system.md) first. Canvas boards: DesignSystem, Rules, Start, LocateSite, Menus, SaveStates, Settings, ProblemReport, Shortcuts, EmptyStates, LoadingStates, ErrorStates, PdfExport, PdfKeyPage, WebWorkspace, WebPhone, WebPhoneSearch, French, FrenchDialogs.

## Title bar and menus

- Floating title bar (see the design system). The place field searches only on Enter (the public geocoder forbids search-as-you-type); while a place name waits, its popup says "Press Enter to search" (the field's description). Coordinates go straight there. The Design name is a button that renames (F2). Save status is a live region: Saved, Saving… (not announced), Draft with Save as…, Couldn't save (alert) with Details… (the reason and Retry / Save as…), Changed outside Canopi (alert) with Resolve…. Web shows "Saved in this browser" and a Download a copy link; the file actions are icons (Open a .canopi file).
- Menus (native on macOS): File (New, Open…, Open recent ▸, Rename…, Save as…, Revert…, Add data…, Data library…, Import GeoJSON…, Export ▸ Planting plan (PDF)…, GeoJSON…, Budget as CSV…, Settings…, Close, Quit), Edit (history, clipboard, selection, species commands, grouping, Rotate…, lock, stamps), View (zoom, fit, place search, Saved views ▸, Save current view…, Manage views…, Grid/Snap/Rulers as checkable items, Labels ▸ None/Codes/Names as radio items with N on the submenu, Tool names, panels Ctrl 1–8, Background, Theme), Tools (every tool with its key), Help (Keyboard shortcuts F1, Getting started, Report a problem…, About). Checkable items are `menuitemcheckbox`; a check column is reserved when a menu has any.

Shipped so far (canopi-h90p app frame): File keeps Save (Ctrl S) beside Save as…; Add data… (the Layers import, into the open Design) and Data library… are Desktop only, like the data workflow; Close Design shows no Ctrl W on Web, where the browser keeps it; Symbol and color… (as Plant color ▸ and Plant symbol ▸), Species details, Add to calendar… and Set unit cost… live in the right-click menu rather than Edit; Edit adds Find plants (Ctrl F) and keeps Unlock beside Lock (Ctrl Shift L) and Unlock all; Getting started opens a short guide dialog: six first steps named with the interface's own tool and panel names, then Keyboard shortcuts and Done. Below 760 px the menubar becomes one Menu button with submenus inline, and Help, Settings and the Web file icons move into it.

## Start and new Designs

- Start: left column with logo, one line of purpose, New Design (Ctrl N, primary) and Open Design… (Ctrl O), a drop hint, Settings, Keyboard shortcuts, Report a problem…. Right: Search your Designs, Recent Designs (thumbnail, name, place name, counts, relative date; the row opens; More), Drafts (dashed tile; deleting confirms inline and names the draft).
- First run (nothing recent, no Drafts): the right column has no search; its section title (Recent Designs, or Drafts on Web) sits over an `EmptyState` that says where Designs will appear and offers New Design. Nothing shows until the lists have loaded, so the empty state never flashes.
- Shipped so far: Recent Designs rows show name, relative date and a More menu (`ActionMenu`: Show in folder, which opens the file's folder; Remove from list, which forgets the entry and keeps the file). Search your Designs filters by name. Recent files do not know their thumbnail, place name or counts yet (canopi-h90p.23: the summary needs a user DB table, and a user DB schema change sets the old database aside under ADR 0003), and a row never shows "0 plants" for an unknown count.
- New Design opens "Where is your site?" over the world map: a combobox with results (coordinates offered only when the input reads as coordinates), attribution, and Skip. Then "Start your Design" beside the labelled tool rail: draw a zone, open the catalog, rename and Save as….

## Dialogs, notices and states

- Dialogs: Literata 20 title, body 14.5, footer actions right-aligned and wrapping, a leading ghost action aligned with the text. Modal, focus-trapped, Esc closes and returns focus. Modal means everything else is inert under the scrim: the title bar (menus, place field and the window controls, as an app-modal dialog disables its window on Windows and macOS; the system still moves and closes it), rails, dock, chips and notices take no press, focus or key, and no shortcut runs.
- Saved views (`SavedViewDialogs.tsx`): Save current view… has Name (selected, default "View n") and an optional Title, then Cancel and Save view. Manage views… lists each view with Go to, Rename (in place: Enter keeps, Esc cancels only the rename) and Delete; a view that stories show asks first in an inline danger box listing the stories, with focus on Cancel. The Undo toast sits in the dialog while it is open and floats bottom-centre after it closes.
- Notices: info (surface-2), warning (amber), error (red, alert). Toasts are dark, carry Undo when it applies, and do not time out while hovered or focused.
- Notices never cover controls. An app-wide notice (the plant catalog's database file is missing or damaged, `DegradedBanner`, which says plant search and details are off, that Designs are safe and to reinstall Canopi; the catalog's results list says the same instead of the internal error; the Web shell notice, such as a GeoJSON import error) takes its own row under the title bar, as wide as the title bar, and lowers `--chrome-rail-top` on its container while it shows (`useChromeRow` in `useMapChrome.ts`), so rails, the dock, tool cards, chips and both Start columns move down below it. Over the map a notice is opaque: a translucent tone tint sits on the surface.
- Empty states say what goes here and give the one action to start. Loading keeps the frame: inline "Searching…", row skeletons, a progress bar for long opens. Errors say what happened, what is safe and the next step ("Restart Canopi" on Desktop, "Reload" on Web).

## Settings

A dialog with sections: Appearance (theme, language), Map and imagery (satellite source: free imagery or my Google key; key field with Show and Remove key; the key stays on this device; map style), New Designs (open on satellite, symbol size, labels), Keyboard (single-key shortcuts on or off, remapping), Files and data, About.

## Export planting plan

A side sheet beside the live preview (canopi-h90p.31), top to bottom: Back to Design and the title; paper; plant colours as a segmented radio group (As in the Design, Grayscale, Black); Include as checkboxes (the printable layers: plants, zones, notes, measurement guides) plus a "North arrow and scale" switch; the selected page's options (Fit, zoom, orientation, Split into readable sheets, Inspect), replaced by the split review (page count, Apply sheets, Cancel) while a split is proposed; Add field sheet and Whole design; page thumbnails as buttons, each detail with a remove button and its key pages nested; Save PDF with the page count. Displacement stays on the preview: drag the page or use the arrow keys on the focused page. Every control is reachable with Tab. No map backgrounds and no manual symbol size (ADR 0008; symbol size stays automatic and collision-tested). There is no scale picker or site-data option: ground scale follows the field sheets and their zoom. The key stays automatic (on the sheet when it fits, otherwise on following pages), is grouped by plant habit (Tree, Shrub, Herbaceous, Climber, then Other), marks names missing in the chosen language as "(en)", and never truncates: names wrap and continued columns repeat their heading. On Web the key is ungrouped until the Web catalog carries habit. Page 1 carries a legend of the symbols used, drawn in ink with their names in the header band.

Shipped (canopi-h90p.24): `SettingsDialog.tsx` is a wide dialog with a section list on the left (`nav`, the current section `aria-current="page"`; a scrolling row under 640 px) and one section on the right under a Literata heading.
- Appearance: theme, language, tool names.
- Map and imagery (`SettingsGoogleKeyField.tsx`): Satellite imagery as a segmented Free imagery / My Google key. My Google key shows the key field: masked, a saved key is never put in the page (the input stays empty behind a dot placeholder); Show (`aria-pressed`) puts it in the input only; typing offers Save key (Enter saves); Remove key forgets it. Choosing Free imagery forgets a saved key. The note says the key stays on this device and never enters Designs, exports or problem reports. Then Map style (Dropdown) and Soften background (switch).
- New Designs: Open on satellite (switch; off keeps the last background), symbol size (slider, 50–200 %), labels (None, Codes, Names). Applied once when a Design is created; the intro says existing Designs keep their own.
- Keyboard: Single-key shortcuts (switch) and Show all shortcuts (closes Settings, opens F1). Remapping is not offered yet and the section says so.
- Files and data: Desktop lists Drafts and Data library with their paths (mono, wrapping; on screen only) and Show in folder; Web says Designs and Drafts stay in the browser.
- About: the version and About Canopi… (closes Settings, opens About).

## Controls

- Dropdown (`components/shared/Dropdown.tsx`), never a native `<select>`; the accessible name includes the current value. DatePicker, never `<input type="date">`.
- Segmented controls are radio groups; the selected segment has an ink border. Switches are checkboxes with `role="switch"`. Radios are custom with a visible ring.
- Sliders show their value and have accessible names. The resize handle between map and dock widens on hover and supports the keyboard.

## Web on phones

Map first with a floating top bar (menu, Design name and save status, Undo, place search, 44 px targets), a tool strip on the left, zoom buttons and scale on the right, and a bottom sheet with peek, half and full heights (handle is a 44 px button), panel tabs with More, and 16 px inputs. Landscape uses a side sheet. Safe-area insets apply.
