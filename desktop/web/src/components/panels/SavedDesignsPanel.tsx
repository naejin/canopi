import styles from "./Panels.module.css";

export function SavedDesignsPanel() {
  return (
    <div className={styles.sidebar}>
      <h2 className={styles.sidebarTitle}>Saved Designs</h2>
      <div className={styles.empty}>
        <p className={styles.emptyText}>Your designs will appear here</p>
      </div>
    </div>
  );
}
