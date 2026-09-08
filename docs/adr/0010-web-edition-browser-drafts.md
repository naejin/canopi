# Web Edition Browser Drafts

The lightweight web edition should support browser-local Design drafts and autosave instead of relying only on explicit `.canopi` import/export. The active Web Edition save target is the browser-local draft until the user explicitly downloads or exports a `.canopi` file. Browser draft storage should be treated as a convenience recovery layer for the current browser profile, while explicit `.canopi` download/export remains the durable portable save path. The planned Canvas PDF export in [ADR 0024](0024-shared-canvas-pdf-export.md) adds a sharing and printing artifact without changing this persistence boundary.

**Consequences**:
Web Design Session persistence uses the browser-local app-data adapter described in [ADR 0014](0014-web-edition-browser-local-app-data.md), behind the shared document lifecycle and save-composition seams. The web edition should make the difference between the current browser draft and downloaded `.canopi` files clear. Direct save-back to an originally imported file can be a later browser-capability enhancement, but it should not be the v1 foundation. The web edition should not depend on Cloudflare Pages or any backend service to store user Designs.

Web Edition v1 does not expose a visible Drafts list or command. Browser Drafts remain internal autosave/recovery state and are not the desktop Design Notebook: they have no Notebook Sections, saved filesystem paths, file reveal actions, notebook ordering model, or notebook-style organization.
