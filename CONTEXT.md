# Canopi Design Domain

Canopi helps people create agroecological designs for permaculture, syntropic agriculture, and food forests. This glossary defines the product's domain language, independent of storage format, UI components, or implementation details.

## Language

**Design**:
An agroecological plan that combines plants, spatial layout, scheduling, budget, consortium planning, and site information. A design may be saved as a `.canopi` file, but "design" is the user-facing domain term.
_Avoid_: Document, file, project

**Design Session**:
The active runtime context for a Design in the app. A design session includes the current Design state, dirty baselines, save/autosave behavior, queued Design loads, lifecycle workflows, and an optional attached canvas runtime.
_Avoid_: Document session, file session, canvas session

**App Command Graph**:
The app runtime seam for user command identity, labels, availability, shortcuts, dispatch, and chrome projections such as menus, palettes, toolbars, and panel navigation. The app command graph coordinates command access to Design Session, canvas, settings, and shell state without owning those domain states.
_Avoid_: Menu registry, shortcut map, toolbar state

**Canvas Map Surface**:
The in-canvas map visualization seam that turns Location, canvas query state, layer settings, terrain settings, Target Presentation, theme, and map bearing into one MapLibre-ready snapshot. The canvas map surface is derived presentation and must not own Design data, Scene Edit state, Location drafts, or settings persistence.
_Avoid_: MapLibre controller, basemap helper, map overlay state

**Problem Report**:
A user's description of a problem they encountered while using Canopi. A problem report may include reproduction context and a diagnostic bundle, but it is not the confirmed defect itself.
_Avoid_: Bug report, issue, feedback

**Report Summary**:
A plain-text summary of a problem report that a user can copy into their chosen support channel. A report summary should be easy to find alongside any diagnostic bundle.
_Avoid_: Issue body, debug text, support template

**Diagnostic Bundle**:
A user-approved package of troubleshooting evidence shared with a problem report. A diagnostic bundle contains support context only when the user chooses to include it.
_Avoid_: Logs, debug export, support zip

**Species**:
A botanical catalog entry that describes a plant taxon and its ecological, morphological, agronomic, risk, use, and media data. A species is identified by its canonical name and may have common names.
_Avoid_: Plant, catalog plant, database plant

**Species Catalog**:
The searchable collection of species and their supporting data used when selecting plants for a design. Species in the catalog are not part of a design until they become placed plants.
_Avoid_: Plant catalog, plant database

**Species Catalog Workbench**:
The interaction surface for browsing, filtering, selecting, favoriting, and inspecting species from the Species Catalog. The workbench coordinates Species Catalog UI state, but it does not own Species Catalog data and must not own Design workflows such as Site Adaptation.
_Avoid_: Plant browser state, plant DB panel state

**Species Catalog Filter**:
A search criterion that narrows Species Catalog results by Species attributes such as climate fit, growth form, ecological role, risk, use, or morphology. A species catalog filter is user-facing behavior even when its implementation is backed by generated metadata, SQL columns, related tables, or bespoke predicates.
_Avoid_: Plant filter, SQL filter, column filter

**Species Catalog Read Projection**:
A backend read model that translates Species Catalog storage rows into caller-oriented data for search, detail, compatibility checks, or replacement suggestions. A species catalog read projection owns SQL shape, row mapping, parameter placeholders, and localized Common Name hydration; consuming workflows add their own interpretation.
_Avoid_: Raw species row, SQL result, ad hoc lookup

**Canonical Name**:
The normalized name Canopi uses to identify a species. A species has one canonical name in Canopi, even when it has synonyms or multiple common names.
_Avoid_: Scientific name, Latin name, species name

**Common Name**:
A local or everyday name for a species. A species may have many common names, and common names are display aids rather than stable identifiers.
_Avoid_: Species identifier, primary key

**Placed Plant**:
An instance of a species positioned inside a design. Multiple placed plants may refer to the same species.
_Avoid_: Species, plant record, catalog item

**Plant Size Mode**:
A presentation choice for how placed plants are visually sized in a design. The default plant size mode shows placed plants as symbolic position markers; canopy spread mode shows their physical canopy footprint.
_Avoid_: Object scale, canvas scale, plant display mode

**Zone**:
A named area in a design, optionally typed by ecological or functional purpose. A design may contain many zones, and zones may overlap placed plants or other zones.
_Avoid_: Shape, polygon, region

