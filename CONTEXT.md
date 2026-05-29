# Canopi Design Domain

Canopi helps people create agroecological designs for permaculture, syntropic agriculture, and food forests. This glossary defines the product's domain language, independent of storage format, UI components, or implementation details.

## Language

**Design**:
An agroecological plan that combines plants, spatial layout, scheduling, budget, consortium planning, and site information. A design may be saved as a `.canopi` file, but "design" is the user-facing domain term.
_Avoid_: Document, file, project

**Design Session**:
The active runtime context for a Design in the app. A design session includes the current Design state, dirty baselines, save/autosave behavior, queued Design loads, lifecycle workflows, and an optional attached canvas runtime.
_Avoid_: Document session, file session, canvas session

**Species**:
A botanical catalog entry that describes a plant taxon and its ecological, morphological, agronomic, risk, use, and media data. A species is identified by its canonical name and may have common names.
_Avoid_: Plant, catalog plant, database plant

**Species Catalog**:
The searchable collection of species and their supporting data used when selecting plants for a design. Species in the catalog are not part of a design until they become placed plants.
_Avoid_: Plant catalog, plant database

**Species Catalog Filter**:
A search criterion that narrows Species Catalog results by Species attributes such as climate fit, growth form, ecological role, risk, use, or morphology. A species catalog filter is user-facing behavior even when its implementation is backed by generated metadata, SQL columns, related tables, or bespoke predicates.
_Avoid_: Plant filter, SQL filter, column filter

**Canonical Name**:
The normalized name Canopi uses to identify a species. A species has one canonical name in Canopi, even when it has synonyms or multiple common names.
_Avoid_: Scientific name, Latin name, species name

**Common Name**:
A local or everyday name for a species. A species may have many common names, and common names are display aids rather than stable identifiers.
_Avoid_: Species identifier, primary key

**Placed Plant**:
An instance of a species positioned inside a design. Multiple placed plants may refer to the same species.
_Avoid_: Species, plant record, catalog item

**Zone**:
A named area in a design, optionally typed by ecological or functional purpose. A design may contain many zones, and zones may overlap placed plants or other zones.
_Avoid_: Shape, polygon, region

**Annotation**:
A text note positioned in a design. An annotation explains or labels part of the design without becoming a zone, placed plant, or timeline action.
_Avoid_: Label, comment

**Layer**:
A visibility and locking group for design objects. A design has many layers, and each layer controls whether its objects are visible, locked, and how opaque they appear.
_Avoid_: Category, folder

**Object Group**:
A named or unnamed collection of design objects that move or transform together. An object group may contain placed plants, zones, annotations, or other design objects.
_Avoid_: Layer, selection

**Location**:
The real-world site associated with a design, expressed as latitude, longitude, and optionally altitude. A design has zero or one location.
_Avoid_: Map pin, address

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

**Budget Item**:
A cost entry in a design. A budget item may refer to a species, placed plant, zone, or manual line item and contributes to the design's budget.
_Avoid_: Price, estimate row

**Target**:
The design subject that a timeline action, budget item, or other planning entry refers to. A target may identify a species, a placed plant, a zone, or a manual entry.
_Avoid_: Panel target, link, reference

**Planning Projection**:
A runtime read model that combines Design planning entries, placed plants, localized species names, and targets for planning surfaces such as timeline, budget, and consortium views. A planning projection does not own Design data or canvas scene data; it only derives view-ready planning rows and target presentation state from those authorities.
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

**Species vs Plant**:
Use **Species** for catalog/database entries. Use **Placed Plant** for a species instance positioned in a design.

**Species Catalog vs Plant Database**:
Use **Species Catalog** in domain language. "Plant database" is acceptable in broad product copy, but it should not be the canonical term in domain docs.

**Species Catalog Filter vs SQL Column**:
A **Species Catalog Filter** describes user-facing search behavior. A SQL column is only one possible implementation detail behind that behavior.

**Canonical Name vs Scientific Name**:
Use **Canonical Name** for species identity in Canopi. "Scientific name" may be used in explanatory copy, but it is not the canonical identity term.

**Zone vs Shape**:
Use **Zone** when the drawn area has design meaning. Use "shape" only for implementation or geometry discussions.

**Climate Zone vs Hardiness Zone**:
Use **Climate Zone** for broad site/template classification. Use **Hardiness Zone** for species cold-tolerance compatibility.

**Target vs Selection**:
A **Target** names what a planning entry refers to. A selection is a temporary user interaction state and should not be used as domain language for planning relationships.

**Planning Projection vs Design Authority**:
A **Planning Projection** is derived runtime state for planning surfaces. It must not become the authority for Design planning entries, placed plants, or canvas scene state.

**Consortium vs Guild**:
Use **Consortium** for Canopi's broader stratified, time-aware plant assembly. Use "guild" only in explanatory copy when discussing narrower companion-planting concepts.

**Stratum vs Layer**:
Use **Stratum** for vertical ecological position in a consortium. Use **Layer** for design-object visibility and locking.

**Succession Phase vs Timeline Action**:
A **Succession Phase** describes a period in ecological development. A **Timeline Action** is scheduled work in the design.

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

Designer: "Can I identify a species by its common name?"

Developer: "You can search and display common names, but the species identity is its canonical name."

Designer: "Is the orchard area a zone or a layer?"

Developer: "It is a zone. A layer controls visibility and locking; the zone is the meaningful area in the design."

Designer: "Can a timeline action apply to every apple tree in the design?"

Developer: "Yes. The timeline action can target the apple species, which resolves to the placed plants of that species in the design."

Designer: "Why does the budget update when I add another apple tree?"

Developer: "The budget view uses the planning projection, which derives budget rows from placed plants and budget items without becoming the source of truth for either."

Designer: "Is the high canopy row a layer?"

Developer: "No. In the consortium it is a stratum. Layers control design-object visibility and locking."

Designer: "If a template includes a species outside my hardiness zone, does Canopi replace it?"

Developer: "No. Site adaptation shows the compatibility check and may offer replacement suggestions, but the designer chooses whether to replace the species."

Designer: "Is the template's climate zone the same as a species hardiness zone?"

Developer: "No. The climate zone describes the site or template broadly; the hardiness zone is used for species compatibility."
