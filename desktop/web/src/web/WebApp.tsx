import styles from "./WebApp.module.css";
import { BrowserAppShell } from "./BrowserAppShell";

export function WebApp() {
  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell />
    </div>
  );
}
