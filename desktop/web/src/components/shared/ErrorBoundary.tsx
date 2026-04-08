import { Component, type ComponentChildren } from 'preact'
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

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }): void {
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
        {t('error.title') || 'Something went wrong'}
      </h1>
      <p className={styles.message}>
        {t('error.message') || 'The application encountered an unexpected error. You can try reloading.'}
      </p>
      <button
        className={styles.reloadBtn}
        type="button"
        onClick={() => location.reload()}
      >
        {t('error.reload') || 'Reload'}
      </button>
      {error.stack && (
        <details className={styles.details}>
          <summary>{t('error.details') || 'Error details'}</summary>
          <pre className={styles.stack}>{error.stack}</pre>
        </details>
      )}
    </div>
  )
}
