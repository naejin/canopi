import { sidePanel, navigateTo, activePanel, type Panel } from "../../state/app";
import { t } from "../../i18n";
import { LeafIcon, PencilIcon } from "./icons";
import styles from "./ActivityBar.module.css";

interface NavItem {
  id: Panel;
  icon: () => preact.JSX.Element;
  labelKey: string;
}

const panels: NavItem[] = [
  { id: "canvas", icon: PencilIcon, labelKey: "nav.canvas" },
  { id: "plant-db", icon: LeafIcon, labelKey: "nav.plantDb" },
];

const SIDE_PANELS = new Set<string>(["plant-db", "learning"]);

export function ActivityBar() {
  return (
    <nav className={styles.bar} aria-label="Main navigation">
      {panels.map((p) => {
        let isActive: boolean;
        if (SIDE_PANELS.has(p.id)) {
          isActive = sidePanel.value === p.id;
        } else if (p.id === "canvas") {
          isActive = activePanel.value === "canvas" && sidePanel.value === null;
        } else {
          isActive = activePanel.value === p.id;
        }

        const label = t(p.labelKey);

        return (
          <button
            key={p.id}
            className={`${styles.button} ${isActive ? styles.active : ""}`}
            onClick={() => navigateTo(p.id)}
            title={label}
            aria-label={label}
            aria-pressed={isActive}
          >
            <p.icon />
          </button>
        );
      })}
    </nav>
  );
}
