# Canopi Design Domain

Canopi helps people create agroecological designs for permaculture, syntropic agriculture and food forests. This glossary defines the product's domain language. Every term is the name the interface uses (`desktop/web/src/i18n/en.json`; translations in the [UI glossary](docs/guides/ui-glossary.md)); the few architecture terms at the end name authorities, not screens. Code, guides, ADRs and bd use these words.

## Designs and files

**Design**: An agroecological plan drawn on the map: plants, zones, notes, measurements, planning (Calendar, Budget, Consortium), saved views and stories. Saved as a `.canopi` file; "Design" is always capitalised. _Avoid:_ Document, file, project

**Draft**: A Design that has no `.canopi` file yet. Every new Design starts as one; Desktop keeps drafts in app data until Save as…, the Web Edition keeps them in the browser, where they are the only home. The Start screen lists drafts. _Avoid:_ Autosave backup, untitled file

**Home**: Where a Design Session writes: the `.canopi` file it was opened from or saved as (Desktop), or a Draft. Save as… moves it to a file; a Web download never changes it. _Avoid:_ Save location, target

**Continuous Save**: Canopi's always-on saving: committed changes are written to the Home shortly after each change, when the window is left, before another Design replaces it and on close. The user is asked only when a write fails or the file changed outside Canopi. _Avoid:_ Autosave, save prompt

**Design Session**: The runtime context of the open Design: its state, Home, Continuous Save, lifecycle workflows and the attached scene runtime. _Avoid:_ Document session

**Start screen**: What the app shows when no Design Session is active: New Design, Open Design… (Web: Open a .canopi file…), Drafts and, on Desktop, Recent Designs. A Design that cannot open says why ("Can’t open this Design": older, newer, missing or damaged), never a path. _Avoid:_ Welcome screen, homepage

**Recent Design**: A Desktop reference to a `.canopi` file opened or saved before, with its sketch and counts. A file that is gone, older, newer or damaged shows its name and why it cannot open. _Avoid:_ Recent file, history item

**Design notebook**: The Desktop panel that lists saved Designs in user-named sections. It stores references and organisation only; the `.canopi` file stays the authority. Not in the Web Edition. _Avoid:_ File browser, project folder

**Web Edition**: Canopi in a browser: the same map canvas, panels, stories and PDF export with a reduced Plant catalog and browser-local Drafts; it cannot import or show terrain data but keeps a Design's terrain layers for Desktop. It is a real editor, not a demo or a website. _Avoid:_ Web sketch, demo app

**GeoJSON import and export**: A Design's objects as a WGS84 FeatureCollection. Import adds ordinary Design objects in one undoable step. _Avoid:_ Shapefile import

**Design template**: A static `.canopi` file offered as a starting Design. Web Edition only, hidden unless templates are configured. _Avoid:_ Community template

## Map and coordinates

**Map canvas**: The design surface is the map itself: basemap, satellite, terrain data, contours and hillshading are its background. There is no separate local canvas and no Design location; Settings › Canvas names the map's input options (Scroll wheel: Zooms the map or Pans the map). _Avoid:_ sketch, Design location

**Session plane**: The runtime's local metre plane for the open Design, centred on the objects. Files store WGS84 longitude/latitude; the session plane converts to metres for tools, snapping, measurements and PDF layout. _Avoid:_ Anchor, spatial frame

**Background**: The Layers choice under the Design: Satellite, Map or None (plain paper), with its opacity and Soften background. An app setting shared by every Design. _Avoid:_ Basemap layer, Design layer

**Online elevation**: Contour lines and Hillshading, drawn from online elevation, not from imported data, listed in Layers. App settings, not Design content. _Avoid:_ Map layers, Site data

**Place search**: The title-bar field (Search a place…, Ctrl K) that finds a place by name (on Enter) or by typed coordinates and moves the view there. Only the camera moves; objects never do. _Avoid:_ Location editing, geocoding

**Last view**: The camera position Canopi remembers in settings; "Where is your site?" opens a new Design over it. _Avoid:_ Design location, default site

**Saved view**: A named camera position kept in the Design (View › Save current view…), with the background, layers, labels and focused species it showed, and a picture. Going to a view moves only the camera. _Avoid:_ Bookmark, camera preset