**Polygonal Zone**:
A zone whose boundary is defined by three or more zone edges. A polygonal zone is still a zone; "polygonal" describes its boundary geometry.
_Avoid_: Polygon, shape

**Elliptical Zone**:
A zone whose boundary is an ellipse. An elliptical zone is still a zone; "elliptical" describes its boundary geometry.
_Avoid_: Oval, shape

**Zone Edge**:
One straight boundary segment of a zone. A polygonal zone has many zone edges; a rectangular zone has four zone edges; an elliptical zone has no zone edges.
_Avoid_: Line, stroke

**Zone Measurement**:
A derived physical size description of a zone or zone edge, such as width, height, edge length, or area. A zone measurement describes the zone's current geometry; it is not a separate design object.
_Avoid_: Shape metadata, annotation, label

**Annotation**:
A text note positioned in a design. An annotation explains or labels part of the design without becoming a zone, placed plant, or timeline action.
_Avoid_: Label, comment

**Design Object**:
A canvas-positioned part of a design, such as a placed plant, zone, annotation, or object group. Design objects are the things users arrange spatially in the design.
_Avoid_: Canvas object, shape

**Design Object Lock**:
A saved editing constraint on a design object that prevents direct selection, transformation, deletion, and reuse as an object stamp source while leaving the object visible in the design. A design object lock belongs to the design, not only to the design session, and is stored with the locked design object rather than in a separate top-level lock list. If an object group contains a locked design object, the object group cannot be moved, deleted, stamped, or otherwise edited in a way that mutates the locked member.
_Avoid_: Selection lock, runtime lock

**Visual Footprint**:
The visible on-screen presence of a design object or its readable presentation aids at the current zoom level. A visual footprint may differ from the object's real-world geometry when readability requires it.
_Avoid_: Object scale, canvas scale, display size

**Layer**:
A visibility and locking group for design objects. A design has many layers, and each layer controls whether its objects are visible, locked, and how opaque they appear.
_Avoid_: Category, folder

**Scene Edit**:
A runtime change to canvas-owned design state, including placed plants, zones, annotations, object groups, layers, plant species colors, and guides. A scene edit is the canvas mutation concept that owns undo/redo history, dirty-state updates, mirror projections, and render invalidation for canvas state.
_Avoid_: Canvas mutation, layer signal write, scene patch

**Object Group**:
A named or unnamed collection of design objects that move or transform together. An object group may contain placed plants, zones, annotations, or other design objects.
_Avoid_: Layer, selection

**Plant Stamp**:
An interaction for placing repeated placed plants from a chosen species. A plant stamp starts from Species Catalog data and creates new placed plants in the design.
_Avoid_: Object stamp, clone tool

**Plant Stamp Source**:
The Species-derived source currently chosen for Plant Stamp placement, including the canonical name, Common Name, Stratum, and canopy spread needed to create placed plants from click or drag interactions. A plant stamp source is runtime interaction state, not a design object.
_Avoid_: Plant stamp payload, plant stamp signal, dragged plant JSON

**Object Stamp**:
An interaction for sampling an existing design object and placing repeated copies of it. An object stamp starts from a design object already in the design, not from Species Catalog data.
_Avoid_: Plant stamp, copy/paste

**Plant Spacing**:
An interaction for repeating a sampled placed plant along a chosen spacing guide at a chosen interval. Plant spacing starts from a placed plant already in the design and creates additional placed plants of the same species.
_Avoid_: Line tool, interval tool, linear stamp

**Spacing Guide**:
A temporary guide used to choose a direction, length, and interval for plant spacing. A spacing guide is not a design object.
_Avoid_: Line, ruler line, spacing object

**Plant Spacing Interval**:
The positive center-to-center distance between placed plants in plant spacing. A plant spacing interval is expressed as a physical distance, not as canopy overlap or plant radius.
_Avoid_: Gap, radius, endpoint spacing

**Location**:
The real-world site associated with a design, expressed as latitude, longitude, and optionally altitude. A design has zero or one location.
_Avoid_: Map pin, address

**Location Workbench**:
The interaction surface for searching, setting, clearing, presenting, and validating a design's location. The location workbench coordinates location drafts, geocoding results, altitude preservation, saved-site presentation, and map-readiness cues, but it does not own canvas scene data.
_Avoid_: Map panel state, location input state, basemap status helper

**Location Notice**:
A user-facing cue that reports active site/map readiness for a design with a Location, such as loading, precision, or map/terrain availability. A location notice is informational; it does not set, clear, or validate the design's location.
_Avoid_: Basemap feedback, map warning, location tooltip

