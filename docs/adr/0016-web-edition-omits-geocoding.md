# Web Edition omits visible Location editing in v1

Status: Accepted

The Web Edition v1 does not expose a visible Location Workbench, Design Location panel, coordinate form, address search, geocoding, map picking, or altitude editing. Loaded `.canopi` files may still contain a saved Location, and Web Edition should preserve that document data through normal open/edit/export flows unless a future explicit Web Location editing decision changes the scope.

The desktop app currently performs geocoding through a native command. A public static web app would need to call a third-party geocoding service directly from the browser or add a backend/proxy. Direct use of public Nominatim is a poor v1 fit because the service has application-wide rate limits, forbids autocomplete-style use, requires clear attribution and identification, and recommends proxying/caching plus the ability to switch service. Adding a backend conflicts with the static Cloudflare Pages constraint.

Coordinate-only editing was also removed from the Web v1 scope because users expect the same desktop UX shape, and a partial Location surface would imply missing map/geocoding behavior. Location editing can be reconsidered later with a complete provider and UX plan that covers attribution, caching, rate limits, privacy, service-switching behavior, coordinate entry, map picking, and altitude semantics.
