// App-wide internationalization (i18n).
//
// - Single source of truth for the UI language, persisted to localStorage so a
//   choice survives reloads.
// - `useI18n()` returns { lang, setLang, t, dir }. `t(key, vars)` looks up the
//   string for the active language, falls back to English, then to the key
//   itself, and interpolates {var} placeholders.
// - Changing the language re-renders every consumer instantly (React context)
//   and updates <html lang/dir> (RTL for Arabic/Urdu).

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LANG, LANGUAGES } from './languages.js'
import { translations } from './translations.js'

const STORAGE_KEY = 'brujula.lang'
const RTL_LANGS = new Set(['ar', 'ur'])
const SUPPORTED = new Set(LANGUAGES.map((l) => l.code))

function readStoredLang() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && SUPPORTED.has(stored)) return stored
  } catch {
    /* private mode — fall through to default */
  }
  return DEFAULT_LANG
}

function interpolate(str, vars) {
  if (!vars) return str
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(readStoredLang)

  const dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr'

  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.lang = lang
    document.documentElement.dir = dir
  }, [lang, dir])

  const setLang = useCallback((next) => {
    if (!SUPPORTED.has(next)) return
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* private mode — language lives in memory this session */
    }
  }, [])

  const t = useCallback(
    (key, vars) => {
      const table = translations[lang] || {}
      const fallback = translations.en || {}
      const value = key in table ? table[key] : key in fallback ? fallback[key] : key
      return interpolate(value, vars)
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t, dir }), [lang, setLang, t, dir])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>')
  return ctx
}