**Climate Zone**:
A broad climate classification associated with a site or design template. Climate zone helps designers compare templates and site suitability at a high level.
_Avoid_: Hardiness zone

**Hardiness Zone**:
A plant cold-tolerance zone used to assess whether a species is suitable for a target site. A species may have minimum and maximum hardiness zones.
_Avoid_: Climate zone

**Timeline Action**:
A scheduled action in a design, such as planting, maintenance, or another work item. A timeline action may have dates, recurrence, dependencies, completion state, and targets in the design.
_Avoid_: Event, task, calendar item

**Timeline Action Workbench**:
The interaction surface for creating, editing, deleting, and selecting timeline actions in the timeline view. The timeline action workbench coordinates action forms and target presentation, but it does not own Design data.
_Avoid_: Timeline popup, event editor, task workbench

**Timeline Action Canvas**:
The canvas-based interaction surface for viewing, panning, zooming, dragging, selecting, and editing timeline actions. The timeline action canvas coordinates Planning Projection inputs, canvas rendering, pointer ordering, popover presentation, and target presentation, while Timeline Action data remains owned by the Design.
_Avoid_: Timeline renderer, timeline frame, timeline canvas component

**Budget Item**:
A cost entry in a design. A budget item may refer to a species, placed plant, zone, or manual line item and contributes to the design's budget.
_Avoid_: Price, estimate row

**Budget Item Workbench**:
The interaction surface for editing budget item prices, choosing budget currency, exporting budget data, and presenting budget item targets. The budget item workbench coordinates budget UI state and commands, but it does not own placed plants or the planning projection.
_Avoid_: Budget tab state, price editor helper, CSV helper

**Target**:
The design subject that a timeline action, budget item, or other planning entry refers to. A target may identify a species, a placed plant, a zone, or a manual entry.
_Avoid_: Panel target, link, reference

**Target Presentation**:
Runtime presentation state that connects targets from planning surfaces, canvas hover, and map overlays. Target presentation may mark hovered or selected targets and their origin, but it must not mutate Design data, canvas selection, labels, dirty state, or history.
_Avoid_: Panel target state, canvas selection, planning projection state

**Planning Projection**:
A runtime read model that combines Design planning entries, placed plants, localized species names, and targets for planning surfaces such as timeline, budget, and consortium views. A planning projection does not own Design data, canvas scene data, or Target Presentation lifecycle; it only derives view-ready planning rows from those authorities.
_Avoid_: Panel view model, budget row helper, tab bridge

**Consortium**:
A stratified, time-aware plant assembly in a design. A consortium describes which species participate, which stratum they occupy, and which succession phases they span.
_Avoid_: Guild, companion planting group

**Stratum**:
A vertical layer in a consortium, such as emergent, high, medium, or low. A consortium entry belongs to one stratum.
_Avoid_: Layer, row, height band

**Succession Phase**:
A time phase in a consortium's development, from early establishment through climax. A consortium entry spans one or more succession phases.
_Avoid_: Timeline action, stage

**Consortium Time Model**:
The ordered Succession Phases, ordered Strata, default Consortium entry timing, and clamping rules used by Consortium planning and presentation. The consortium time model defines time and Stratum meaning; renderers and interaction modules consume it rather than owning those facts.
_Avoid_: Consortium renderer constants, timeline model

**Design Template**:
A reusable design that can be imported as the starting point for a new design. A design template usually includes location, placed plants, and descriptive metadata.
_Avoid_: Community template, file template

**Site Adaptation**:
The process of checking whether species in a design or design template suit the target site. Site adaptation may surface compatibility results and replacement suggestions.
_Avoid_: Template adaptation, plant review

**Compatibility Check**:
An assessment of whether a species fits a target site condition, such as hardiness zone. A compatibility check describes fit; it does not by itself change the design.
_Avoid_: Validation, health check

**Replacement Suggestion**:
A species proposed as a better fit for the target site than an incompatible species. A replacement suggestion is optional guidance, not an automatic substitution.
_Avoid_: Alternative, recommendation

## Flagged Ambiguities

**Document vs Design**:
Use **Design** for the user's agroecological plan. Reserve "document" and "file" for implementation, persistence, or agent-facing technical docs.

**Design vs Design Session**:
A **Design** is the agroecological plan. A **Design Session** is the active app runtime context around that design, including lifecycle and persistence behavior.

