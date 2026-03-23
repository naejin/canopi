import { t } from "../../i18n";
import styles from "./Panels.module.css";

export function PlantDbPanel() {
  return (
    <div className={styles.panel}>
      <div className={styles.empty}>
        <h2 className={styles.emptyTitle}>{t("plantDb.emptyTitle")}</h2>
        <p className={styles.emptyText}>{t("plantDb.emptyText")}</p>
        <div className={styles.chips}>
          <span className={styles.chip}>{t("chips.fruitTrees")}</span>
          <span className={styles.chip}>{t("chips.nitrogenFixers")}</span>
          <span className={styles.chip}>{t("chips.shadeTolerant")}</span>
          <span className={styles.chip}>{t("chips.edible")}</span>
        </div>
      </div>
    </div>
  );
}
