# Canopi Design Domain

Canopi helps people create agroecological designs for permaculture, syntropic agriculture, and food forests. This glossary defines the product's domain language, independent of storage format, UI components, or implementation details.

## Language

**Design**: An agroecological plan that combines plants, spatial layout, scheduling, budget, consortium planning, and site information. A design may be saved as a `.canopi` file, but "design" is the user-facing domain term. _Avoid:_ Document, file, project

**Canvas PDF**: A printable, shareable representation of selected Layers from a Design's spatial layout, with local plant-identification keys on field sheets. A Canvas PDF may contain an overview fitted to printable objects and detail-sheet coverage, plus numbered detail pages focused on drawn Print Areas; the editable Design remains the source of truth. _Avoid:_ Design Report, Design file, canvas screenshot

**Print Area**: A temporary rectangle selected over a Design's spatial layout to define a Canvas PDF detail page. A Print Area belongs to the export setup, remains independent of Zones, and does not create or modify the Design's spatial features. Export never adds Print Areas for annotations; notes that cannot fit on the overview and lie outside chosen detail coverage are omitted. _Avoid:_ Zone, Zone Draft

**Design Session**: The active runtime context for a Design in the app. A design session includes the current Design state, its Home, dirty baselines, Continuous Save, queued Design loads, lifecycle workflows, and an optional attached canvas runtime. _Avoid:_ Document session, file session, canvas session

**Home**: Where a Design Session writes: the `.canopi` file it was opened from or saved as (Desktop), or a Design Draft. Every Design Session has exactly one home; Save As moves it to a file, and a Web download never changes it. _Avoid:_ Save location, current path, target

**Continuous Save**: Canopi's always-on saving: a Design Session writes its committed changes to its Home shortly after each change, when the window or page is left, before another Design replaces it and on close. "Unsaved" means "not yet written to the Home"; the user is asked only when a write fails or the file changed outside Canopi. _Avoid:_ Autosave, recovery, save prompt

**Web Edition**: A browser-accessible Canopi experience that creates, opens, edits, and exports real Designs. A web edition may omit desktop-only or planning-heavy surfaces, but it is not a separate sketch format, static catalog, or website-only demo. _Avoid:_ Web sketch, catalog site, demo app _Note:_ Web Edition omits the Recent Design list; its Designs live in browser Design Drafts.

**Browser App Shell**: The Web Edition workspace chrome for starting, opening, resuming, downloading, and navigating Designs in a browser. A browser app shell presents web-appropriate commands around the shared Canopi app core rather than reproducing desktop window or native file-management chrome. _Avoid:_ Desktop title bar, website navigation, embedded widget

**Welcome Screen**: The app-opening state shown when no Design Session is active. A welcome screen may offer entry points such as creating a new design, opening an existing design, or reopening a recent design, but it is not itself a Design and does not have a user-editable Design name. _Avoid:_ Homepage, empty design, untitled design

**Recent Design**: A previously opened or saved design reference that lets the user reopen that design from the app-opening experience. A recent design points to a saved design location; if that location is definitely gone, the reference is stale rather than a design the user can reopen. _Avoid:_ Recent file, recent document, history item

**Design Notebook**: The desktop app-level workspace for finding, organizing, and switching between saved Designs. A design notebook stores organizing metadata and references to saved Design locations only; the saved `.canopi` Design remains the authority for design content and Design name, and switching to a notebook entry starts a different Design Session rather than merging designs. _Avoid:_ File browser, recent list, project folder

**Species Key**: The Design’s searchable index of placed Species. Each entry pairs a Species Code with names, authored appearances, and the number of placed Plants. It identifies existing Plants; the Species Catalog discovers Species for placement.

**Species Code**: A short, unique reference for a Species within one Design, derived initially from its canonical name. A Design reserves assigned codes even when its last Plant of that Species is removed, so later additions do not rename existing references. Codes accompany the on-canvas key and printed detail sheets; they do not replace canonical Species identity.

**Species Focus**: A temporary viewing state that keeps one Species prominent while dimming other Plants. It survives switching side panels, is visibly clearable on the Canvas, and resets for a different Design. Focus changes neither Plant selection nor saved content.

