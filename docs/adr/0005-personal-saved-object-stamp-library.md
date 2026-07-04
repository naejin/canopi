# Personal Saved Object Stamp Library

Saved Object Stamps are a personal reuse library, not embedded in every `.canopi` Design file. The desktop app stores this library in the user database; the Web Edition v1 may store it as browser-local app data per ADR 0014. This keeps reusable arrangements separate from a Design's meaning while preserving them across normal app updates in the native app. Desktop portability comes through explicit import/export of one stamp as a valid `.canopi` file containing only the visible canvas objects needed for that stamp. Web Edition v1 keeps Saved Object Stamps browser-local only and does not expose stamp import/export.

**Consequences**:
Desktop stamp import/export must not route through Design Session open/save flows, must not update Recent Designs, and must not include design-level state such as Location, Budget, Timeline, Consortiums, or hidden object metadata. Web Edition v1 should not expose Saved Object Stamp import/export unless a later portability decision expands Web exports beyond `.canopi` Design download/export.
