// Language picker for the Command Post.
// Controls two things at once, kept in sync:
//   1. The app UI language (i18n context) — switches live, no reload.
//   2. The hub's /language-config (persisted server-side) — the language of
//      every model-generated incident summary and the SITREP.
// Scoped to Spanish + English (see shared/languages.js).

import { useCallback, useEffect, useState } from 'react';
import { getLanguageConfig, setLanguageConfig } from './dataSource.js';
import { LANGUAGES } from '../shared/languages.js';
import { useI18n } from '../shared/i18n.jsx';
import Icon from '../shared/Icon.jsx';

function LanguagePicker() {
  const { lang, setLang } = useI18n();
  const [languages, setLanguages] = useState(LANGUAGES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Load the server's summary-language list, but keep the app UI language as
  // the source of truth for what's selected so the picker + UI never diverge.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await getLanguageConfig();
        if (cancelled) return;
        if (Array.isArray(cfg.languages) && cfg.languages.length > 0) {
          setLanguages(cfg.languages);
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e.message || 'unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = useCallback(
    async (e) => {
      const next = e.target.value;
      const prev = lang;
      // Switch the UI immediately — this is the "live update".
      setLang(next);
      setSaving(true);
      setError(null);
      try {
        // Persist the summary/SITREP language server-side too.
        await setLanguageConfig(next);
      } catch (err) {
        setLang(prev);
        setError(err.message || 'save failed');
      } finally {
        setSaving(false);
      }
    },
    [lang, setLang],
  );

  return (
    <label className="cmd-lang" title="App language + AI summaries and the SITREP">
      <Icon name="globe" className="cmd-lang__icon" />
      <select
        className="cmd-lang__select"
        value={lang}
        onChange={handleChange}
        disabled={saving || languages.length === 0}
        aria-label="Summary language"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export default LanguagePicker;
