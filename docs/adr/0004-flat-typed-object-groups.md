# Flat Typed Object Groups

Object Groups should be flat, typed collections of concrete Design Objects that may span Plants, Zones, and Annotations Layers. This favors the user's mental model of adding objects into an existing group over nested group structure, removes standalone group Layer/position/rotation authority, and prevents raw member ID collisions between placed plants, zones, and annotations.

**Consequences**:
The shared `.canopi` schema, generated bindings, canvas selection model, hit testing, grouping commands, Object Stamp, copy/paste, locking, and migration behavior need to derive group visibility, editability, geometry, and membership from typed concrete members instead of legacy group-level Layer or transform fields. Legacy raw `member_ids` resolution belongs only to native/Web Design ingestion and is covered by the shared compatibility corpus; ordinary `CanopiFile` deserialization accepts the current typed representation and must not perform hidden migration.
