import { signal } from "@preact/signals";

export type Panel = "plant-db" | "canvas" | "world-map" | "learning";

export const activePanel = signal<Panel>("plant-db");
export const locale = signal<"en" | "fr" | "es" | "pt" | "it" | "zh">("en");
export const theme = signal<"light" | "dark" | "system">("system");
export const dbReady = signal(false);
export const savedDesignsOpen = signal(false);
