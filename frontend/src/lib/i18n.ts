import { useCallback, useEffect, useState } from "react"
import { getLang, type Lang } from "./dir"
import ar from "../i18n/locales/ar.json"
import id from "../i18n/locales/id.json"
import { rebrand } from "./brand"

/** Locale dictionaries keyed by English source string. Missing keys fall back
 * to English so the app never blanks as coverage expands. */
const DICT: Record<string, Record<string, string>> = {
  en: {},
  ar: ar as Record<string, string>,
  id: id as Record<string, string>,
}

export type Vars = Record<string, string | number>

/** Replace `{name}` placeholders in a template. Arabic (and others) can
 * reorder words by placing the same placeholders differently. */
function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : `{${k}}`,
  )
}

/** Translate an English string for the current language (falls back to it). */
export function t(s: string, vars?: Vars): string {
  const dict = DICT[getLang()] ?? {}
  return interpolate(rebrand(dict[s] ?? s), vars)
}

/** Translate a value from the database (a status, a source, a category).
 * Only catalogued strings change; a guest's or property's own name is shown
 * as typed, never rebranded. */
export function tValue(s: string): string {
  const hit = (DICT[getLang()] ?? {})[s]
  return hit ? rebrand(hit) : s
}

/** Translate for a specific language (e.g. offline export). */
export function tFor(lang: Lang, s: string, vars?: Vars): string {
  const dict = DICT[lang] ?? {}
  return interpolate(rebrand(dict[s] ?? s), vars)
}

/** Subscribe a component to the language: re-renders on change, returns a
 * bound translator. */
export function useT() {
  const [lang, setL] = useState<Lang>(getLang())
  useEffect(() => {
    const on = () => setL(getLang())
    window.addEventListener("kamra:lang", on)
    return () => window.removeEventListener("kamra:lang", on)
  }, [])
  const t = useCallback(
    (s: string, vars?: Vars) => {
      const dict = DICT[lang] ?? {}
      return interpolate(rebrand(dict[s] ?? s), vars)
    },
    [lang],
  )
  return { lang, t }
}
