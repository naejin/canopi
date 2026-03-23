import { locale, theme } from "../../state/app";
import styles from "./StatusBar.module.css";

const localeLabels: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
  it: "Italiano",
  zh: "中文",
};

const themeLabels: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function StatusBar() {
  return (
    <footer className={styles.bar}>
      <div className={styles.left}>
        <span>Canopi v0.1.0</span>
      </div>
      <div className={styles.right}>
        <select
          className={styles.select}
          value={locale.value}
          onChange={(e) => {
            locale.value = (e.target as HTMLSelectElement).value as typeof locale.value;
          }}
          aria-label="Language"
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
          aria-label={`Theme: ${themeLabels[theme.value]}`}
          title={`Theme: ${themeLabels[theme.value]}`}
        >
          {theme.value === "dark" ? "Dark" : theme.value === "light" ? "Light" : "System"}
        </button>
      </div>
    </footer>
  );
}
