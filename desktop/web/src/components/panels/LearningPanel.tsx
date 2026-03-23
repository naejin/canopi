import { t } from "../../i18n";
import styles from "./Panels.module.css";

export function LearningPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t("learning.emptyTitle")}</h2>
        <p className={styles.emptyText}>{t("learning.emptyText")}</p>
      </div>
    </div>
  );
}