**Problem Report vs Diagnostic Bundle**:
A **Problem Report** is the user's account of what went wrong. A **Diagnostic Bundle** is optional supporting evidence the user can attach or share.

**Report Summary vs Diagnostic Bundle**:
A **Report Summary** is readable text for the support conversation. A **Diagnostic Bundle** is the attached evidence package.

**Species vs Plant**:
Use **Species** for catalog/database entries. Use **Placed Plant** for a species instance positioned in a design.

**Species Catalog vs Plant Database**:
Use **Species Catalog** in domain language. "Plant database" is acceptable in broad product copy, but it should not be the canonical term in domain docs.

**Species Catalog vs Species Catalog Workbench**:
The **Species Catalog** is the collection of Species data. The **Species Catalog Workbench** is the interaction surface used to browse, filter, favorite, select, and inspect that data.

**Species Catalog Filter vs SQL Column**:
A **Species Catalog Filter** describes user-facing search behavior. A SQL column is only one possible implementation detail behind that behavior.

**Species Catalog Read Projection vs Site Adaptation**:
A **Species Catalog Read Projection** reports Species Catalog facts in a caller-oriented shape. **Site Adaptation** interprets those facts for a target site, such as hardiness compatibility and replacement suggestion response shape.

**Canonical Name vs Scientific Name**:
Use **Canonical Name** for species identity in Canopi. "Scientific name" may be used in explanatory copy, but it is not the canonical identity term.

**Zone vs Shape**:
Use **Zone** when the drawn area has design meaning. Use "shape" only for implementation or geometry discussions.

**Zone vs Polygonal Zone**:
A **Polygonal Zone** is a kind of **Zone** with an edge-based boundary. Use "polygon" only for implementation or geometry discussions.

**Ellipse vs Oval**:
Use **Elliptical Zone** for zones with elliptical boundaries. "Oval" is acceptable in casual conversation, but it is not the canonical domain term.

**Zone Edge vs Line**:
A **Zone Edge** is part of a zone boundary. A line is an independently drawn design object or implementation geometry, not the canonical term for a polygon side.

**Zone Measurement vs Annotation**:
A **Zone Measurement** is derived from a zone's geometry. An **Annotation** is authored text in the design.

**Canvas Object vs Design Object**:
Use **Design Object** for a spatial part of a Design. "Canvas object" is implementation language and should not be the canonical product term.

**Layer Lock vs Design Object Lock**:
A **Layer** lock prevents editing every design object in that layer. A **Design Object Lock** prevents editing one design object and is saved with the design.

**Climate Zone vs Hardiness Zone**:
Use **Climate Zone** for broad site/template classification. Use **Hardiness Zone** for species cold-tolerance compatibility.

**Target vs Selection**:
A **Target** names what a planning entry refers to. A selection is a temporary user interaction state and should not be used as domain language for planning relationships.

**Target vs Target Presentation**:
A **Target** is the stored or derived subject a planning entry refers to. **Target Presentation** is runtime hover/selection state over targets and must not become the authority for planning entries or canvas selection.

**Scene Edit vs Design Mutation**:
A **Scene Edit** changes canvas-owned design state and should be handled by the canvas runtime. A Design mutation changes non-canvas design state such as budget items, timeline actions, consortiums, location, description, or extra fields.

**Location vs Location Workbench**:
A **Location** is the saved site in a Design. The **Location Workbench** is the interaction surface that edits and presents that saved site.

**Planning Projection vs Design Authority**:
A **Planning Projection** is derived runtime state for planning surfaces. It must not become the authority for Design planning entries, placed plants, or canvas scene state.

**Budget Item vs Budget Item Workbench**:
A **Budget Item** is a cost entry in a Design. The **Budget Item Workbench** is the interaction surface that edits, exports, and presents budget item behavior.

**Consortium vs Guild**:
Use **Consortium** for Canopi's broader stratified, time-aware plant assembly. Use "guild" only in explanatory copy when discussing narrower companion-planting concepts.

**Plant Stamp vs Object Stamp**:
A **Plant Stamp** places placed plants from a chosen species. An **Object Stamp** copies an existing design object already in the design.

**Plant Stamp vs Plant Stamp Source**:
A **Plant Stamp** is the placement interaction. A **Plant Stamp Source** is the runtime Species-derived source the interaction uses to create placed plants.

**Object Stamp vs Plant Spacing**:
An **Object Stamp** places one copy at a time from a sampled design object. **Plant Spacing** repeats a sampled placed plant along a spacing guide at a chosen interval.

