# Web Edition Uses Design Format

Canopi's lightweight web edition will create, open, edit, and export real Canopi Designs rather than introducing a separate web sketch format. Unsupported web-edition sections such as Timeline, Budget, Consortiums, or native app libraries should be omitted from the web UI while preserving loaded Design data where possible and emitting valid `.canopi` files with required unsupported sections empty when the web edition creates a new Design.

**Consequences**:
The web edition remains interoperable with the desktop app and uses the same Design, Placed Plant, Zone, Annotation, Layer, Measurement Guide, and Species Catalog language. Web storage and file handling may differ from desktop, but browser adapters must feed the normal Design Session and save-composition seams instead of bypassing them with a parallel document model.