**Design Draft**: A Design that has a Home but no `.canopi` file yet: every new, template-imported or (on Web) opened Design starts as one. Desktop keeps drafts in app data until Save As; Web keeps them in the current browser profile, where they are the only Home. Both welcome screens list drafts to open or delete. A design draft is not a portable `.canopi` file, a Design Notebook entry, a Recent Design or a cloud-synced library item. _Avoid:_ Browser Draft, autosave backup, untitled file

**Notebook Section**: A user-named, manually ordered grouping inside the Design Notebook. A notebook section organizes saved Design references one-to-many: a saved Design reference belongs to at most one notebook section, and section membership is personal app organization rather than saved Design content. _Avoid:_ Folder, tag, category

**Design Edit**: A non-canvas change to Design-owned state, including Budget Items, Timeline Actions, Consortiums, description, and extra fields. Design Edit owns no-op detection, committed edit behavior, and non-canvas dirty-state marking behind the Design Session seam. It does not own canvas scene state, save/load lifecycle, or UI draft state. _Avoid:_ Document mutation, panel action, direct currentDesign write

**App Command Graph**: The app runtime seam for user command identity, labels, availability, shortcuts, dispatch, and chrome projections such as menus, palettes, toolbars, and panel navigation. The app command graph coordinates command access to Design Session, canvas, settings, and shell state without owning those domain states. _Avoid:_ Menu registry, shortcut map, toolbar state

**Canvas Runtime Surface**: The app-facing seam for canvas runtime behavior, split by role into command, query, and Design Session document surfaces. Canvas runtime surfaces expose canvas capabilities to app modules while hiding SceneStore, renderers, tool state machines, history internals, and app adapters. Canvas runtime core should not import app modules; app-owned settings, Design Session clean-state updates, save composition, and Target Presentation cross through explicit adapters. _Avoid:_ Raw runtime, canvas service, renderer API

**Session Plane**: The runtime's local metre plane for the open Design, centred on the objects' bounds (or the view centre for an empty Design). Files store every design object position in WGS84 longitude/latitude; the session plane converts them to metres for tools, snapping, measurements and PDF layout, and is rebuilt when the view moves more than 10 km from its origin. _Avoid:_ Design location, anchor, spatial frame

**Map Layer**: A background row of the map canvas: Basemap (OpenFreeMap vector style), Satellite (imagery; while on, the Basemap is hidden), Contours or Hillshade. Map layers are app settings shared by every Design, not Design content. _Avoid:_ Layer, Data Layer, Design layer

**GeoJSON Exchange**: Import or export of a Design's objects as an RFC 7946 FeatureCollection in WGS84. An import adds ordinary Design Objects as one undoable edit; export carries each object's kind and domain properties. _Avoid:_ Design file, shapefile import

**Place Search**: The canvas control (pin button under the inspection lens) that finds a place by name or coordinates and moves the view there. Place Search moves only the camera; design objects never move. _Avoid:_ Location editing, geocoding panel

**Last View**: The camera position (longitude, latitude, zoom) the app remembers in settings. A new Design opens at the Last View. _Avoid:_ Design location, default site

**Shared Spatial Workspace**: The active Canvas composition that presents local botanical editing and geographic contributions through one camera and render lifecycle. MapLibre owns the live camera and frame. The workspace derives presentation from Design, Scene, LiDAR, settings, and Target authorities without owning them. _Avoid:_ Second map canvas, camera follower, map-owned Design state

**Canvas Layer Presentation**: The app-facing presentation seam for Layer chrome, map layer visibility, terrain layer controls, active layer selection, and layer-related commands. Canvas Layer Presentation turns scene Layer state, settings-backed map layer preferences, and terrain settings into caller-ready layer read models while routing writes to the correct authority. It does not own Design data, Scene Edit state, placement drafts, Shared Spatial Workspace lifecycle, or settings persistence. _Avoid:_ Layer panel state, map layer helper, terrain UI state

**Problem Report**: A user's description of a problem they encountered while using Canopi. A problem report may include reproduction context and a diagnostic bundle, but it is not the confirmed defect itself. _Avoid:_ Bug report, issue, feedback

