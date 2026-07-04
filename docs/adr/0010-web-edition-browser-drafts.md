# Web Edition Browser Drafts

The lightweight web edition should support browser-local Design drafts and autosave instead of relying only on explicit `.canopi` import/export. The active Web Edition save target is the browser-local draft until the user explicitly downloads or exports a `.canopi` file. Browser draft storage should be treated as a convenience recovery layer for the current browser profile, while explicit `.canopi` download/export remains the durable portable save path. In Web Edition v1, `.canopi` is the only export format.

**Consequences**:
Web Design Session persistence should use a browser storage adapter, likely IndexedDB, behind the same document lifecycle and save-composition seams used by desktop. The web edition should make the difference between the current browser draft and downloaded `.canopi` files clear. Direct save-back to an originally imported file can be a later browser-capability enhancement, but it should not be the v1 foundation. The web edition should not depend on Cloudflare Pages or any backend service to store user Designs.

Web Edition v1 may list browser-local drafts in a simple Drafts list for reopen/resume flows. This list is not the desktop Design Notebook: it has no Notebook Sections, saved filesystem paths, file reveal actions, notebook ordering model, or notebook-style organization.
