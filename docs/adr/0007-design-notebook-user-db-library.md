# Design Notebook personal library

The Design Notebook is a personal organizing library, not a filesystem folder browser and not part of `.canopi` Design content. The desktop app stores this library in the user database. It stores saved Design references, section membership, and manual ordering so users can switch between Designs quickly while each saved `.canopi` file remains the authority for Design content and Design name.

Web Edition v1 does not include the Design Notebook. It may expose a simple browser-local Drafts list for reopening Designs stored in the current browser profile, but that list must not use Notebook Sections, saved path references, file reveal actions, or notebook-style organization. See ADR 0010 and ADR 0014.

**Consequences**:
Desktop notebook switching must route through the normal Design Session replacement flow, notebook entries must reference saved Design locations only, missing-path handling should match Recent Designs, and v1 should use one-section membership in a single sectioned ledger instead of folder scanning, pinned/automatic notebook views, or many-to-many tags.
