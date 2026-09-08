# Web Edition uses compile-time platform adapters

Status: Accepted

Desktop and Web Edition select platform adapters through separate build entries and compile-time aliases. Shared modules consume caller-shaped interfaces for document persistence, settings, personal app data, Species Catalog reads, shell commands, and file operations. Runtime environment branches would obscure dependencies and make native code easier to bundle accidentally into the browser; build checks therefore reject desktop imports in Web chunks.

Platform-neutral Design Session behavior, canvas runtime, Workbench logic, command identity, and `.canopi` semantics remain shared. Composition roots supply explicit edition capabilities, while shared factories own common policy. Shells render projected commands rather than recreating dispatch logic or advertising unavailable native actions.

Current module ownership and alias details live in the [frontend](../agent/frontend-patterns.md), [canvas runtime](../agent/canvas-runtime.md), and [document lifecycle](../agent/document-lifecycle.md) guides. Keep the split at adapter and shell edges rather than forking shared workflows.
