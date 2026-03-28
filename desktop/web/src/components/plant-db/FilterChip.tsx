import styles from './FilterChip.module.css'

interface FilterChipProps {
  label: string;
  color?: string;        // CSS variable name like '--color-nitrogen'
  active?: boolean;       // filled state (for selection chips)
  onDismiss?: () => void; // shows (x) button when provided
  onClick?: () => void;   // for toggle/selection behavior
}

export function FilterChip({ label, color, active, onDismiss, onClick }: FilterChipProps) {
  const style = color ? {
    '--chip-color': `var(${color})`,
    '--chip-bg': `color-mix(in srgb, var(${color}) 12%, transparent)`,
  } as Record<string, string> : undefined;

  return (
    <span
      className={`${styles.chip} ${active ? styles.chipActive : ''} ${onClick ? styles.chipClickable : ''}`}
      style={style}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <span className={styles.chipLabel}>{label}</span>
      {onDismiss && (
        <button
          type="button"
          className={styles.chipDismiss}
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          aria-label={`Remove ${label}`}
          tabIndex={-1}
        >
          ×
        </button>
      )}
    </span>
  );
}
