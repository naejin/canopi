import { t } from "../../i18n";
import styles from "./Panels.module.css";

export function SavedDesignsPanel() {
  return (
    <div className={styles.sidebar}>
      <h2 className={styles.sidebarTitle}>{t("saved.title")}</h2>
      <div className={styles.empty}>
        <p className={styles.emptyText}>{t("saved.emptyText")}</p>
      </div>
    </div>
  );
}
