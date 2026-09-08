# Web Edition omits Site Adaptation in v1

Status: Accepted

Web Edition v1 excludes Site Adaptation, compatibility checks, and replacement suggestions. Static Design Templates import as Designs without an adaptation review. The retired adaptation implementation required hardiness data for compatibility and additional height/stratum metadata for replacements; exporting those fields would expand the deliberately reduced Web Species Catalog.

[ADR 0023](0023-retire-dormant-site-adaptation.md) subsequently retired the dormant implementation across both editions. Restoring adaptation requires an explicit product and architecture decision, including the data scope and query costs for any browser implementation.
