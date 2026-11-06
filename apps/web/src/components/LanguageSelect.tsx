import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '../i18n';

export function LanguageSelect() {
  const { t, i18n } = useTranslation();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only sm:not-sr-only">{t('language')}</span>
      <select
        className="rounded border border-stone-300 bg-white px-2 py-1"
        value={i18n.resolvedLanguage ?? i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}
