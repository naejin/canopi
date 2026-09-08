# Web Edition ships as a static app bundle

Status: Accepted

The Canopi repository owns the Web Edition source and standalone Vite build. Website and deployment repositories consume its versioned static artifact rather than importing app source, components, or a workspace package. This keeps the browser app independent of the marketing website and compatible with static hosting without a backend runtime.

The artifact manifest records app version, commit, base path, asset inventory, and SHA-256 checksums so a deploy can verify exactly what it publishes. Versioned public Canopi release assets remain the intended production distribution path, with normal release retention; transient CI artifacts and sibling-checkout copies serve debugging and development. Generated app assets stay out of the website's source history.

The production target is the dedicated `web.projectcanopi.com` host with a root-base artifact. The `/app/` artifact remains supported for subpath hosting. Current package commands and deployment instructions live in the [website integration guide](../agent/web-edition-website-integration.md). The desktop release-candidate and promotion workflows do not currently package or publish Web archives automatically; public release-asset distribution requires an explicit Web packaging/publication step.
