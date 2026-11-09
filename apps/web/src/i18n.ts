import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

type Messages = { languageName: string } & Record<string, unknown>;

/**
 * NFR-04: English and Sinhala at launch. Every file in `locales/` is a language,
 * named by its own `languageName`, so Tamil arrives as `ta.json` alone, with no
 * change to the software (docs/translating.md).
 */
const files = import.meta.glob<Messages>('./locales/*.json', { eager: true, import: 'default' });
const resources = Object.fromEntries(
  Object.entries(files).map(([path, messages]) => [
    path.replace(/^.*\/(\w+)\.json$/, '$1'),
    { translation: messages },
  ]),
);

/** English first, then Sinhala, then any others by code. */
const ORDER = ['en', 'si'];
export const LANGUAGES = Object.keys(resources)
  .sort((a, b) => {
    const rank = (c: string) => (ORDER.includes(c) ? ORDER.indexOf(c) : ORDER.length);
    return rank(a) - rank(b) || a.localeCompare(b);
  })
  .map((code) => ({ code, label: (files[`./locales/${code}.json`] as Messages).languageName }));

const LANGUAGE_KEY = 'pothgula.language';

function savedLanguage(): string {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return LANGUAGES.some((l) => l.code === saved) ? saved! : 'en';
  } catch {
    return 'en';
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: savedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
  try {
    localStorage.setItem(LANGUAGE_KEY, lng);
  } catch {
    /* the choice then lasts only for this visit */
  }
});

export default i18n;
