# Vegetation analysis: ONF methods and Canopi-authored science in Rust

Status: Accepted (2026-09-26, Canopi v2)

## Context

Designers need to know where the existing trees are and how tall they are, where the canopy opens, how much of the site is covered and how the vertical strata are occupied. [ADR 0011](0011-analyses-provenance-and-stories.md) planned canopy analysis on the GeoLibre CLI lane, with Computree as an optional engine.

The better source is the ONF plugin for Computree (`ct_pluginonf`, https://gitlab.com/computree/ct_pluginonf). It has forestry-grade methods built for airborne LiDAR such as IGN LiDAR HD: canopy gaps (JMM/lidaRtRee), tree tops (sigma-optimised Gaussian maxima with a valley-depth neighbour filter), and DTM, DSM and CHM from points.

- **Upstream state.** The repository is no longer maintained. Most files carry an LGPL-3.0-or-later header; 92, including the tree-top chain, carry none, and there is no LICENSE file. An ONF contact confirmed that Canopi may use the code as it wants.
- **Why not C++.** Every step is bound to Qt, OpenCV and Computree's item model. Extracting it would be a rewrite that still ships Qt and OpenCV on every target. A user-installed Computree is about 500 MB, has no macOS arm64 build and has an unverifiable batch mode.
- **What ONF lacks.** Some needed methods have no public ONF implementation, such as crown segmentation from a CHM.

## Decision

- **Port, don't embed.** Canopi translates a chosen set of ONF methods to Rust in a workspace crate, `vegetation/` (package `canopi-vegetation`).
  - The crate is licensed LGPL-3.0-or-later, keeps ONF's notices and records the permission in `vegetation/NOTICE`.
  - Ported code lives in `src/onf/` and names its upstream file at the pinned commit `229ae44d`. That commit is final; Canopi owns the port.
  - The crate depends on nothing Canopi-specific. It reuses `wblidar`, `wbtopology` and `wbprojection` from the already pinned `opengeos/whitebox-wasm` revision. It uses no OpenCV or Qt.
- **Canopi-authored methods.** Where neither ONF nor GeoLibre offers a public method, Canopi implements a published one in `src/methods/`. Crown segmentation (a seeded watershed) is the first case. Each such method:
  - cites its reference in the module, the recipe and the result details;
  - is specified by its module documentation;
  - is tested against synthetic stands with known answers;
  - is cross-checked against an independent open implementation (lidR or lidaRtRee) in a local lane, with the results checked in as goldens;
  - states its limits to users.
- **Correctness over fidelity.** Upstream defects are fixed in the port, each with its own test and a line in the guide:
  - no-data values entering blurs and filters;
  - tree tops taken from the wrong sigma;
  - heights over DTM holes;
  - self-touching polygons;
  - DSM holes filled with the minimum.

  Fidelity tests compare with Computree only on inputs where the two agree.
- **Native lane.** The analysis registry gains a `native` lane. Analyses run in process on the `Local` executor under the heavy-job lease, cancel cooperatively at bounded intervals, and are admitted under a 25-million-cell cap (and point-list caps for point metrics). No new sidecar, child process or CI engine is needed: goldens make fidelity a plain `cargo test`.
- **GeoLibre stays** the engine for slope, hillshade, contours and hydrology. ADR 0011's optional Computree integration is dropped.
- **Scope.** The work is ordered as follows:
  1. Raster canopy from above-ground height: gaps, tree tops, and cover facts.
  2. Point-cloud library items (library-only, with a footprint outline in Layers) and terrain models from points.
  3. Crowns, gap depth, vegetation structure grids for the syntropic strata, and point cleaning.

  Terrestrial scans, stems, voxels and inventory tools are out of scope. ONF defaults ship with "Forest" and "Orchard / agroforestry" presets over the same recipes.

## Consequences

- The crate is the only LGPL code in Canopi. The combined work is conveyed under AGPL-3.0-only. `THIRD_PARTY_NOTICES.md` names the ONF plugin, its commit and the permission, and the notices test checks the pinned revision.
- New library item kinds: point cloud, and vector tree tops, gaps and crowns. Provenance records the engine (`onf` or `canopi`), the method reference and resolved parameters, such as the sigma a recipe chose.
- Detected trees are library data. Turning them into "existing tree" design objects is a later product step through a runtime transaction.
- Validation fixtures include a small IGN LiDAR HD crop (Licence Ouverte Etalab 2.0) with goldens. Reference runs come from Canopi-written `CompuTreeBatch` scripts, with a dev-only harness as a fallback, and from lidR/lidaRtRee; none of them runs in CI or ships.
- Canopy analysis is Desktop-only, like the data library.
