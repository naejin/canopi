# Web Edition omits address geocoding in v1

Status: Accepted

The Web Edition v1 keeps Location editing through manual latitude/longitude entry and map click or pin placement, but does not include address search or geocoding.

The desktop app currently performs geocoding through a native command. A public static web app would need to call a third-party geocoding service directly from the browser or add a backend/proxy. Direct use of public Nominatim is a poor v1 fit because the service has application-wide rate limits, forbids autocomplete-style use, requires clear attribution and identification, and recommends proxying/caching plus the ability to switch service. Adding a backend conflicts with the static Cloudflare Pages constraint.

Address search can be reconsidered later with a provider plan that supports public-browser credentials or an intentional backend/proxy decision, including attribution, caching, rate limits, privacy, and service-switching behavior.