**Report Summary**: A plain-text summary of a problem report that a user can copy into their chosen support channel. A report summary should be easy to find alongside any diagnostic bundle. _Avoid:_ Issue body, debug text, support template

**Diagnostic Bundle**: A user-approved package of troubleshooting evidence shared with a problem report. A diagnostic bundle contains support context only when the user chooses to include it. _Avoid:_ Logs, debug export, support zip

**Species**: A botanical catalog entry that describes a plant taxon and its ecological, morphological, agronomic, risk, use, and media data. A species is identified by its canonical name and may have common names. _Avoid:_ Plant, catalog plant, database plant

**Species Catalog**: The searchable collection of species and their supporting data used when selecting plants for a design. Species in the catalog are not part of a design until they become placed plants. _Avoid:_ Plant catalog, plant database

**Species Catalog Workbench**: The interaction surface for browsing, filtering, selecting, favoriting, and inspecting species from the Species Catalog. The workbench coordinates Species Catalog UI state, but it does not own Species Catalog data or Design workflows. _Avoid:_ Plant browser state, plant DB panel state

**Species Catalog Search**: A text search interaction inside the Species Catalog Workbench. Species Catalog Search uses the selected app language for Common Name matching and display, while Canonical Name and botanical taxonomy remain language-neutral ways to find species. _Avoid:_ Plant database search, global common-name search

**Species Catalog Filter**: A search criterion that narrows Species Catalog results by Species attributes such as climate fit, growth form, ecological role, risk, use, or morphology. A species catalog filter is user-facing behavior even when its implementation is backed by generated metadata, SQL columns, related tables, or bespoke predicates. _Avoid:_ Plant filter, SQL filter, column filter

**Canonical Name**: The normalized name Canopi uses to identify a species. A species has one canonical name in Canopi, even when it has synonyms or multiple common names. _Avoid:_ Scientific name, Latin name, species name

**Common Name**: A language-scoped local or everyday name for a species. A species may have many common names, and common names are display aids rather than stable identifiers; a common name in one language should not stand in for a missing common name in another language. _Avoid:_ Species identifier, primary key

**Matched Common Name**: A selected-language Common Name that explains why a Species appeared in Species Catalog Search results. A matched common name may differ from the Species' primary displayed Common Name, but it should not come from another language. _Avoid:_ English fallback match, hidden match

**Placed Plant**: An instance of a species positioned inside a design. Multiple placed plants may refer to the same species. _Avoid:_ Species, plant record, catalog item

**Plant Symbol**: A user-chosen built-in marker shape used to visually distinguish placed plants in a design. A placed plant may have its own plant symbol, and a design may define a default plant symbol for a species' placed plants; the symbol sits within the placed plant's Visual Footprint and is design-owned presentation, not Species Catalog data, physical geometry, or imported artwork. _Avoid:_ Custom icon, uploaded icon, SVG asset

**Plant Form Symbol**: A botanical plant symbol that suggests a visible form, such as a canopy, palm, fern, rosette, or climber. Plant Form Symbols are a compact visual vocabulary chosen by the designer, not a botanical classification, catalog value, or validation rule. Life cycle, aquatic habitat, epiphytic attachment, and species identity do not require separate symbols. _Avoid:_ Growth form value, inferred species icon, botanical claim

**Abstract Plant Symbol**: A simple geometric plant marker whose meaning is assigned by the designer. Abstract Plant Symbols complement botanical forms; neither shape nor color alone guarantees a unique species identity. _Avoid:_ Botanical form, species identifier

**Zone**: A named spatial feature in a design, optionally typed by ecological or functional purpose. A design may contain many zones, and zones may overlap placed plants, other zones, or linear boundaries. _Avoid:_ Shape, polygon, region

**Zone Draft**: An in-progress zone boundary that a user is still drawing. A zone draft is not part of the design until the user finishes it as a Zone. _Avoid:_ Temporary shape, unsaved polygon, canvas draft

**Polygonal Zone**: A zone whose boundary is defined by three or more zone edges. A polygonal zone is still a zone; "polygonal" describes its boundary geometry. _Avoid:_ Polygon, shape

