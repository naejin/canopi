import { useCallback } from 'preact/hooks'
import { t } from '../../i18n'
import { locale } from '../../state/app'
import {
  layerVisibility,
  layerLockState,
  layerPanelOpen,
  activeLayerName,
} from '../../state/canvas'
import styles from './LayerPanel.module.css'

// Display order: top of stack first (annotations renders over everything)
const LAYER_ORDER = [
  'annotations',
  'plants',
  'water',
  'zones',
  'climate',
  'contours',
  'base',
] as const

type LayerName = typeof LAYER_ORDER[number]

// SVG icon components — inline to avoid an extra icon file dependency

function EyeOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  )
}

function EyeClosedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M2 2L14 14M6.5 6.7C6.2 7 6 7.5 6 8C6 9.1 6.9 10 8 10C8.5 10 8.97 9.82 9.3 9.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4.2 4.4C2.8 5.4 1.8 6.8 1 8C1 8 3.5 13 8 13C9.4 13 10.6 12.6 11.6 12"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M7 3.1C7.3 3.03 7.65 3 8 3C12.5 3 15 8 15 8C14.6 8.8 14.1 9.6 13.5 10.3"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockClosedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5 7V5C5 3.3 11 3.3 11 5V7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LockOpenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M5 7V5C5 3.3 8.5 2.5 10.5 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface LayerRowProps {
  name: LayerName
}

function LayerRow({ name }: LayerRowProps) {
  // Read signal values — component re-renders when any of these change
  const visible = layerVisibility.value[name] ?? true
  const locked = layerLockState.value[name] ?? false
  const isActive = activeLayerName.value === name

  const handleVisibilityToggle = useCallback(() => {
    const current = { ...layerVisibility.value }
    current[name] = !current[name]
    layerVisibility.value = current
  }, [name])

  const handleLockToggle = useCallback(() => {
    const current = { ...layerLockState.value }
    current[name] = !current[name]
    layerLockState.value = current
  }, [name])

  const handleSetActive = useCallback(() => {
    activeLayerName.value = name
  }, [name])

  const layerLabel = t(`canvas.layers.${name}`)
  const visLabel = t('canvas.layers.visibility')
  const lockLabel = t('canvas.layers.lock')

  return (
    <div
      className={styles.layerRow}
      role="listitem"
      data-active={isActive ? 'true' : 'false'}
      data-hidden={!visible ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.toggleBtn}
        aria-pressed={visible}
        aria-label={`${visLabel}: ${layerLabel}`}
        onClick={handleVisibilityToggle}
        title={visLabel}
      >
        {visible
          ? <EyeOpenIcon className={styles.icon} />
          : <EyeClosedIcon className={styles.icon} />}
      </button>

      <button
        type="button"
        className={styles.toggleBtn}
        aria-pressed={locked}
        aria-label={`${lockLabel}: ${layerLabel}`}
        onClick={handleLockToggle}
        title={lockLabel}
      >
        {locked
          ? <LockClosedIcon className={styles.icon} />
          : <LockOpenIcon className={styles.icon} />}
      </button>

      <span
        className={styles.layerName}
        role="button"
        tabIndex={0}
        aria-current={isActive ? 'true' : 'false'}
        aria-label={isActive ? `${layerLabel} (active)` : layerLabel}
        onClick={handleSetActive}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleSetActive()
          }
        }}
      >
        {layerLabel}
      </span>
    </div>
  )
}

export function LayerPanel() {
  // Subscribe to locale so labels re-render on language change
  void locale.value

  const isOpen = layerPanelOpen.value

  const togglePanel = useCallback(() => {
    layerPanelOpen.value = !layerPanelOpen.value
  }, [])

  const panelLabel = t('canvas.layers.layerPanel')

  if (!isOpen) {
    return (
      <div className={styles.panelCollapsed}>
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={panelLabel}
          aria-expanded={false}
          onClick={togglePanel}
          title={panelLabel}
        >
          <ChevronLeftIcon />
        </button>
      </div>
    )
  }

  return (
    <div
      className={styles.panel}
      role="list"
      aria-label={panelLabel}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>{panelLabel}</span>
        <button
          type="button"
          className={styles.collapseBtn}
          aria-label={t('canvas.layers.collapse')}
          aria-expanded={true}
          onClick={togglePanel}
          title={t('canvas.layers.collapse')}
        >
          <ChevronRightIcon />
        </button>
      </div>

      {LAYER_ORDER.map((name) => (
        <LayerRow key={name} name={name} />
      ))}
    </div>
  )
}
