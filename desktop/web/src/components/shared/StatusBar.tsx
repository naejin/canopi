import { locale, theme } from "../../app/settings/state";
import { persistCurrentSettings } from "../../app/settings/persistence";
import { autosaveFailed } from "../../state/design";
import { t } from "../../i18n";
import styles from "./StatusBar.module.css";

const localeLabels: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  zh: "中文",
  de: "Deutsch",
  ja: "日本語",
  ko: "한국어",
  nl: "Nederlands",
  ru: "Русский",
};

export function StatusBar() {
  void locale.value;

  const themeLabel = t(`theme.${theme.value}`);

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
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
            theme.value = theme.value === 'dark' ? 'light' : 'dark';
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
