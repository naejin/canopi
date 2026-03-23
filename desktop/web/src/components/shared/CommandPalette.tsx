import { useRef, useState } from "preact/hooks";
import { useSignalEffect } from "@preact/signals";
import { commandPaletteOpen } from "../../shortcuts/manager";
import { commands } from "../../commands/registry";
import { t } from "../../i18n";
import styles from "./CommandPalette.module.css";

export function CommandPalette() {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = "command-palette-list";

  useSignalEffect(() => {
    if (!commandPaletteOpen.value) return;
    // Focus and reset when palette opens — signal subscription is explicit
    inputRef.current?.focus();
    setQuery("");
    setActiveIdx(0);
  });

  if (!commandPaletteOpen.value) return null;

  const filtered = commands.filter((cmd) =>
    cmd.label().toLowerCase().includes(query.toLowerCase())
  );

  function execute(idx: number) {
    const cmd = filtered[idx];
    if (cmd) {
      cmd.action();
      commandPaletteOpen.value = false;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      execute(activeIdx);
    } else if (e.key === "Escape") {
      commandPaletteOpen.value = false;
    }
  }

  const activeItemId = filtered[activeIdx]
    ? `cmd-${filtered[activeIdx]!.id}`
    : undefined;

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) commandPaletteOpen.value = false;
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("commands.commandPalette")}
    >
      <div className={styles.palette}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          placeholder={t("commands.searchPlaceholder") || "Type a command..."}
          value={query}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setActiveIdx(0);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-controls={listId}
          aria-expanded="true"
          aria-activedescendant={activeItemId}
        />
        <div className={styles.list} role="listbox" id={listId}>
          {filtered.length === 0 ? (
            <div className={styles.empty}>{t("commands.noResults") || "No commands found"}</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                id={`cmd-${cmd.id}`}
                className={`${styles.item} ${i === activeIdx ? styles.active : ""}`}
                onClick={() => execute(i)}
                role="option"
                aria-selected={i === activeIdx}
              >
                <span>{cmd.label()}</span>
                {cmd.shortcut && (
                  <span className={styles.shortcut}>{cmd.shortcut}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
