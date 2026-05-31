# Local Diagnostic Bundles for Problem Reports

Canopi problem reporting should produce a local Diagnostic Bundle that the user chooses how to share, rather than automatically uploading logs or telemetry from the app. This preserves the local-first privacy boundary around Designs, Locations, and filesystem context while still giving support enough structured evidence to investigate reproducible failures.

**Consequences**:
Users need one extra manual sharing step, and server-side crash aggregation is out of scope until the product deliberately revisits consent, hosting, retention, and data minimization.