**Spacing Guide vs Design Object**:
A **Spacing Guide** is temporary interaction guidance for plant spacing. A **Design Object** is part of the design.

**Plant Spacing Interval vs Canopy Spread**:
A **Plant Spacing Interval** positions plant centers. Canopy spread describes a plant's visible or biological size.

**Stratum vs Layer**:
Use **Stratum** for vertical ecological position in a consortium. Use **Layer** for design-object visibility and locking.

**Succession Phase vs Timeline Action**:
A **Succession Phase** describes a period in ecological development. A **Timeline Action** is scheduled work in the design.

**Consortium Time Model vs Renderer Geometry**:
The **Consortium Time Model** owns Succession Phase and Stratum order, labels, durations, defaults, and clamping. Renderer geometry owns pixel layout and drawing only.

**Timeline Action vs Timeline Action Workbench**:
A **Timeline Action** is the scheduled work in the Design. The **Timeline Action Workbench** is the interaction surface used to create, edit, delete, and select those actions.

**Site Adaptation vs Template Adaptation**:
Use **Site Adaptation** for the domain concept of fitting a design to a site. "Template adaptation" is acceptable only when discussing the specific import workflow.

**Compatibility Check vs Health Check**:
A **Compatibility Check** evaluates species fit for a site. A health check evaluates whether an app subsystem is available.

## Example Dialogue

Designer: "I want to create a design for a small food forest."

Developer: "That design can include placed plants, zones, timeline actions, budget items, consortium planning, and location details."

Designer: "Can I add the same species more than once?"

Developer: "Yes. Each copy is a separate placed plant, and each placed plant refers back to the same species."

Designer: "Does editing the species catalog change my design?"

Developer: "No. The species catalog is the source for choosing species; the design contains placed plants that refer to species."

Designer: "The app behaved strangely. Should I send the logs?"

Developer: "Create a problem report first. It gives you a report summary to copy and, if you choose, a diagnostic bundle with troubleshooting evidence."

Designer: "Can I identify a species by its common name?"

Developer: "You can search and display common names, but the species identity is its canonical name."

Designer: "Is the species search panel the Species Catalog?"

Developer: "The panel is the Species Catalog Workbench. It helps you browse and inspect the Species Catalog."

Designer: "Is the orchard area a zone or a layer?"

Developer: "It is a zone. A layer controls visibility and locking; the zone is the meaningful area in the design."

Designer: "Can I stamp this existing apple tree several more times?"

Developer: "Yes. Use Object Stamp to sample that placed plant, then place copies. Use Plant Stamp when you are starting from a species in the Species Catalog."

Designer: "Can I repeat this apple tree every three meters along this row?"

Developer: "Yes. Use Plant Spacing to sample the placed plant, draw a spacing guide, and choose the interval."

Designer: "Will that spacing guide stay in my design?"

Developer: "No. The spacing guide is temporary; the design receives the generated placed plants."

Designer: "Does three meter spacing mean three meters between canopies or plant centers?"

Developer: "It means three meters center-to-center between placed plants."

Designer: "If I hide a layer, is that just a UI toggle?"

Developer: "Layer visibility is canvas-owned design state. Changing it is a scene edit, so it belongs with canvas undo, dirty state, and save behavior."

Designer: "Can I search for an address and keep the site's altitude?"

Developer: "Yes. The location workbench handles the search result, saved location, and altitude preservation while the design stores only the location."

Designer: "Can a timeline action apply to every apple tree in the design?"

Developer: "Yes. The timeline action can target the apple species, which resolves to the placed plants of that species in the design."

Designer: "Why does the budget update when I add another apple tree?"

Developer: "The budget view uses the planning projection, which derives budget rows from placed plants and budget items without becoming the source of truth for either."

Designer: "Is setting a plant price part of the planning projection?"

Developer: "No. The budget item workbench edits budget items. The planning projection only derives rows from those budget items and placed plants."

Designer: "Is the high canopy row a layer?"

Developer: "No. In the consortium it is a stratum. Layers control design-object visibility and locking."

Designer: "If a template includes a species outside my hardiness zone, does Canopi replace it?"

Developer: "No. Site adaptation shows the compatibility check and may offer replacement suggestions, but the designer chooses whether to replace the species."

Designer: "Is the template's climate zone the same as a species hardiness zone?"

Developer: "No. The climate zone describes the site or template broadly; the hardiness zone is used for species compatibility."
