import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react"
import {
  ArrowUpRight,
  Check,
  ChevronsUpDown,
  GraduationCap,
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Plus,
  Scale,
  Search,
  Sun,
  X,
} from "lucide-react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import UpdateNag from "./components/UpdateNag"
import SetupNag from "./components/SetupNag"
import { Button } from "./components/ui/button"
import {
  appForPath,
  visibleApps,
  type AppDef,
  type AppNavItem,
} from "./lib/apps"
import {
  call,
  enabledModules,
  getCurrentProperty,
  myProperties,
  setCurrentProperty,
  type PropertyRow,
} from "./lib/api"
import { asset } from "./lib/asset"
import { BRAND_NAME, LICENCES_URL } from "./lib/brand"
import { useAuth } from "./lib/auth"
import { subscribeRealtime } from "./lib/realtime"
import { getTheme, setTheme } from "./lib/theme"
import { useT } from "./lib/i18n"
import { loadLocale } from "./lib/money"
import { cn } from "./lib/utils"
import { useKiosk } from "./lib/kiosk"
import { getSiteInfo, versionLabel } from "./lib/siteInfo"
import AlertSettings from "./components/AlertSettings"
import NotificationHost from "./components/NotificationHost"
import GuidedTours from "./tours/GuidedTours"
import { openGuides } from "./tours/events"

// On-demand UI kept out of the entry chunk: the booking dialog opens on
// request; the palette and help panel load right after the shell paints.
const BookingDialog = lazy(() =>
  import("./components/BookingDialog").then((m) => ({ default: m.BookingDialog })),
)
const CommandPalette = lazy(() =>
  import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette })),
)
const HelpPanel = lazy(() => import("./components/HelpPanel"))

export interface BookingInitial {
  room_type?: string
  date?: string
  guest?: string
  guest_name?: string
  phone?: string
  stays?: number
  walkIn?: boolean
}

export interface ShellContext {
  refreshKey: number
  canBook: boolean
  openBooking: (initial: BookingInitial) => void
  /** The property's enabled_modules (empty = all; undefined while loading) -
   *  the same filter the sidebar and MCP apply. */
  modules?: string[]
}

// mirrors @require_roles on kamra.api.create_booking / walk_in (admins always pass)
const BOOKING_ROLES = [
  "Front Desk",
  "Hotel Agent",
  "Hotel Admin",
  "System Manager",
  "Administrator",
]

/** Close a popover on an outside click or Escape. */
function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close()
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [ref, open, close])
}

/** An app opens on its first in-app route. */
function useOpenApp(after: () => void) {
  const navigate = useNavigate()
  return (app: AppDef) => {
    after()
    const first = app.items.find((i) => i.to)
    if (first?.to) navigate(first.to)
  }
}

function SearchShortcut() {
  const { t } = useT()
  const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform)
  const combo = isMac ? "⌘K" : "Ctrl+K"
  return (
    <button
      onClick={() => window.dispatchEvent(new Event("kamra:open-palette"))}
      title={t("Search: find a guest or booking, or jump anywhere - press {combo}", { combo: isMac ? "⌘ Command" : "Ctrl" + " + K" })}
      aria-label={t("Open search")}
      className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50/70 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="truncate whitespace-nowrap">{t("Search guests, bookings, screens, settings…")}</span>
      <kbd className="ml-auto hidden shrink-0 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 xl:inline">
        {combo}
      </kbd>
    </button>
  )
}

function ThemeToggle() {
  const { t } = useT()
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  )
  return (
    <button
      aria-label={dark ? t("Switch to light mode") : t("Switch to dark mode")}
      className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
      onClick={() => {
        setTheme(dark ? "light" : "dark")
        setDark(!dark)
      }}
      title={getTheme() === "system" ? t("Theme (system)") : t("Theme")}
    >
      {dark ? (
        <Sun className="size-4" aria-hidden />
      ) : (
        <Moon className="size-4" aria-hidden />
      )}
    </button>
  )
}

/** Signed-in user and Sign out behind one avatar, so the top bar keeps its
 *  room for the booking buttons at every width. */
