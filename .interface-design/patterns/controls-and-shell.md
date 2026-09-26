# Controls and shell

Read the [design system](../system.md) first. Canvas boards: DesignSystem, Rules, Start, LocateSite, Menus, SaveStates, Settings, ProblemReport, Shortcuts, EmptyStates, LoadingStates, ErrorStates, PdfExport, PdfKeyPage, WebWorkspace, WebPhone, WebPhoneSearch, French, FrenchDialogs.

## Title bar and menus

- Floating title bar (see the design system). The Design name is a button that renames (F2). Save status is a live region: Saved, Saving… (not announced), Draft with Save as…, Couldn't save (alert) with Details… (the reason and Retry / Save as…), Changed outside Canopi (alert) with Resolve…. Web shows "Saved in this browser" and a Download a copy link; the file actions are icons (Open a .canopi file).
- Menus (native on macOS): File (New, Open…, Open recent ▸, Rename…, Save as…, Revert…, Add data…, Data library…, Import GeoJSON…, Export ▸ Planting plan (PDF)…, GeoJSON…, Budget as CSV…, Settings…, Close, Quit), Edit (history, clipboard, selection, species commands, grouping, Rotate…, lock, stamps), View (zoom, fit, place search, Grid/Snap/Rulers/Labels/Tool names as checkable items, panels Ctrl 1–8, Background, Theme), Tools (every tool with its key), Help (Keyboard shortcuts F1, Getting started, Report a problem…, About). Checkable items are `menuitemcheckbox`; a check column is reserved when a menu has any.

Shipped so far (canopi-h90p app frame): File keeps Save (Ctrl S) beside Save as…; Edit adds Find plants (Ctrl F) and uses Lock Ctrl L / Unlock rather than Unlock all; Close, Getting started, Add data…, Budget as CSV…, Rotate… and View › Labels (N) are not in the menus yet. Below 760 px the menubar becomes one Menu button with submenus inline, and Help, Settings and the Web file icons move into it.

## Start and new Designs

- Start: left column with logo, one line of purpose, New Design (Ctrl N, primary) and Open Design… (Ctrl O), a drop hint, Settings, Keyboard shortcuts, Report a problem…. Right: Search your Designs, Recent Designs (thumbnail, name, place name, counts, relative date; the row opens; More), Drafts (dashed tile; deleting confirms inline and names the draft).
- New Design opens "Where is your site?" over the world map: a combobox with results (coordinates offered only when the input reads as coordinates), attribution, and Skip. Then "Start your Design" beside the labelled tool rail: draw a zone, open the catalog, rename and Save as….

## Dialogs, notices and states

- Dialogs: Literata 20 title, body 14.5, footer actions right-aligned and wrapping, a leading ghost action aligned with the text. Modal, focus-trapped, Esc closes and returns focus.
- Notices: info (surface-2), warning (amber), error (red, alert). Toasts are dark, carry Undo when it applies, and do not time out while hovered or focused.
- Empty states say what goes here and give the one action to start. Loading keeps the frame: inline "Searching…", row skeletons, a progress bar for long opens. Errors say what happened, what is safe and the next step ("Restart Canopi" on Desktop, "Reload" on Web).

## Settings

A dialog with sections: Appearance (theme, language), Map and imagery (satellite source: free imagery or my Google key; key field with Show and Remove key; the key stays on this device; map style), New Designs (open on satellite, symbol size, labels), Keyboard (single-key shortcuts on or off, remapping), Files and data, About.

## Export planting plan

A side sheet beside the live preview: title on the sheet, paper, scale, area, background (None, Map, Satellite) and Fade, plant colours (As in the Design, Grayscale, Black), symbol size in mm, Include (codes, zones and notes, site data, north and scale), species key on the plan or on page 2 (default when there are many species), page thumbnails as buttons, Save PDF…. The printed key never truncates: names wrap and continued columns repeat their heading.

Shipped so far: the Settings dialog has Appearance only (theme, language, tool names); the other sections are follow-up work.

## Controls

- Dropdown (`components/shared/Dropdown.tsx`), never a native `<select>`; the accessible name includes the current value. DatePicker, never `<input type="date">`.
- Segmented controls are radio groups; the selected segment has an ink border. Switches are checkboxes with `role="switch"`. Radios are custom with a visible ring.
- Sliders show their value and have accessible names. The resize handle between map and dock widens on hover and supports the keyboard.

## Web on phones

Map first with a floating top bar (menu, Design name and save status, Undo, place search, 44 px targets), a tool strip on the left, zoom buttons and scale on the right, and a bottom sheet with peek, half and full heights (handle is a 44 px button), panel tabs with More, and 16 px inputs. Landscape uses a side sheet. Safe-area insets apply.
