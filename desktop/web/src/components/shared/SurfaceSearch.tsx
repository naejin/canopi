import { useRef } from 'preact/hooks'
import { t } from '../../i18n'
import styles from './SurfaceSearch.module.css'

export function SurfaceSearch({ value, onChange, label }: { value: string; onChange(value: string): void; label: string }) {
  const input = useRef<HTMLInputElement>(null)
  return <div className={styles.search}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4.5" /><path d="m10 10 4 4" /></svg>
    <input ref={input} type="search" value={value} aria-label={label} placeholder={label}
      onInput={event => onChange(event.currentTarget.value)} />
    {value && <button type="button" aria-label={t('speciesKey.clearSearch')} onClick={() => { onChange(''); input.current?.focus() }}>×</button>}
  </div>
}