function UserMenu({ user, onSignOut }: { user: string; onSignOut: () => void }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))

  const initial = (user || "?").trim().charAt(0).toUpperCase()
  return (
    <div className="relative" ref={ref} data-tour="account">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Account")}
        aria-expanded={open}
        title={user}
        className="flex size-8 items-center justify-center rounded-full border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-600 hover:bg-zinc-200"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5">
          <div className="truncate px-2.5 py-2 text-xs text-zinc-500" title={user}>
            {user}
          </div>
          <a
            href={LICENCES_URL}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            <Scale className="size-4" aria-hidden />
            {t("Licences")}
          </a>
          <button
            onClick={() => {
              setOpen(false)
              openGuides()
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            <GraduationCap className="size-4" aria-hidden />
            {t("Guided tours")}
          </button>
          <button
            onClick={onSignOut}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100"
          >
            <LogOut className="size-4" aria-hidden />
            {t("Sign out")}
          </button>
        </div>
      )}
    </div>
  )
}

/** App switcher in the top bar: quiet grid, one accent for the current app.
 *  Shown only while the sidebar is a drawer; beside the rail, the rail's
 *  header does the same job. */
function AppSwitcher({
  apps,
  current,
  className,
}: {
  apps: AppDef[]
  current: AppDef
  className?: string
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  const go = useOpenApp(() => setOpen(false))

  return (
    <div className={cn("relative", className)} ref={ref} data-tour="app-switcher">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("Switch app")}
        title={t("Switch app")}
        className="flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
      >
        <LayoutGrid className="size-4" strokeWidth={1.75} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-50 w-64 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg ring-1 ring-black/5">
          <div className="grid grid-cols-3 gap-0.5">
            {apps.map((app) => {
              const active = app.id === current.id
              return (
                <button
                  key={app.id}
                  onClick={() => go(app)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md px-1.5 py-2.5 text-center transition-colors",
                    active ? "bg-zinc-100" : "hover:bg-zinc-50",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-9 items-center justify-center rounded-md border",
                      active
                        ? "border-brand-200 bg-brand-50 text-brand-700"
                        : "border-zinc-200 bg-white text-zinc-600",
                    )}
                  >
                    <app.icon className="size-4" strokeWidth={1.75} aria-hidden />
                  </span>
                  <span
                    className={cn(
                      "text-[11px] font-medium leading-tight",
                      active ? "text-zinc-900" : "text-zinc-600",
                    )}
                  >
                    {t(app.name)}
                  </span>
                </button>
              )
            })}
          </div>
          <NavLink
            to="/apps"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-md px-3 py-2 text-center text-xs font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
          >
            {t("View all apps")}
          </NavLink>
        </div>
      )}
    </div>
  )
}

/** The rail's header: which app you are in, and the way to the others. It
 *  used to be a static label styled like a nav item, so it invited a click
 *  that did nothing. */