**Story**: An ordered set of steps kept in the Design, each showing a saved view with a title, text and pictures. Present shows a story full-window. Presenting never changes the Design. _Avoid:_ Slideshow, tour

## Design objects

**Design object**: Anything placed on the map canvas: a placed plant, zone, text note, measurement or group. Positions are stored as longitude/latitude. _Avoid:_ Canvas object, shape, element

**Placed plant**: One instance of a species positioned in a Design. Many placed plants share a species. _Avoid:_ Species, catalog item

**Plant symbol**: The marker a placed plant draws, chosen by the designer from four families: plant form, what it gives, what it does and abstract marks. Any symbol takes any colour. Design-owned presentation, not catalog data. _Avoid:_ Custom icon, uploaded icon

**Plant label**: The code or name shown beside a placed plant. View › Labels chooses None, Codes or Names for the Design; Show name pins one plant's name. _Avoid:_ Annotation, tooltip

**Species focus**: A temporary view state that keeps one species prominent and dims the others. Saved views remember it; it changes neither selection nor content. _Avoid:_ Filter, selection

**Zone**: An area or line drawn in a Design, typed by its shape: Polygon zone, Rectangle zone, Ellipse zone or Line zone. _Avoid:_ Shape, region

**Zone display name**: A zone's name where it has one (Rename zone…), otherwise its type and size ("Rectangle zone · 120 m²"). Panels never show an internal id. _Avoid:_ Zone id, label

**Text note**: A positioned text object in a Design. _Avoid:_ Annotation, label, comment

**Measurement**: A persistent straight measuring aid with two endpoints and a derived distance, drawn with Measure. Not a boundary or row. _Avoid:_ Line zone, ruler line

**Group**: Design objects that move and transform together (Arrange › Group). Groups do not nest. _Avoid:_ Layer, selection

**Layer**: A fixed visibility and locking group of Design objects (Annotations, Plants, Measurement guides, Zones) in the Design section of Layers. Not user-created folders. _Avoid:_ Folder, category

**Lock**: A saved constraint on a Design object that stops selection, moving, deleting and copying while keeping it visible. Edit › Unlock all releases every lock as one Undo. _Avoid:_ Selection lock

**Selection chip**: The chip at the bottom of the map that names the selection ("12 plants · 3 species · 0.52 m apart", "Zone · Z04 · 118 m² · 46 m") with Select all of this species, Rename… and Clear selection. _Avoid:_ Status bar, inspector

**Right-click menu**: The one context menu for objects and the empty map (right-click, the Menu key or Shift F10): Cut, Copy, Paste, Duplicate, Plant color, Plant symbol, Arrange, Save as stamp, Lock, Rotate…, Species details, Add to calendar…, Set unit cost… and more. _Avoid:_ Selection toolbar, action bar

**Tool card**: The card beside the tool rail that names the active tool, what to do now and its keys. _Avoid:_ Toolbar hint, status text

**Inspection lens**: A temporary magnified view of a small part of the map with plant names beside their positions. It creates no Design object. _Avoid:_ Print area, second Design

## Placing tools

**Place plants**: The tool that places one species per click, with a chooser (species in the Design, Favorites, recent, search, the catalog). _Avoid:_ Plant stamp, clone tool

**Plant a row**: The tool that repeats a species along a drawn line at an Interval, the centre-to-centre distance. _Avoid:_ Spacing tool, linear stamp

**Stamp**: A copy source for Place a stamp: an object picked on the map, or a saved stamp. Copies land unlocked and selected; the source never changes. _Avoid:_ Template, clone

**Saved stamps**: Named personal snapshots of selected objects (plants, zones, notes, groups), kept outside Designs in Favorites and stamps, importable and exportable. They keep visible arrangement, not planning data or locks. _Avoid:_ Template, Design template

## Plants and the catalog

**Plant catalog**: The searchable species database with filters, details, photos and Favorites. Guides call the subsystem the species catalog. A species enters a Design only as placed plants. _Avoid:_ Plant database, species browser