**Rectangular Zone**: A zone whose boundary is defined by four right-angled zone edges. A rectangular zone may be rotated in the design; "rectangular" describes the zone geometry, not its alignment to the canvas. _Avoid:_ Axis-aligned rectangle, box, shape

**Elliptical Zone**: A zone whose boundary is an ellipse. An elliptical zone may be rotated in the design; "elliptical" describes its boundary geometry, not its alignment to the canvas. _Avoid:_ Oval, shape

**Linear Zone**: A zone whose geometry is one straight zone edge with two endpoints. A linear zone represents a boundary, row, path, or other linear feature rather than an enclosed area. _Avoid:_ Line object, measurement guide, spacing guide

**Zone Edge**: One straight boundary segment of a zone. A linear zone has one zone edge, a polygonal zone has many zone edges, a rectangular zone has four zone edges, and an elliptical zone has no zone edges. _Avoid:_ Line, stroke

**Zone Measurement**: A derived physical size description of a zone or zone edge, such as width, height, edge length, or area. A zone measurement describes the zone's current geometry; it is not a separate design object. _Avoid:_ Shape metadata, annotation, label

**Measurement Guide**: A persistent straight measuring aid in a design with two endpoints and a derived distance. Its line remains visible; Automatic Detail reveals the distance when space allows or the guide is inspected. A measurement guide helps a designer read distance without making the line an ecological boundary, spacing instruction, or text note. _Avoid:_ Linear Zone, Spacing Guide, ruler line

**Zone Control Point**: An on-canvas point a designer can drag to reshape a selected zone. Zone control points are editing affordances for a zone's geometry; they are not separate design objects or zone measurements. _Avoid:_ Shape handle, vertex handle, resize knob

**Annotation**: A text note positioned in a design. An annotation explains or labels part of the design without becoming a zone, placed plant, or timeline action. _Avoid:_ Label, comment

**Design Object**: A canvas-positioned part of a design, such as a placed plant, zone, annotation, measurement guide, or object group. Design objects are the things users arrange spatially in the design. _Avoid:_ Canvas object, shape, element

**Rotation Pivot**: The point around which one or more selected design objects turn during a rotation. _Avoid:_ Origin, anchor, center point

**Rotation Handle**: The on-canvas control a user drags to rotate the current design object selection. _Avoid:_ Rotation button, spin control, transform widget

**Selection Action Toolbar**: A compact contextual canvas toolbar for commands that act on the current editable design object selection, such as locking, grouping, or precision transforms. _Avoid:_ Canvas toolbar, inspector, floating card

**Canvas Context Menu**: A compact canvas-scoped menu for common edit commands such as Copy, Paste, and Delete. A canvas context menu may act on the current editable design object selection or on a canvas point for paste placement, but it is not the Selection Action Toolbar. _Avoid:_ Browser menu, right-click menu, action bar

**Species Selection**: A canvas selection gesture that selects visible editable placed plants of the same species as a reference placed plant. Species selection uses Canonical Name identity and is temporary interaction state, not a planning Target. _Avoid:_ Species target, select similar, same common name

**Design Object Rotation**: A scene edit that turns one or more selected design objects around a rotation pivot, changing their visible orientation or geometry in the design. _Avoid:_ Orientation field, group transform, element rotation

**Design Object Lock**: A saved editing constraint on a design object that prevents direct selection, transformation, deletion, and reuse as an object stamp source while leaving the object visible and discoverable in the design. A design object lock belongs to the design, not only to the design session, and is stored with the locked design object rather than in a separate top-level lock list. If an object group contains a locked design object, the object group cannot be moved, deleted, stamped, or otherwise edited in a way that mutates the locked member. _Avoid:_ Selection lock, runtime lock

**Visual Footprint**: The visible on-screen presence of a design object or its readable presentation aids at the current zoom level. A visual footprint may differ from the object's real-world geometry when readability requires it. _Avoid:_ Object scale, canvas scale, display size

**Automatic Detail**: The presentation that reveals plant symbols, names, annotations and measurements as available space allows. On the Canvas this uses screen space; Canvas PDF uses physical page space, collision-only plant enclosures, readable annotations, aligned measurements and complete adaptive keys. Its overview groups stored guide values and native Zone dimensions without generating a Species key. Automatic Detail changes what is readable at a given zoom without changing the Design or its authored presentation choices. _Avoid:_ Display by mode, canopy sizing, automatic design editing

