import { t } from "../../i18n";
import styles from "./Panels.module.css";

export function CanvasPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t("canvas.emptyTitle")}</h2>
        <p className={styles.emptyText}>{t("canvas.emptyText")}</p>
      </div>
    </div>
  );
}
