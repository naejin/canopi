# Retire dormant Site Adaptation

Status: Accepted

Canopi should retire the dormant Site Adaptation implementation for now. Current Design Template import opens templates as Designs through the normal Design Session template-open flow, and Web Edition v1 explicitly omits Site Adaptation, Compatibility Checks, and Replacement Suggestions. Keeping an unmounted implementation suggests a hidden review step that the current product does not offer.

Desktop and Web Edition Design Template imports should remain as-is imports unless a future decision reintroduces Site Adaptation as a real Design workflow. A future Site Adaptation decision must define the mounted desktop workflow, the user choice model for replacements, the Species Catalog read fields it requires, and whether Web Edition expands its reduced catalog beyond the fields allowed by ADR 0008 and ADR 0018.

This decision does not reject Site Adaptation permanently. It records that dormant code should not remain as speculative architecture. Reintroducing Site Adaptation should happen through a new product and architecture decision, with behavior-level tests at the Design Template import workflow seam.
