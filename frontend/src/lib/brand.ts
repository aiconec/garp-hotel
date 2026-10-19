// BizConnect.id Hotel branding. This fork keeps upstream Kamra's code and module name
// (`kamra`) so upstream merges stay cheap; only what people see is renamed.
// Every string that goes through t() is rebranded here, so new upstream copy
// picks up the name without touching each screen.

export const BRAND_NAME = "BizConnect.id Hotel"
export const BRAND_AGENT = "BizConnect.id Hotel Agent"

// AGPL-3.0 §5(d)/§13: the account menu links the licences page, which carries
// the copyright, the no-warranty notice and the offer of this modified
// version's source. Like every GARP app, the UI never links the repo itself.
export const LICENCES_URL = "https://garp.aiconec.com/docs/licences"

export function rebrand(s: string): string {
  if (!s.includes("Kamra")) return s
  return s
    .replace(/Kamra Agent/g, BRAND_AGENT)
    .replace(/Kamra PMS/g, BRAND_NAME)
    .replace(/\bKamra\b/g, BRAND_NAME)
}
