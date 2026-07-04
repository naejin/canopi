# Web Edition ships as a static app bundle

Status: Accepted

The Web Edition should be built from the Canopi app repository as a standalone static app bundle that the Canopi website can publish under a route such as `/app/`. The website should not import the Web Edition as an internal UI component package for v1, and the Web Edition should not require a separate backend or server runtime.

The Canopi repository should own the Web Edition source, likely as a second Vite entry/build that reuses shared frontend modules while swapping the desktop shell and platform adapters for browser-specific ones. The website should publish the built artifact only, not consume app source through a workspace dependency, package import, submodule, or copied component tree.

The built Web Edition should move to `canopi-website` as a versioned build artifact during deployment. The website repository should not commit generated `/app` assets long term. Local development may use a script that copies the Web Edition build from a sibling Canopi checkout into the website output tree, but that copy is a local/dev handoff, not the source-of-truth distribution model.

This keeps the Canopi app build independent from the marketing/documentation website build while still fitting static hosting on Cloudflare Pages. The Web Edition can own its Preact, Pixi, DuckDB-WASM worker, reduced catalog assets, adapter checks, and `/app/` base-path constraints without forcing those details into the Astro website. A deeper package/component integration can be reconsidered later if the two builds converge for a concrete reason.
