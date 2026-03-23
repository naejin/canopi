import i18n from "i18next";
import { effect } from "@preact/signals";
import { locale } from "../state/app";

import en from "./en.json";
import fr from "./fr.json";
import es from "./es.json";
import pt from "./pt.json";
import it from "./it.json";
import zh from "./zh.json";

i18n.init({
  lng: locale.value,
  fallbackLng: "en",
  supportedLngs: ["en", "fr", "es", "pt", "it", "zh"],
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    pt: { translation: pt },
    it: { translation: it },
    zh: { translation: zh },
  },
});

// Sync locale signal → i18next
const disposeLocaleSync = effect(() => {
  i18n.changeLanguage(locale.value);
});

// Clean up on Vite HMR to prevent duplicate effects
if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeLocaleSync());
}

export const t = i18n.t.bind(i18n);
