import i18n from "i18next";
import { effect } from "@preact/signals";
import { locale } from "../app/settings/state";

import en from "./en.json";
import fr from "./fr.json";
import es from "./es.json";
import pt from "./pt.json";
import it from "./it.json";
import zh from "./zh.json";
import de from "./de.json";
import ja from "./ja.json";
import ko from "./ko.json";
import nl from "./nl.json";
import ru from "./ru.json";

i18n.init({
  lng: locale.value,
  fallbackLng: "en",
  supportedLngs: ["en", "fr", "es", "pt", "it", "zh", "de", "ja", "ko", "nl", "ru"],
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    pt: { translation: pt },
    it: { translation: it },
    zh: { translation: zh },
    de: { translation: de },
    ja: { translation: ja },
    ko: { translation: ko },
    nl: { translation: nl },
    ru: { translation: ru },
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

const fixedTranslations = new Map<string, typeof i18n.t>();

function translateForObservedLocale(...args: unknown[]): unknown {
  const currentLocale = locale.value;
  let fixedTranslation = fixedTranslations.get(currentLocale);
  if (!fixedTranslation) {
    fixedTranslation = i18n.getFixedT(currentLocale);
    fixedTranslations.set(currentLocale, fixedTranslation);
  }
  return Reflect.apply(fixedTranslation, undefined, args);
}

// i18next brands TFunction structurally; this wrapper preserves its complete overload contract.
export const t = translateForObservedLocale as unknown as typeof i18n.t;
