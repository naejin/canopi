import { useSignal } from '@preact/signals'
import { t } from '../../i18n'
import { locale, navigateTo } from '../../state/app'
import { selectedCanonicalName } from '../../state/plant-db'
import { articles, type Article } from '../../content/articles'
import { renderMarkdown } from '../../utils/markdown'
import styles from './LearningPanel.module.css'

/** All unique topic keys from the article set. */
const TOPICS = [...new Set(articles.map((a) => a.topic))]

/** Extract first non-heading, non-empty line as a plain-text preview. */
function getPreview(content: string): string {
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    // Strip markdown formatting for preview
    return trimmed
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/_(.+?)_/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  }
  return ''
}

/** Filter articles by search query and topic. */
function filterArticles(query: string, topic: string | null): Article[] {
  const q = query.toLowerCase().trim()
  return articles.filter((a) => {
    if (topic !== null && a.topic !== topic) return false
    if (q.length === 0) return true
    return (
      a.title.toLowerCase().includes(q) ||
      a.content.toLowerCase().includes(q)
    )
  })
}

export function LearningPanel() {
  // Subscribe to locale for re-render on language change
  void locale.value

  const selectedArticleId = useSignal<string | null>(null)
  const searchQuery = useSignal('')
  const activeTopic = useSignal<string | null>(null)

  const query = searchQuery.value
  const topic = activeTopic.value
  const filtered = filterArticles(query, topic)
  const selected = selectedArticleId.value !== null
    ? articles.find((a) => a.id === selectedArticleId.value) ?? null
    : null

  // Navigate to a related plant in the Plant DB panel
  function handlePlantClick(canonicalName: string) {
    selectedCanonicalName.value = canonicalName
    navigateTo('plant-db')
  }

  // ── Article detail view ──
  if (selected !== null) {
    return (
      <div className={styles.panel}>
        <div className={styles.articleView}>
          {/* Header with back button */}
          <div className={styles.articleViewHeader}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => { selectedArticleId.value = null }}
              aria-label={t('plantDetail.back')}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="7.5 2 3.5 6 7.5 10" />
              </svg>
            </button>
            <span className={styles.articleViewTitle}>{selected.title}</span>
            <span className={styles.articleTopicBadge}>
              {t(`learning.${selected.topic}`)}
            </span>
          </div>

          {/* Rendered markdown content */}
          <div className={styles.articleContent}>
            {renderMarkdown(selected.content)}
          </div>

          {/* Related plants */}
          {selected.relatedPlants && selected.relatedPlants.length > 0 && (
            <div className={styles.relatedSection}>
              <div className={styles.relatedTitle}>{t('learning.relatedPlants')}</div>
              <div className={styles.relatedList}>
                {selected.relatedPlants.map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={styles.relatedPlant}
                    onClick={() => handlePlantClick(name)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── List view ──
  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>{t('learning.title')}</span>
        {filtered.length > 0 && (
          <span className={styles.count}>{filtered.length}</span>
        )}
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          onInput={(e) => { searchQuery.value = e.currentTarget.value }}
          placeholder={t('learning.search')}
          aria-label={t('learning.search')}
        />
        {query.length > 0 && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => { searchQuery.value = '' }}
            aria-label={t('plantDb.clearSearch')}
          >
            ×
          </button>
        )}
      </div>

      {/* Topic chips */}
      <div className={styles.topicStrip} role="group" aria-label={t('learning.topics')}>
        {TOPICS.map((topicKey) => (
          <button
            key={topicKey}
            type="button"
            className={`${styles.topicChip} ${topic === topicKey ? styles.topicChipActive : ''}`}
            onClick={() => {
              activeTopic.value = activeTopic.value === topicKey ? null : topicKey
            }}
            aria-pressed={topic === topicKey}
          >
            {t(`learning.${topicKey}`)}
          </button>
        ))}
      </div>

      {/* Article list or empty state */}
      {filtered.length === 0 ? (
        <div className={styles.empty} aria-live="polite">
          <span className={styles.emptyText}>{t('learning.noResults')}</span>
        </div>
      ) : (
        <div className={styles.list} role="list" aria-label={t('learning.articles')}>
          {filtered.map((article) => (
            <div
              key={article.id}
              className={styles.articleRow}
              role="listitem"
              tabIndex={0}
              onClick={() => { selectedArticleId.value = article.id }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  selectedArticleId.value = article.id
                }
              }}
            >
              <div className={styles.articleRowHeader}>
                <span className={styles.articleTitle}>{article.title}</span>
                <span className={styles.articleTopicBadge}>
                  {t(`learning.${article.topic}`)}
                </span>
              </div>
              <span className={styles.articlePreview}>
                {getPreview(article.content)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
