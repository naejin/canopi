import { Component, type ComponentChildren, type ErrorInfo } from 'preact'
import { t } from '../../i18n'
import styles from './ErrorBoundary.module.css'

interface Props {
  children: ComponentChildren
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  render() {
    if (this.state.error) return <FallbackUI error={this.state.error} />
    return this.props.children
  }
}

function FallbackUI({ error }: { error: Error }) {
  return (
    <div className={styles.container} role="alert">
      <h1 className={styles.title}>
        {t('error.title')}
      </h1>
      <p className={styles.message}>
        {t('error.message')}
      </p>
      <button
        className={styles.reloadBtn}
        type="button"
        onClick={() => location.reload()}
      >
        {t('error.reload')}
      </button>
      {error.stack && (
        <details className={styles.details}>
          <summary>{t('error.details')}</summary>
          <pre className={styles.stack}>{error.stack}</pre>
        </details>
      )}
    </div>
  )
}
