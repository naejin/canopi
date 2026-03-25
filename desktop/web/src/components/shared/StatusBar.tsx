import { locale, theme, activePanel, persistCurrentSettings } from "../../state/app";
import { zoomLevel } from "../../state/canvas";
import { autosaveFailed } from "../../state/document";
import { t } from "../../i18n";
import styles from "./StatusBar.module.css";

const localeLabels: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  zh: "中文",
};

export function StatusBar() {
  void locale.value;

  const themeLabel = t(`theme.${theme.value}`);
  const isCanvas = activePanel.value === "canvas";
  const zoom = zoomLevel.value;

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        {isCanvas && (
          <span className={styles.zoomLevel} aria-label={t("canvas.grid.zoom")}>
            {Math.round(zoom * 100)}%
          </span>
        )}
        {autosaveFailed.value && (
          <span className={styles.autosaveWarning} role="alert">
            {t("status.autosaveFailed")}
          </span>
        )}
      </div>

      <div className={styles.right}>
        <select
          className={styles.select}
          value={locale.value}
          onChange={(e) => {
            locale.value = (e.target as HTMLSelectElement).value as typeof locale.value;
            persistCurrentSettings();
          }}
          aria-label={t("status.language")}
        >
          {Object.entries(localeLabels).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </select>
        <button
          className={styles.themeBtn}
          onClick={() => {
            const order = ["system", "light", "dark"] as const;
            const idx = order.indexOf(theme.value);
            theme.value = order[(idx + 1) % order.length]!;
            persistCurrentSettings();
          }}
          aria-label={`${t("status.theme")}: ${themeLabel}`}
          title={`${t("status.theme")}: ${themeLabel}`}
        >
          {themeLabel}
        </button>
      </div>
    </footer>
  );
}
