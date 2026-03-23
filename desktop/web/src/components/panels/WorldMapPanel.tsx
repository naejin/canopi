import { t } from "../../i18n";
import styles from "./Panels.module.css";

export function WorldMapPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t("worldMap.emptyTitle")}</h2>
        <p className={styles.emptyText}>{t("worldMap.emptyText")}</p>
      </div>
    </div>
  );
}
