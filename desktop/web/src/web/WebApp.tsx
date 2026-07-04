import styles from "./WebApp.module.css";
import { BrowserAppShell } from "./BrowserAppShell";
import { browserDesignSessionController } from "./browser-design-session";

export function WebApp() {
  return (
    <div className={styles.root} data-canopi-web-root>
      <BrowserAppShell handlers={browserDesignSessionController.handlers()} />
    </div>
  );
}
