import styles from "./Panels.module.css";

export function CanvasPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>Design Canvas</h2>
        <p className={styles.emptyText}>
          Set a location to enable map layers, or start drawing
        </p>
      </div>
    </div>
  );
}
