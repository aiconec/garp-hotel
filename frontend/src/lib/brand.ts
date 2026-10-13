// GARP Hotel branding. This fork keeps upstream Kamra's code and module name
// (`kamra`) so upstream merges stay cheap; only what people see is renamed.
// Every string that goes through t() is rebranded here, so new upstream copy
// picks up the name without touching each screen.

export const BRAND_NAME = "GARP Hotel"
export const BRAND_AGENT = "GARP Hotel Agent"

// AGPL-3.0 §5(d)/§13: the UI keeps a legal notice and a link to this
// modified version's source.
export const SOURCE_URL = "https://github.com/aiconec/garp-hotel"
export const UPSTREAM_NAME = "Kamra PMS"

export function rebrand(s: string): string {
  if (!s.includes("Kamra")) return s
  return s
    .replace(/Kamra Agent/g, BRAND_AGENT)
    .replace(/Kamra PMS/g, BRAND_NAME)
    .replace(/\bKamra\b/g, BRAND_NAME)
}
