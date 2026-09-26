import { useEffect, useId, useMemo, useRef, useState } from 'preact/hooks'
import {
  ANALYSIS_GROUPS,
  ANALYSIS_REGISTRY,
  type AnalysisEntry,
  type AnalysisGroup,
  type AnalysisParamSpec,
} from '../../../generated/analysis-registry'
import type { AnalysisRequest } from '../../../generated/contracts'
import {
  analysisOptions,
  buildAnalysisRequest,
  entryAvailability,
  findExistingResult,
  initialForm,
  isParamVisible,
  paramUnitSuffix,
  validateForm,
  type AnalysisContext,
  type AnalysisForm,
  type AnalysisSubject,
  type FormValue,
} from '../../../app/analyses/model'
import { locale } from '../../../app/settings/state'
import { t } from '../../../i18n'
import { Notice } from '../../shared/Notice'
import { Switch } from '../../shared/Switch'
import { paramErrorText, unavailableText } from './analysis-text'
import styles from './analyze-dialog.module.css'

/**
 * The Analyze dialog, generated from the analysis registry for one item.
 *
 * Every entry is listed; one that cannot run says why by name. The chosen
 * entry's parameters render by type, advanced ones in a disclosure, and a run
 * that would duplicate a result this Design already shows becomes "Show in
 * Layers". The model mirrors native validation for inline errors only.
 */
export function AnalyzeDialog({
  item,
  context,
  attach,
  canAddToDesign,
  initialAnalysisId = null,
  busy,
  error,
  onCancel,
  onRun,
  onShowInLayers,
  onAddExisting,
  registry = ANALYSIS_REGISTRY,
  groups = ANALYSIS_GROUPS,
}: {
  item: AnalysisSubject
  context: AnalysisContext
  /** Whether the results join the current Design when published. */
  attach: boolean
  /** Whether a Design is open to add an existing result to. */
  canAddToDesign: boolean
  initialAnalysisId?: string | null
  busy: boolean
  error: string | null
  onCancel(): void
  onRun(request: AnalysisRequest): void
  onShowInLayers(itemId: string): void
  onAddExisting(itemId: string): void
  registry?: readonly AnalysisEntry[]
  groups?: readonly { readonly key: AnalysisGroup; readonly labelKey: string }[]
}) {
  const language = locale.value
  const titleId = useId()
  const root = useRef<HTMLFormElement>(null)
  const options = useMemo(
    () => analysisOptions(item, context, language, registry, groups),
    [item, context, language, registry, groups],
  )
  const flat = options.flatMap((group) => group.options)
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    flat.find((option) => option.entry.id === initialAnalysisId)?.entry.id
    ?? flat.find((option) => option.unavailable === null)?.entry.id
    ?? flat[0]?.entry.id
    ?? null)
  const [forms, setForms] = useState<Readonly<Record<string, AnalysisForm>>>({})
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set())
  const [attempted, setAttempted] = useState(false)

  useEffect(() => {
    root.current?.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus()
  }, [])

  const entry = flat.find((option) => option.entry.id === selectedId)?.entry ?? null
  const form = entry ? forms[entry.id] ?? initialForm(entry, item.name, t(entry.titleKey), language) : null
  const unavailable = entry && form ? entryAvailability(entry, item, context, form, language) : null
  const blocked = unavailable !== null && unavailable.reason !== 'AlreadyInLayers'
  const validation = entry && form ? validateForm(entry, form, language) : null
  const existing = entry && form ? findExistingResult(entry, item.id, form, context, language) : null

  const update = (next: AnalysisForm) => {
    if (entry) setForms({ ...forms, [entry.id]: next })
  }
  const setValue = (key: string, value: FormValue) => {
    if (!form) return
    update({ ...form, values: { ...form.values, [key]: value } })
    setTouched(new Set([...touched, key]))
  }
  const choose = (id: string) => {
    setSelectedId(id)
    setAttempted(false)
    setTouched(new Set())
  }
  const submit = () => {
    if (!entry || !form || busy || blocked) return
    if (existing?.inDesign) {
      onShowInLayers(existing.id)
      return
    }
    const request = buildAnalysisRequest(entry, item, form, language)
    if (!request) {
      setAttempted(true)
      // Move to the first field that needs attention so the error is announced.
      requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    onRun(request)
  }

  const paramControl = (param: AnalysisParamSpec) => {
    if (!entry || !form || !isParamVisible(entry, form.values, param.key)) return null
    const problem = validation?.params[param.key]
    const shown = problem && (attempted || touched.has(param.key)) ? problem : null
    return (
      <ParamField
        key={param.key}
        param={param}
        value={form.values[param.key] ?? null}
        error={shown ? paramErrorText(shown, language) : null}
        onChange={(value) => setValue(param.key, value)}
      />
    )
  }
  const basic = entry?.params.filter((param) => !param.advanced) ?? []
  const advanced = entry?.params.filter((param) => param.advanced) ?? []
  const listOutputs = entry ? entry.outputs.length > 1 || entry.outputs.some((output) => output.optional) : false

  return (
    <form
      ref={root}
      className={styles.dialog}
      aria-labelledby={titleId}
      noValidate
      onSubmit={(event) => { event.preventDefault(); submit() }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        onCancel()
      }}
    >
      <h3 id={titleId}>{t('analyses.dialog.title', { name: item.name })}</h3>
      {options.map((group) => (
        <fieldset key={group.key} className={styles.entries}>
          <legend>{t(group.labelKey)}</legend>
          {group.options.map((option) => {
            const checked = option.entry.id === selectedId
            const reasonId = `${titleId}-${option.entry.id}-reason`
            return (
              <label key={option.entry.id} className={styles.entry} data-checked={checked} data-unavailable={option.unavailable !== null}>
                <input
                  type="radio"
                  name={`${titleId}-analysis`}
                  checked={checked}
                  data-autofocus={checked ? 'true' : undefined}
                  aria-describedby={option.unavailable ? reasonId : undefined}
                  onChange={() => choose(option.entry.id)}
                />
                <span>
                  <strong>{t(option.entry.titleKey)}</strong>
                  <small>{t(option.entry.summaryKey)}</small>
                  {option.unavailable && (
                    <small id={reasonId} className={styles.reason}>{unavailableText(option.unavailable)}</small>
                  )}
                </span>
              </label>
            )
          })}
        </fieldset>
      ))}

      {entry && form && blocked && unavailable && (
        <Notice tone="warning">{unavailableText(unavailable)}</Notice>
      )}
      {entry && form && !blocked && <>
        {basic.map(paramControl)}
        {advanced.some((param) => isParamVisible(entry, form.values, param.key)) && (
          <details className={styles.advanced}>
            <summary>{t('analyses.dialog.advanced')}</summary>
            <div className={styles.advancedBody}>{advanced.map(paramControl)}</div>
          </details>
        )}
        {listOutputs && (
          <fieldset className={styles.group}>
            <legend>{t('analyses.dialog.outputs')}</legend>
            {entry.outputs.map((output) => (
              <label key={output.key} className={styles.check}>
                <input
                  type="checkbox"
                  checked={!output.optional || form.outputs[output.key] === true}
                  disabled={!output.optional}
                  onChange={(event) => update({ ...form, outputs: { ...form.outputs, [output.key]: event.currentTarget.checked } })}
                />
                {t(output.labelKey)}
              </label>
            ))}
            {validation?.noOutputs && <small className={styles.error} role="alert">{t('analyses.dialog.errors.noOutputs')}</small>}
          </fieldset>
        )}
        <label className={styles.field}>
          <span>{t('analyses.dialog.name')}</span>
          <input value={form.name} onInput={(event) => update({ ...form, name: event.currentTarget.value })} />
        </label>
        {existing?.inDesign
          ? <Notice tone="info">{t('analyses.unavailable.AlreadyInLayers')}</Notice>
          : existing && (
            <Notice
              tone="info"
              action={canAddToDesign
                ? <button type="button" onClick={() => onAddExisting(existing.id)}>{t('analyses.dialog.addExisting')}</button>
                : undefined}
            >
              {t('analyses.dialog.existingInLibrary')}
            </Notice>
          )}
        {!existing?.inDesign && (
          <p className={styles.muted}>{attach ? t('analyses.dialog.attachNote') : t('analyses.dialog.libraryNote')}</p>
        )}
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" onClick={onCancel}>{t('canvas.lidar.library.cancel')}</button>
        {existing?.inDesign
          ? <button type="submit" className={styles.primary}>{t('analyses.dialog.showInLayers')}</button>
          : (
            <button type="submit" className={styles.primary} disabled={busy || !entry || blocked}>
              {existing ? t('analyses.dialog.runAgain') : t('analyses.dialog.run')}
            </button>
          )}
      </div>
    </form>
  )
}

