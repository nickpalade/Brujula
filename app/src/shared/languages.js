// Languages the app UI is available in. Scoped to Spanish + English (the two
// languages the field/command UIs are fully translated into). The hub's
// summary-output language config lives separately (server/config.js).

export const LANGUAGES = [
  { code: 'es', name: 'Español' },
  { code: 'en', name: 'English' },
]

export const DEFAULT_LANG = 'en'

export function languageName(code) {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code
}
