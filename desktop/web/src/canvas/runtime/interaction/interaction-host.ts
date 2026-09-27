import type { CanvasRuntimeTranslator } from '../app-adapter'

/** Attributes the session sets on the map host and restores when it ends. */
const HOST_ATTRIBUTES = ['tabindex', 'role', 'aria-label', 'aria-describedby'] as const

let descriptionSequence = 0

export interface InteractionHostController {
  refreshTranslations(): void
  dispose(): void
}

/**
 * Makes the map host a keyboard stop: in the Tab order, named, and described
 * by its keys, so a keyboard user can reach the tool keys, Shift F10 and the
 * Esc chain. `role="application"` hands every key to the map while it has
 * focus, which is what single-key tools need.
 */
export function prepareInteractionHost(
  container: HTMLElement,
  translate: CanvasRuntimeTranslator,
): InteractionHostController {
  const previous = HOST_ATTRIBUTES.map((name) => [name, container.getAttribute(name)] as const)
  const description = document.createElement('div')
  description.id = `canopi-map-keys-${++descriptionSequence}`
  description.hidden = true
  description.dataset.mapKeysDescription = 'true'

  function refreshTranslations(): void {
    container.setAttribute('aria-label', translate('canvas.map.label'))
    description.textContent = translate('canvas.map.description')
  }

  container.appendChild(description)
  container.tabIndex = 0
  container.setAttribute('role', 'application')
  container.setAttribute('aria-describedby', description.id)
  refreshTranslations()

  return {
    refreshTranslations,
    dispose() {
      description.remove()
      for (const [name, value] of previous) {
        if (value === null) container.removeAttribute(name)
        else container.setAttribute(name, value)
      }
    },
  }
}
