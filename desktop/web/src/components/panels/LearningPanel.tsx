import styles from "./Panels.module.css";

export function LearningPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Learning</h2>
        <p className={styles.emptyText}>
          Learn techniques from soil prep to syntropy
        </p>
      </div>
    </div>
  );
}