function SidebarAppMenu({ apps, current }: { apps: AppDef[]; current: AppDef }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, open, () => setOpen(false))
  const go = useOpenApp(() => setOpen(false))
  const canSwitch = apps.length > 1

  const face = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
        <current.icon className="size-4" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
        {t(current.name)}
      </span>
    </>
  )

  if (!canSwitch)
    return (
      <div className="mb-4 flex items-center gap-2.5 px-1.5 py-1.5" data-tour="app-menu">
        {face}
      </div>
    )

  return (
    <div className="relative mb-4" ref={ref} data-tour="app-menu">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("Switch app")}
        className="flex w-full items-center gap-2.5 rounded-lg border border-zinc-200 bg-white px-1.5 py-1.5 text-left shadow-xs hover:bg-zinc-50"
      >
        {face}
        <ChevronsUpDown className="mr-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("Switch app")}
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-lg ring-1 ring-black/5"
        >
          {apps.map((app) => {
            const active = app.id === current.id
            return (
              <button
                key={app.id}
                role="menuitem"
                onClick={() => go(app)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                  active
                    ? "bg-zinc-100 font-semibold text-zinc-900"
                    : "font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900",
                )}
              >
                <app.icon
                  className={cn("size-4 shrink-0", active ? "text-brand-600" : "text-zinc-400")}
                  strokeWidth={1.75}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{t(app.name)}</span>
                {active && <Check className="size-4 shrink-0 text-brand-600" aria-hidden />}
              </button>
            )
          })}
          <div className="my-1 border-t border-zinc-200" />
          <NavLink
            to="/apps"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm font-medium text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
          >
            <LayoutGrid className="size-4 shrink-0 text-zinc-400" strokeWidth={1.75} aria-hidden />
            {t("View all apps")}
          </NavLink>
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { user, roles, signOut } = useAuth()
  const { t } = useT()
  const location = useLocation()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<BookingInitial | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [properties, setProperties] = useState<PropertyRow[]>([])
  const [property, setProperty] = useState(getCurrentProperty())
  const [demoMode, setDemoMode] = useState(false)
  const [build, setBuild] = useState<string | null>(null)
  useEffect(() => {
    getSiteInfo().then((info) => setBuild(versionLabel(info)))
  }, [])
  // below lg the sidebar is a drawer behind the menu button
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => setNavOpen(false), [location.pathname])
  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false)
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navOpen])

  useEffect(() => {
    myProperties().then((props) => {
      setProperties(props)
      if (props.length === 0) {
        // Fresh install / Frappe Cloud: force setup wizard, not empty Desk.
        if (
          location.pathname !== "/setup" &&
          !location.pathname.startsWith("/setup/")
        ) {
          navigate("/setup", { replace: true })
        }
        return
      }
      if (!props.some((p) => p.name === getCurrentProperty())) {
        setCurrentProperty(props[0].name)
        setProperty(props[0].name)
      }
    })
    call<{ demo_mode: boolean }>("kamra.public_api.site_info")
      .then((info) => setDemoMode(info.demo_mode))
      .catch(() => setDemoMode(false))
  }, [location.pathname, navigate])

  useEffect(() => subscribeRealtime(() => setRefreshKey((k) => k + 1)), [])

  // currency symbol + number locale follow the property's country pack
  useEffect(() => {
    loadLocale().then(() => setRefreshKey((k) => k + 1))
  }, [property])

  function switchProperty(name: string) {
    setCurrentProperty(name)
    setProperty(name)
  }

  // which parts of the product this property runs - undefined until it
  // answers, so nothing flashes in and then disappears
  const [modules, setModules] = useState<string[] | undefined>(undefined)
  useEffect(() => {
    const load = () =>
      enabledModules()
        .then(setModules)
        .catch(() => setModules(undefined))
    load()
    // Settings → Modules switches one on or off without a reload
    window.addEventListener("kamra:modules-changed", load)
    return () => window.removeEventListener("kamra:modules-changed", load)
  }, [property])

  // the in-app assistant runs only where GARP switched it on for the site
  const [aiAllowed, setAiAllowed] = useState(false)
  useEffect(() => {
    call<{ allowed?: boolean }>("kamra.assistant.assistant_status", { property: getCurrentProperty() })
      .then((s) => setAiAllowed(s.allowed !== false))
      .catch(() => setAiAllowed(false))
  }, [property])

  const apps = visibleApps(roles, modules)
  const routeApp = appForPath(location.pathname, apps)
  const currentApp = apps.some((a) => a.id === routeApp.id) ? routeApp : apps[0]
  const floor = location.pathname === "/pos" || location.pathname === "/kitchen"
  // The till and the kitchen pass need the full width on a 1024px tablet, so
  // their sidebar stays in the drawer until xl.
  const rail = floor
    ? { show: "xl:sticky xl:top-0 xl:block xl:h-screen xl:overflow-y-auto", hide: "xl:hidden" }
    : { show: "lg:sticky lg:top-0 lg:block lg:h-screen lg:overflow-y-auto", hide: "lg:hidden" }
  const { on: kiosk } = useKiosk()
  const canBook = BOOKING_ROLES.some((r) => roles.includes(r))

  const items = (currentApp?.items ?? []).filter(
    (item) =>
      (!item.roles || item.roles.some((r) => roles.includes(r))) &&
      (aiAllowed || item.to !== "/assistant"),
  )

  // Muted icons, dark labels: the eye reads the words, the icon marks the row.
  const itemCls =
    "group flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium"
  const renderItem = (item: AppNavItem) =>
    item.href ? (
      <a
        key={item.href}
        href={item.href}
        target="_blank"
        rel="noreferrer"
        title={t("Opens in a new tab")}
        className={cn(itemCls, "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900")}
      >
        <item.icon
          className="size-4 shrink-0 text-zinc-400 group-hover:text-zinc-600"
          strokeWidth={1.75}
          aria-hidden
        />
        <span className="truncate">{t(item.label)}</span>
        <ArrowUpRight
          className="ml-auto size-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-500"
          aria-hidden
        />
      </a>
    ) : (
      <NavLink
        key={item.to}
        to={item.to!}
        end={item.to === "/"}
        className={({ isActive }) =>
          cn(
            itemCls,
            isActive
              ? "bg-brand-50 text-brand-700"
              : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
          )
        }
      >
        {({ isActive }) => (
          <>
            <item.icon
              className={cn(
                "size-4 shrink-0",
                isActive ? "text-brand-600" : "text-zinc-400 group-hover:text-zinc-600",
              )}
              strokeWidth={1.75}
              aria-hidden
            />
            <span className="truncate" title={t(item.label)}>{t(item.label)}</span>
          </>
        )}
      </NavLink>
    )

  // consecutive items that share a `group` form one labelled section
  const sections: { label?: string; items: AppNavItem[] }[] = []
  for (const item of items) {
    const last = sections[sections.length - 1]
    if (last && last.label === item.group) last.items.push(item)
    else sections.push({ label: item.group, items: [item] })
  }

  const sidebar = (
    <div className="flex min-h-full flex-col">
      <NavLink
        to="/"
        end
        aria-label={t("Home")}
        className="mb-5 flex items-center gap-2.5 rounded-lg px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        <img src={asset("kamra-mark.svg")} alt="" className="size-7" aria-hidden />
        {/* Stacked: "BizConnect.id HOTEL" on one line crowds the rail. */}
        <span className="flex flex-col leading-none text-zinc-900">
          <span className="text-base font-semibold tracking-tight">
            BizConnect<span className="text-brand-600">.id</span>
          </span>
          <span className="mt-1 text-[10px] font-semibold tracking-[0.2em] text-brand-600">
            HOTEL
          </span>
        </span>
      </NavLink>

      {currentApp && <SidebarAppMenu apps={apps} current={currentApp} />}

      <nav aria-label={currentApp ? t(currentApp.name) : undefined} data-tour="nav">
        {sections.map((sec, i) => (
          <div key={sec.label ?? `top-${i}`} className={i > 0 ? "mt-5" : undefined}>
            {sec.label && (
              <div className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
                {t(sec.label)}
              </div>
            )}
            <div className="space-y-0.5">{sec.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className="mt-auto pt-6">
        <button
          type="button"
          data-tour="guides"
          onClick={() => {
            setNavOpen(false)
            openGuides()
          }}
          className={cn(itemCls, "w-full text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900")}
        >
          <GraduationCap
            className="size-4 shrink-0 text-zinc-400 group-hover:text-zinc-600"
            strokeWidth={1.75}
            aria-hidden
          />
          <span className="truncate">{t("Guides")}</span>
        </button>
        <div className="mt-1">
          <AlertSettings />
        </div>
        {build ? (
          <p
            className="truncate px-2.5 pt-2 text-[11px] text-zinc-400"
            title={t("The version this site is running")}
          >
            {BRAND_NAME} v{build}
          </p>
        ) : null}
      </div>
    </div>
  )

  return (
    // Floor pages (POS / Kitchen) get a bounded frame at lg+ so only pane
    // content scrolls; everything else keeps normal page flow.
    <div className={cn("flex min-h-screen flex-col", floor && "lg:h-screen")}>
      <NotificationHost />
      {demoMode && !kiosk && (
        <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          {t("Shared playground, not your hotel. Data is wiped every night.")}
        </div>
      )}
      {!kiosk && !demoMode && <UpdateNag />}
      {!kiosk && !demoMode && <SetupNag />}
      <div className="flex min-h-0 flex-1">
      {!kiosk && (
      <aside className={cn("hidden w-60 shrink-0 border-r border-zinc-200 bg-white px-3 py-5", rail.show)}>
        {sidebar}
      </aside>
      )}

      {!kiosk && navOpen && (
        <div className={cn("fixed inset-0 z-50", rail.hide)} role="dialog" aria-modal="true" aria-label={t("Menu")}>
          <div
            className="absolute inset-0 bg-black/40 animate-[fade-in_150ms_ease-out]"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[85vw] flex-col overflow-y-auto bg-white px-3 py-5 shadow-xl">
            <button
              onClick={() => setNavOpen(false)}
              aria-label={t("Close menu")}
              className="absolute right-2 top-4 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <X className="size-4" aria-hidden />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        {!kiosk && (
        <header className="sticky top-0 z-40 flex min-w-0 items-center gap-2 border-b border-zinc-200 bg-white/90 px-3 py-2.5 backdrop-blur sm:px-4">
          <button
            onClick={() => setNavOpen(true)}
            data-tour="menu-button"
            aria-label={t("Open menu")}
            className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800", rail.hide)}
          >
            <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          <AppSwitcher apps={apps} current={currentApp ?? apps[0]} className={rail.hide} />
          {properties.length > 1 ? (
            <select
              className="min-w-[5rem] max-w-[10rem] truncate rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-medium focus:outline-2 focus:outline-brand-600 sm:max-w-[15rem] xl:max-w-[18rem]"
              value={property}
              onChange={(e) => switchProperty(e.target.value)}
              data-tour="property"
              aria-label={t("Property")}
              title={properties.find((p) => p.name === property)?.property_name}
            >
              {properties.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.property_name}
                  {p.city ? ` · ${p.city}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium text-zinc-600">
              {properties[0]?.property_name ?? ""}
            </span>
          )}
          <div className="flex min-w-0 flex-1 justify-center px-1 lg:px-2">
            <div className="hidden w-full max-w-md md:block" data-tour="search">
              <SearchShortcut />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => window.dispatchEvent(new Event("kamra:open-palette"))}
              data-tour="search"
              aria-label={t("Open search")}
              className="flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:hidden"
            >
              <Search className="size-4" aria-hidden />
            </button>
            <ThemeToggle />
            <UserMenu user={user ?? ""} onSignOut={signOut} />
            {canBook && (
              <div className="flex items-center gap-1.5 sm:gap-2" data-tour="booking-buttons">
                <Button
                  variant="outline"
                  className="max-md:hidden"
                  onClick={() => setBooking({ walkIn: true })}
                >
                  {t("Walk-in")}
                </Button>
                <Button
                  onClick={() => setBooking({})}
                  data-tour="new-booking"
                  aria-label={t("New booking")}
                  title={t("New booking")}
                  className="max-sm:px-2"
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t("New booking")}</span>
                </Button>
              </div>
            )}
          </div>
        </header>
        )}

        <main
          key={property}
          className={
            floor
              ? cn(
                  "max-w-none",
                  kiosk
                    ? "h-[100dvh] overflow-hidden p-0"
                    : "min-h-[calc(100dvh-3.5rem)] overflow-auto p-3 lg:min-h-0 lg:flex-1 lg:overflow-hidden",
                )
              : "mx-auto w-full min-w-0 max-w-6xl px-3 py-5 sm:px-4 sm:py-6"
          }
        >
          <Outlet
            context={
              {
                refreshKey,
                canBook,
                modules,
                openBooking: (initial) => {
                  if (canBook) setBooking(initial)
                },
              } satisfies ShellContext
            }
          />
        </main>
      </div>

      {/* Never float over the till / kitchen pass in focus mode. */}
      {!kiosk && (
        <Suspense fallback={null}>
          <HelpPanel />
          <CommandPalette />
        </Suspense>
      )}
      {user && (
        <GuidedTours
          user={user}
          roles={roles}
          modules={modules}
          canBook={canBook}
          multiProperty={properties.length > 1}
          kiosk={kiosk}
          railFrom={floor ? "xl" : "lg"}
        />
      )}

      {booking && canBook && (
        <Suspense fallback={null}>
          <BookingDialog
            initial={booking}
            onClose={() => setBooking(null)}
            onBooked={() => setRefreshKey((k) => k + 1)}
          />
        </Suspense>
      )}

    </div>
    </div>
  )
}
