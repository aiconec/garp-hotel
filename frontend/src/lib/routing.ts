// The SPA is served at /hotel in production (BizConnect.id Hotel; upstream Kamra used
// /kamra, which the server now redirects here) and at / by the Vite dev server.
export const ROUTER_BASENAME = import.meta.env.PROD ? "/hotel" : "/"

// The same shell is also rendered at "/" (site home page) and at a legacy
// /kamra URL; move those under the basename so the router matches them.
if (import.meta.env.PROD && !/^\/hotel(\/|$)/.test(window.location.pathname)) {
  const rest = window.location.pathname.replace(/^\/kamra(?=\/|$)/, "")
  window.history.replaceState(
    null,
    "",
    ROUTER_BASENAME + (rest === "/" ? "" : rest) + window.location.search + window.location.hash,
  )
}

// Prefix an in-app path with the basename for a full-page navigation
// (window.location), which the router's own navigate() would otherwise add.
export function toFullPath(path: string): string {
  const base = ROUTER_BASENAME === "/" ? "" : ROUTER_BASENAME
  return base + (path.startsWith("/") ? path : "/" + path)
}
