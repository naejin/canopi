# Design Notebook user DB library

The Design Notebook is a personal organizing library stored in the user database, not a filesystem folder browser and not part of `.canopi` Design content. It stores saved Design references, section membership, and manual ordering so users can switch between Designs quickly while each saved `.canopi` file remains the authority for Design content and Design name.

**Consequences**:
Notebook switching must route through the normal Design Session replacement flow, notebook entries must reference saved Design locations only, missing-path handling should match Recent Designs, and v1 should use one-section membership in a single sectioned ledger instead of folder scanning, pinned/automatic notebook views, or many-to-many tags.
