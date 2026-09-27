import { toolCardContent, type SavedStampSummary } from '../../app/tool-card/content'
import { siteLocateOpen } from '../../app/site-onboarding/state'
import { selectPanel } from '../../app/shell/state'
import { readPlantStampSource } from '../../canvas/plant-stamp-source'
import {
  readSavedObjectStampName,
  readSavedObjectStampSource,
} from '../../canvas/saved-object-stamp-source'
import {
  currentCanvasQuerySurface,
  currentCanvasTool,
  currentCanvasToolGuidance,
} from '../../canvas/session'
import { t } from '../../i18n'
import styles from './ToolCard.module.css'

/**
 * The tool card, top left beside the tool rail: the tool's name, the live
 * instruction (naming the chosen species or stamp) and quiet key hints that
 * end with what Esc does now. It hides for Select and Pan, in overview and
 * while "Where is your site?" shows. The text is one polite live region that
 * stays mounted, so choosing a tool is announced.
 */
export function ToolCard() {
  const tool = currentCanvasTool.value
  const guidance = currentCanvasToolGuidance.value
  const source = readPlantStampSource()
  const savedStamp = readSavedStampSummary()
  const overview = currentCanvasQuerySurface.value?.viewport.value.mode === 'overview'
  const content = siteLocateOpen.value || overview
    ? null
    : toolCardContent({
        tool,
        guidance,
        speciesName: source ? source.common_name ?? source.canonical_name : null,
        savedStamp,
        translate: t,
      })

  return (
    <section
      className={content ? styles.card : styles.idle}
      data-tool-card={content?.tool}
      aria-label={content?.title}
    >
      {/* First in the DOM so the title and instruction wrap around it. */}
      {content?.changeSpecies && (
        <button type="button" className={styles.link} onClick={() => selectPanel('plant-db')}>
          {t('canvas.toolCard.changeSpecies')}
        </button>
      )}
      <div role="status" aria-live="polite">
        {content && (
          <>
            <span className={styles.title}>{content.title}</span>
            <span className={styles.instruction}>
              {content.subject && <><b className={styles.subject}>{content.subject}</b>{' · '}</>}
              {content.instruction}
            </span>
            <span className={styles.hints}>{content.hints}</span>
          </>
        )}
      </div>
    </section>
  )
}

function readSavedStampSummary(): SavedStampSummary | null {
  const payload = readSavedObjectStampSource()
  if (!payload) return null
  return {
    name: readSavedObjectStampName(),
    plants: payload.plants.length,
    species: new Set(payload.plants.map((plant) => plant.canonicalName)).size,
  }
}
