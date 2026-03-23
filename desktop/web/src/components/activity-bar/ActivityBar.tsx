import { activePanel, savedDesignsOpen, type Panel } from "../../state/app";
import { t } from "../../i18n";
import { LeafIcon, PencilIcon, GlobeIcon, BookIcon, FolderIcon } from "./icons";
import styles from "./ActivityBar.module.css";

type NavItem =
  | { id: Panel; icon: () => preact.JSX.Element; labelKey: string }
  | { id: "saved"; icon: () => preact.JSX.Element; labelKey: string };

const panels: NavItem[] = [
  { id: "plant-db", icon: LeafIcon, labelKey: "nav.plantDb" },
  { id: "canvas", icon: PencilIcon, labelKey: "nav.canvas" },
  { id: "world-map", icon: GlobeIcon, labelKey: "nav.worldMap" },
  { id: "learning", icon: BookIcon, labelKey: "nav.learning" },
  { id: "saved", icon: FolderIcon, labelKey: "nav.savedDesigns" },
];

export function ActivityBar() {
  return (
    <nav className={styles.bar} aria-label="Main navigation">
      {panels.map((p) => {
        const isActive =
          p.id === "saved"
            ? savedDesignsOpen.value
            : activePanel.value === p.id && !savedDesignsOpen.value;

        const label = t(p.labelKey);

        return (
          <button
            key={p.id}
            className={`${styles.button} ${isActive ? styles.active : ""}`}
            onClick={() => {
              if (p.id === "saved") {
                savedDesignsOpen.value = !savedDesignsOpen.value;
              } else {
                activePanel.value = p.id;
                savedDesignsOpen.value = false;
              }
            }}
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
