# Preserve Shaped Zones During Rotation

When users rotate selected Design Objects, Rectangular Zones and Elliptical Zones should keep their shape kind with explicit orientation rather than being converted into generic polygonal approximations. This preserves the user's shape intent, keeps shape-specific editing and measurements meaningful, and avoids a destructive geometry conversion caused by a transform gesture.

**Consequences**:
The zone model, rendering, hit testing, measurements, and file compatibility need to support oriented Rectangular Zones and Elliptical Zones instead of assuming those zone kinds are axis-aligned.
