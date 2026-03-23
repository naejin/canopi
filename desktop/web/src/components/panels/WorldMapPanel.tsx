import styles from "./Panels.module.css";

export function WorldMapPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>World Map</h2>
        <p className={styles.emptyText}>
          Be the first to share a design in your area!
        </p>
      </div>
    </div>
  );
}
