import { activePanel, savedDesignsOpen, type Panel } from "../../state/app";
import { LeafIcon, PencilIcon, GlobeIcon, BookIcon, FolderIcon } from "./icons";
import styles from "./ActivityBar.module.css";

const panels: { id: Panel | "saved"; icon: () => preact.JSX.Element; label: string }[] = [
  { id: "plant-db", icon: LeafIcon, label: "Plant Database" },
  { id: "canvas", icon: PencilIcon, label: "Design Canvas" },
  { id: "world-map", icon: GlobeIcon, label: "World Map" },
  { id: "learning", icon: BookIcon, label: "Learning" },
  { id: "saved", icon: FolderIcon, label: "Saved Designs" },
];

export function ActivityBar() {
  return (
    <nav className={styles.bar} aria-label="Main navigation">
      {panels.map((p) => {
        const isActive =
          p.id === "saved"
            ? savedDesignsOpen.value
            : activePanel.value === p.id && !savedDesignsOpen.value;

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
            title={p.label}
            aria-label={p.label}
            aria-pressed={isActive}
          >
            <p.icon />
          </button>
        );
      })}
    </nav>
  );
}