function ParamField({ param, value, error, onChange }: {
  param: AnalysisParamSpec
  value: FormValue
  error: string | null
  onChange(value: FormValue): void
}) {
  const id = useId()
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const help = t(param.helpKey)
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  const kind = param.kind
  const messages = <>
    {help && <small id={helpId} className={styles.help}>{help}</small>}
    {error && <small id={errorId} className={styles.error}>{error}</small>}
  </>
  switch (kind.type) {
    case 'choice':
      return (
        <fieldset className={styles.group} aria-describedby={describedBy}>
          <legend>{t(param.labelKey)}</legend>
          {kind.options.map((option, index) => (
            <label key={option} className={styles.check}>
              <input
                type="radio"
                name={`${id}-${param.key}`}
                checked={value === option}
                aria-invalid={error && index === 0 ? 'true' : undefined}
                onChange={() => onChange(option)}
              />
              {param.optionLabelKeys[option] ? t(param.optionLabelKeys[option]!) : option}
            </label>
          ))}
          {messages}
        </fieldset>
      )
    case 'boolean':
      return (
        <div className={styles.group}>
          <Switch label={t(param.labelKey)} hint={help || undefined} checked={value === true} onChange={onChange} />
        </div>
      )
    case 'number':
    case 'integer': {
      const suffix = kind.type === 'number' ? paramUnitSuffix(kind.unit) : ''
      const unitId = `${id}-unit`
      return (
        <div className={styles.field}>
          <label for={id}>{t(param.labelKey)}</label>
          <span className={styles.numberField}>
            <input
              id={id}
              type="text"
              inputMode={kind.type === 'integer' ? 'numeric' : 'decimal'}
              value={typeof value === 'string' ? value : ''}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={[suffix ? unitId : null, describedBy].filter(Boolean).join(' ') || undefined}
              onInput={(event) => onChange(event.currentTarget.value)}
            />
            {suffix && <span id={unitId}>{suffix}</span>}
          </span>
          {messages}
        </div>
      )
    }
  }
}