**Inspection Lens**: A temporary magnified view of a small part of the Canvas, with plant names beside their positions inside the frame while the surrounding Design remains in view. Its magnification adapts to planting density, and the frame can be expanded. Holding the lens fixes its inspection location; it does not pin plant names or create a Design Object. _Avoid:_ Planting strip, Print Area, second Design

**Plant Drag Distance Guide**: A temporary on-canvas distance cue shown while dragging a placed plant. A plant drag distance guide describes the center-to-center distance from the active dragged placed plant to nearby non-dragged placed plants, and it is not saved in the design. _Avoid:_ Plant spacing interval, zone measurement, ruler

**Selection Label**: A temporary visible name label shown only when one unpinned placed plant is the current selection. A selection label helps identify the current selection and is not saved in the design. _Avoid:_ Pinned Plant Name, annotation, hover tooltip

**Pinned Plant Name**: A saved choice to display the name of an individual placed plant in a design, subject to zoom and local screen space on the canvas. Pinned names take priority over automatic names. A pinned plant name is a presentation aid; hiding it at low zoom does not unpin the name or lock the placed plant. _Avoid:_ Locked plant name, Design Object Lock, annotation

**Layer**: A fixed visibility and locking group for design objects. A design has many layers, and each layer controls whether its objects are visible, locked, and how opaque they appear; layers are not arbitrary user-created folders. _Avoid:_ Category, folder, custom layer

**Data Layer**: A reusable library collection of ordered geographic raster sources describing one measurement. Higher-priority valid source samples cover lower-priority samples for both display and analysis; hiding the Data Layer in a Design changes only its presentation. _Avoid:_ Canvas Layer, merged file, source folder

**Data Source**: One independently interpreted raster occurrence in a Data Layer. Moving it changes overlap priority; removing it changes the current composition without erasing retained history. _Avoid:_ Canvas object, display layer

**Scene Edit**: A runtime change to canvas-owned design state, including placed plants, zones, annotations, object groups, layers, plant species colors, plant species symbols, and guides. A scene edit is the canvas mutation concept that owns undo/redo history, dirty-state updates, mirror projections, and render invalidation for canvas state. _Avoid:_ Canvas mutation, layer signal write, scene patch

**Object Group**: A named or unnamed flat collection of design objects whose members move or transform together. An object group may contain placed plants, zones, or annotations across Layers; the group itself is not a separate visible design shape and object groups do not nest inside object groups. _Avoid:_ Layer, selection

**Plant Stamp**: An interaction for placing repeated placed plants from a chosen species. A plant stamp starts from Species Catalog data and creates new placed plants in the design. _Avoid:_ Object stamp, clone tool

**Plant Stamp Source**: The Species-derived source currently chosen for Plant Stamp placement, including the canonical name, Common Name, Stratum, and canopy spread needed to create placed plants from click or drag interactions. A plant stamp source is runtime interaction state, not a design object. _Avoid:_ Plant stamp payload, plant stamp signal, dragged plant JSON

**Object Stamp**: An interaction for sampling an existing design object and placing repeated copies of it. An object stamp starts from a design object already in the design, not from Species Catalog data. _Avoid:_ Plant stamp, copy/paste

**Saved Object Stamp**: A named personal reusable snapshot of one or more design objects that a designer can save and place into designs later, primarily for multi-object arrangements of placed plants, zones, annotations, and captured object groups. Saved object stamps preserve visible arrangement details while excluding non-visual planning details and lock state; placing one creates unlocked ordinary design objects, selects the newly placed objects without implying a new object group, and leaves the original source objects unchanged. _Avoid:_ Template, Design Template, favorite plant, object group

**Plant Spacing**: An interaction for repeating a sampled placed plant along a chosen spacing guide at a chosen interval. Plant spacing starts from a placed plant already in the design and creates additional placed plants of the same species. _Avoid:_ Line tool, interval tool, linear stamp

**Spacing Guide**: A temporary guide used to choose a direction, length, and interval for plant spacing. A spacing guide is not a design object. _Avoid:_ Line, ruler line, spacing object

