# Personal Saved Object Stamp Library

Saved Object Stamps are a personal reuse library stored in the user database, not embedded in every `.canopi` Design file. This keeps reusable arrangements separate from a Design's meaning while preserving them across normal app updates; portability comes through explicit import/export of one stamp as a valid `.canopi` file containing only the visible canvas objects needed for that stamp.

**Consequences**:
Stamp import/export must not route through Design Session open/save flows, must not update Recent Designs, and must not include design-level state such as Location, Budget, Timeline, Consortiums, or hidden object metadata.
