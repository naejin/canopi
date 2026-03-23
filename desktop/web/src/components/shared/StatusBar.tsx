import { locale, theme } from "../../state/app";
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
  const themeLabel = t(`theme.${theme.value}`);

  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <span>{t("status.version")}</span>
      </div>
      <div className={styles.right}>
        <select
          className={styles.select}
          value={locale.value}
          onChange={(e) => {
            locale.value = (e.target as HTMLSelectElement).value as typeof locale.value;
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