**Plant Spacing Interval**: The positive center-to-center distance between placed plants in plant spacing. A plant spacing interval is expressed as a physical distance, not as canopy overlap or plant radius. _Avoid:_ Gap, radius, endpoint spacing

**Climate Zone**: A broad climate classification associated with a site or design template. Climate zone helps designers compare templates and site suitability at a high level. _Avoid:_ Hardiness zone

**Hardiness Zone**: A plant cold-tolerance zone used to assess whether a species is suitable for a target site. A species may have minimum and maximum hardiness zones. _Avoid:_ Climate zone

**Timeline Action**: A scheduled action in a design, such as planting, maintenance, or another work item. A timeline action may have dates, recurrence, dependencies, completion state, and targets in the design. _Avoid:_ Event, task, calendar item

**Timeline Action Workbench**: The interaction surface for creating, editing, deleting, completing, and selecting timeline actions in Calendar. The timeline action workbench coordinates action forms and target presentation, but it does not own Design data. _Avoid:_ Timeline popup, event editor, task workbench

**Calendar**: The right-dock presentation of Timeline Actions. Calendar provides month and agenda views, civil-date editing, completion, search, and explicit target editing while Timeline Action data remains owned by the Design. _Avoid:_ Timeline canvas, calendar data store, event database

**Budget Item**: A cost entry in a design. A budget item may refer to a species, placed plant, zone, or manual line item and contributes to the design's budget. _Avoid:_ Price, estimate row

**Budget Item Workbench**: The interaction surface for editing budget item prices, choosing budget currency, exporting budget data, and presenting budget item targets. The budget item workbench coordinates budget UI state and commands, but it does not own placed plants or the planning projection. _Avoid:_ Budget tab state, price editor helper, CSV helper

**Target**: The design subject that a timeline action, budget item, or other planning entry refers to. A target may identify a species, a placed plant, a zone, or a manual entry. _Avoid:_ Panel target, link, reference

**Target Presentation**: Runtime presentation state that connects targets from planning surfaces, canvas hover, and map overlays. Target presentation may mark hovered or selected targets and their origin, but it must not mutate Design data, canvas selection, labels, dirty state, or history. _Avoid:_ Panel target state, canvas selection, planning projection state

**Planning Projection**: A runtime read model that combines Design planning entries, placed plants, localized species names, and targets for planning surfaces such as timeline, budget, and consortium views. A planning projection does not own Design data, canvas scene data, or Target Presentation lifecycle; it only derives view-ready planning rows from those authorities. _Avoid:_ Panel view model, budget row helper, tab bridge

**Consortium**: A stratified, time-aware plant assembly in a design. A consortium describes which species participate, which stratum they occupy, and which succession phases they span. _Avoid:_ Guild, companion planting group

**Consortium Entry**: One species' participation in a consortium, with one Stratum and one Succession Phase span. The span includes both its starting and ending succession phases, and the entry is species-level planning, not an individual placed plant. _Avoid:_ Plant row, plant bar, placed plant entry

**Consortium Lane**: A derived visual track within a Stratum that can contain multiple Consortium Entries when their Succession Phase spans do not overlap. Overlapping entries are presented in separate consortium lanes, and designers do not manage consortium lanes directly. _Avoid:_ Row, sub-lane, slot

**Stratum**: A vertical layer in a consortium, such as emergent, high, medium, or low. A consortium entry belongs to one stratum. _Avoid:_ Layer, row, height band

**Succession Phase**: A time phase in a consortium's development, from early establishment through climax. A consortium entry spans one or more succession phases. _Avoid:_ Timeline action, stage

**Consortium Time Model**: The ordered Succession Phases, ordered Strata, default Consortium entry timing, and clamping rules used by Consortium planning and presentation. The consortium time model defines time and Stratum meaning; renderers and interaction modules consume it rather than owning those facts. _Avoid:_ Consortium renderer constants, timeline model

**Design Template**: A reusable design that can be imported as the starting point for a new design. A design template contains geolocated design objects and descriptive metadata and is placed relative to the current view on insert. _Avoid:_ Community template, file template
