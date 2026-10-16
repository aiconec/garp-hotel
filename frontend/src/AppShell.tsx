import { useEffect, useRef, useState } from "react"
import {
  LayoutGrid,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Sun,
  X,
} from "lucide-react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"
import { BookingDialog } from "./components/BookingDialog"
import { CommandPalette } from "./components/CommandPalette"
import HelpPanel from "./components/HelpPanel"
import UpdateNag from "./components/UpdateNag"
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
import { useAuth } from "./lib/auth"
import { subscribeRealtime } from "./lib/realtime"
import { getTheme, setTheme } from "./lib/theme"
import { useT } from "./lib/i18n"
import { loadLocale } from "./lib/money"
import { cn } from "./lib/utils"
import { useKiosk } from "./lib/kiosk"

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
}

// mirrors @require_roles on kamra.api.create_booking / walk_in (admins always pass)
const BOOKING_ROLES = [
  "Front Desk",
  "Kamra Agent",
  "Hotel Admin",
  "System Manager",
  "Administrator",
]

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
      <span className="truncate">{t("Search reservations, guests, rooms…")}</span>
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

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false)
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  const initial = (user || "?").trim().charAt(0).toUpperCase()
  return (
    <div className="relative" ref={ref}>
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

/** App switcher in the top bar: quiet grid, one accent for the current app. */
function AppSwitcher({ apps, current }: { apps: AppDef[]; current: AppDef }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  const go = (app: AppDef) => {
    setOpen(false)
    const first = app.items.find((i) => i.to)
    if (first?.to) navigate(first.to)
  }

  return (
    <div className="relative" ref={ref}>
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
    enabledModules()
      .then(setModules)
      .catch(() => setModules(undefined))
  }, [property])

  // the in-app assistant runs only where GARP switched it on for the site
  const [aiAllowed, setAiAllowed] = useState(false)
  useEffect(() => {
    call<{ allowed?: boolean }>("kamra.assistant.assistant_status", { property: getCurrentProperty() })
      .then((s) => setAiAllowed(s.allowed !== false))
      .catch(() => setAiAllowed(false))
  }, [property])

  const apps = visibleApps(roles, modules)
  const routeApp = appForPath(location.pathname)
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

  const renderItem = (item: AppNavItem) =>
    item.href ? (
      <a
        key={item.href}
        href={item.href}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
      >
        <item.icon className="size-4" aria-hidden />
        {t(item.label)}
      </a>
    ) : (
      <NavLink
        key={item.to}
        to={item.to!}
        end={item.to === "/"}
        className={({ isActive }) =>
          cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium",
            isActive
              ? "bg-brand-50 text-brand-700"
              : "text-zinc-600 hover:bg-zinc-100",
          )
        }
      >
        <item.icon className="size-4" aria-hidden />
        {t(item.label)}
      </NavLink>
    )

  const sidebar = (
    <>
      <div className="mb-5 flex items-center gap-2 px-1">
        <img src={asset("kamra-mark.svg")} alt="" className="size-7" aria-hidden />
        {/* Stacked: "BizConnect.id HOTEL" on one line overflows the w-52 rail. */}
        <span className="flex flex-col leading-none">
          <span className="text-base font-semibold tracking-tight">
            BizConnect<span className="text-brand-600">.id</span>
          </span>
          <span className="mt-1 text-[10px] font-semibold tracking-[0.2em] text-brand-600">
            HOTEL
          </span>
        </span>
      </div>

      {currentApp && (
        <div className="mb-2 flex items-center gap-2 rounded-lg px-2 py-1.5">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-md",
              currentApp.tint,
            )}
          >
            <currentApp.icon className="size-3.5" aria-hidden />
          </span>
          <span className="text-sm font-semibold text-zinc-800">
            {t(currentApp.name)}
          </span>
        </div>
      )}

      <nav className="space-y-0.5">
        {(() => {
          const groups: { label?: string; items: typeof items }[] = []
          for (const item of items) {
            const g = item.group
            const last = groups[groups.length - 1]
            if (!last || last.label !== g) {
              groups.push({ label: g, items: [item] })
            } else {
              last.items.push(item)
            }
          }
          return groups.map((g, gi) => (
            <div key={g.label ?? `ungrouped-${gi}`} className={gi > 0 ? "mt-3" : undefined}>
              {g.label ? (
                <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
                  {t(g.label)}
                </div>
              ) : null}
              <div className="space-y-0.5">{g.items.map(renderItem)}</div>
            </div>
          ))
        })()}
      </nav>
    </>
  )

  return (
    // Floor pages (POS / Kitchen) get a bounded frame at lg+ so only pane
    // content scrolls; everything else keeps normal page flow.
    <div className={cn("flex min-h-screen flex-col", floor && "lg:h-screen")}>
      {demoMode && !kiosk && (
        <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950">
          {t("Shared playground — not your hotel. Data is wiped every night.")}
        </div>
      )}
      {!kiosk && !demoMode && <UpdateNag />}
      <div className="flex min-h-0 flex-1">
      {!kiosk && (
      <aside className={cn("hidden w-52 shrink-0 border-r border-zinc-200 bg-white px-3 py-5", rail.show)}>
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
            aria-label={t("Open menu")}
            className={cn("flex size-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800", rail.hide)}
          >
            <Menu className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
          <AppSwitcher apps={apps} current={currentApp ?? apps[0]} />
          {properties.length > 1 ? (
            <select
              className="min-w-[5rem] max-w-[10rem] truncate rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm font-medium focus:outline-2 focus:outline-brand-600 sm:max-w-[15rem] xl:max-w-[18rem]"
              value={property}
              onChange={(e) => switchProperty(e.target.value)}
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
            <div className="hidden w-full max-w-md md:block">
              <SearchShortcut />
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button
              onClick={() => window.dispatchEvent(new Event("kamra:open-palette"))}
              aria-label={t("Open search")}
              className="flex size-8 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 md:hidden"
            >
              <Search className="size-4" aria-hidden />
            </button>
            <ThemeToggle />
            <UserMenu user={user ?? ""} onSignOut={signOut} />
            {canBook && (
              <>
                <Button
                  variant="outline"
                  className="max-md:hidden"
                  onClick={() => setBooking({ walkIn: true })}
                >
                  {t("Walk-in")}
                </Button>
                <Button
                  onClick={() => setBooking({})}
                  aria-label={t("New booking")}
                  title={t("New booking")}
                  className="max-sm:px-2"
                >
                  <Plus className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t("New booking")}</span>
                </Button>
              </>
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
        <>
          <HelpPanel />
          <CommandPalette />
        </>
      )}

      {booking && canBook && (
        <BookingDialog
          initial={booking}
          onClose={() => setBooking(null)}
          onBooked={() => setRefreshKey((k) => k + 1)}
        />
      )}

    </div>
    </div>
  )
}
