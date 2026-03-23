import styles from "./Panels.module.css";

export function PlantDbPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Plant Database</h2>
        <p className={styles.emptyText}>
          Search 175,000+ plants by name, family, or use
        </p>
        <div className={styles.chips}>
          <span className={styles.chip}>Fruit trees</span>
          <span className={styles.chip}>Nitrogen fixers</span>
          <span className={styles.chip}>Shade tolerant</span>
          <span className={styles.chip}>Edible</span>
        </div>
      </div>
    </div>
  );
}
