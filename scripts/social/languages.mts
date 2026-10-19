// docs/74 — the languages social content is produced in. One per UI
// language family; the app's regional variants (es-ES, fr-FR) share their
// family's posts. fr is written for Canada first (D276).
export const LANGUAGES = ['en', 'pt-BR', 'es', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];

export function isLanguage(s: string): s is Language {
  return (LANGUAGES as readonly string[]).includes(s);
}