**Species**: A catalog entry describing a plant taxon and its ecological, morphological, agronomic, use and media data, identified by its canonical name. _Avoid:_ Plant, catalog plant

**Canonical name**: The scientific name Canopi uses to identify a species; one per species. _Avoid:_ Latin name, species name

**Common name**: A language-scoped everyday name. Lists show the name in the interface language; when none exists they show the English name marked "(en)". A common name never stands in for another language. _Avoid:_ Species identifier

**Species code**: A short unique code for a species within one Design (IBM Plex Mono). A Design keeps assigned codes even after the last plant of that species is removed. _Avoid:_ Species id

**Plants in this Design**: The panel listing the placed species with counts, colours, symbols and Display on the map (colour by Species, Stratum or One color; Symbol size; Outline; Labels). _Avoid:_ Species key, legend panel

**Find plants**: The Ctrl F search in every plant list (guides call it the plant finder): common names in every language, scientific names, synonyms and codes; accents, capitals and small typos do not matter; with Selected on map, Stratum and Form filters. _Avoid:_ Global search

**Hardiness zone**: A USDA cold-tolerance zone of a species (min and max). _Avoid:_ Climate zone

## Planning panels

**Calendar**: The panel of actions: scheduled work (a range, one day or unscheduled) with a type, completion, description and targets. _Avoid:_ Timeline, tasks

**Budget**: The panel of unit costs per species, a currency and a CSV export. _Avoid:_ Estimate, price list

**Consortium**: A stratified, time-aware plant assembly: which species take part, in which stratum and across which succession phases. _Avoid:_ Guild, companion group

**Stratum**: A vertical layer of a consortium: Emergent, High, Mid or Low. A species without one is "No stratum yet"; stratum colours on the map follow it. _Avoid:_ Layer, height band

**Succession phase**: A time phase of a consortium: Placenta 1–3, Secondary 1–3, Climax. An entry spans a first and a last phase. _Avoid:_ Stage, action

**Target**: What a Calendar action or Budget line refers to: a species, a placed plant, a zone or the whole Design. _Avoid:_ Link, reference

## Data and analyses

**Data library**: The Desktop store of imported terrain and height rasters (single-band GeoTIFF: ground elevation, surface elevation, height above ground) and calculated results, shared by every Design; it reads rasters itself, with no GDAL or other install, and says when it was rebuilt or cannot open. Delete everywhere removes an item from the library and every Design. _Avoid:_ LiDAR panel, layer store

**Site data**: The Layers section that lists the Data library items this Design shows, with results nested under their source. Remove from Design keeps the item in the library. _Avoid:_ Data layer, terrain layer

**Analysis**: A calculation run on a Data library item with recorded parameters and history, such as Slope from ground elevation. A result knows when its source changed (Out of date, Refresh). _Avoid:_ Filter, derived layer

## PDF export

**Planting plan (PDF)**: File › Export › Planting plan (PDF)…, titled "Export to PDF": the planting plan as pages with a plant key, north arrow and scale, printed As in the Design, in Grayscale or in Black. The Design never changes. _Avoid:_ Design report, screenshot

**Field sheet**: A detail page added over a drawn print area (Add field sheet) or the Whole Design, with its own key. Print areas belong to the export, never to the Design. _Avoid:_ Zone, page zone

## Support

**Problem report**: Help › Report a problem… (Desktop): a summary and a diagnostic bundle the user shares by hand. The bundle never holds screenshots, raw paths or keys, and holds the Design only when the user opts in. _Avoid:_ Bug report, telemetry

## Architecture authorities

**Scene Edit**: A runtime transaction on canvas-owned state (objects, layers, species colours and symbols) that owns undo history and dirty state. _Avoid:_ Canvas mutation, scene patch

**Design Edit**: A change to non-canvas Design state: Budget, Calendar, Consortium, saved views, stories, description and extra fields. _Avoid:_ Panel action, direct write

**App Command Graph**: The one registry of user commands: labels, availability, shortcuts and dispatch for menus, the Command palette (Ctrl Shift P) and rails. _Avoid:_ Menu registry, shortcut map

**Browser App Shell**: The Web Edition chrome (title bar, menus, phone layout) around the shared app core. _Avoid:_ Website navigation
