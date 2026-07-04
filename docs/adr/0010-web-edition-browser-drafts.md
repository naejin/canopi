# Web Edition Browser Drafts

The lightweight web edition should support browser-local Design drafts and autosave instead of relying only on explicit `.canopi` import/export. Browser draft storage should be treated as a convenience recovery layer for the current browser profile, while explicit `.canopi` download/export remains the durable portable save path.

**Consequences**:
Web Design Session persistence should use a browser storage adapter, likely IndexedDB, behind the same document lifecycle and save-composition seams used by desktop. The web edition should make the difference between local browser drafts and downloaded `.canopi` files clear, and it should not depend on Cloudflare Pages or any backend service to store user Designs.
