import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { Check, Compass, GraduationCap } from "lucide-react"
import { Button } from "../components/ui/button"
import { Sheet } from "../components/ui/sheet"
import { APPS, visibleApps } from "../lib/apps"
import { call } from "../lib/api"
import { t as translate, useT } from "../lib/i18n"
import { cn } from "../lib/utils"
import { TOURS, tourById } from "./definitions"
import { OPEN_GUIDES, START_TOUR } from "./events"
import type { Tour, TourContext, TourState, TourStatus } from "./types"

/*  The tour host, mounted once in AppShell: the Guides list, the "take the
    tour?" card on a page's first visit, and the tour that's running.
    Progress is kept per user on the server (kamra.tours) and cached in
    localStorage so the card doesn't wait on the network. */

type Base = Omit<TourContext, "rail">

const EMPTY: TourState = { tours: {}, offers: true }
// a tour to pick up after reloading onto a newer build
const RESUME_KEY = "kamra_tour_resume"
// the page settles before anything is suggested
const OFFER_DELAY_MS = 1200

const cacheKey = (user: string) => `kamra_tours:${user}`

function readCache(user: string): TourState | null {
  try {
    const raw = localStorage.getItem(cacheKey(user))
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<TourState>) } : null
  } catch {
    return null
  }
}

function writeCache(user: string, s: TourState) {
  try {
    localStorage.setItem(cacheKey(user), JSON.stringify(s))
  } catch {
    // private window or storage full: the server copy still holds
  }
}

/** Tours for the apps and pages this person can open. */
function availableTours(base: Base, modules?: string[]): Tour[] {
  const apps = visibleApps(base.roles, modules)
  return TOURS.filter((tour) => {
    if (tour.when && !tour.when(base)) return false
    if (!tour.app) return true
    const app = apps.find((a) => a.id === tour.app)
    if (!app) return false
    const item = tour.route ? app.items.find((i) => i.to === tour.route) : undefined
    return !item?.roles || item.roles.some((r) => base.roles.includes(r))
  })
}

interface Offer {
  tour: Tour
  kind: "welcome" | "page" | "next"
}

export default function GuidedTours(props: {
  user: string
  roles: string[]
  modules?: string[]
  canBook: boolean
  multiProperty: boolean
  kiosk: boolean
  /** Floor pages keep the rail in the drawer until xl. */
  railFrom: "lg" | "xl"
}) {
  const { t } = useT()
  const navigate = useNavigate()
  const path = useLocation().pathname
  const pathRef = useRef(path)
  pathRef.current = path

  const [state, setState] = useState<TourState | null>(() => readCache(props.user))
  const stateRef = useRef(state)
  stateRef.current = state
  const [loaded, setLoaded] = useState(false)
  const [hub, setHub] = useState(false)
  const [running, setRunning] = useState<string | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const offered = useRef(new Set<string>())
  // after "Not now" or a tour ends, suggest nothing more until they move on
  const quiet = useRef(false)
  const stopRef = useRef<(() => void) | null>(null)
  const unmounting = useRef(false)
  const resumed = useRef(false)

  const base = useMemo<Base>(
    () => ({
      roles: props.roles,
      canBook: props.canBook,
      multiProperty: props.multiProperty,
      multiApp: visibleApps(props.roles, props.modules).length > 1,
    }),
    [props.roles, props.canBook, props.multiProperty, props.modules],
  )
  const baseRef = useRef(base)
  baseRef.current = base
  const tours = useMemo(() => availableTours(base, props.modules), [base, props.modules])
  const toursRef = useRef(tours)
  toursRef.current = tours

  useEffect(() => {
    let cancelled = false
    call<TourState>("kamra.tours.tour_state")
      .then((s) => {
        if (cancelled) return
        setState(s)
        writeCache(props.user, s)
      })
      .catch(() => {
        if (!cancelled) setState((cur) => cur ?? EMPTY)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [props.user])

  const update = useCallback(
    (fn: (s: TourState) => TourState) => {
      setState((cur) => {
        const next = fn(cur ?? EMPTY)
        writeCache(props.user, next)
        return next
      })
    },
    [props.user],
  )

  const record = useCallback(
    (id: string, status: TourStatus) => {
      const version = tourById(id)?.version ?? 1
      update((s) => {
        // closing a tour you once finished doesn't un-finish it
        const kept = s.tours[id]?.s === "done" ? "done" : status
        return { ...s, tours: { ...s.tours, [id]: { s: kept, v: version } } }
      })
      call("kamra.tours.save_tour", { tour: id, status, version }).catch(() => {})
    },
    [update],
  )

  const start = useCallback(
    async (id: string) => {
      const tour = tourById(id)
      if (!tour) return
      stopRef.current?.()
      setOffer(null)
      setHub(false)
      setRunning(id)
      let engine: typeof import("./engine")
      try {
        engine = await import("./engine")
      } catch {
        setRunning(null)
        // A tab older than the last deploy asks for an engine chunk that is
        // gone. Reload onto the new build once and start the tour there.
        if (resumed.current) return
        try {
          sessionStorage.setItem(RESUME_KEY, id)
          window.location.reload()
        } catch {
          // no session storage: leave it to the person to reload
        }
        return
      }
      const { runTour, findAnchor } = engine
      // let the Guides sheet unmount before anything is measured
      await new Promise((r) => window.setTimeout(r, 60))
      stopRef.current = runTour(tour, {
        ctx: { ...baseRef.current, rail: !!findAnchor("nav") },
        t: translate,
        path: () => pathRef.current,
        navigate: (to) => navigate(to),
        onEnd: (finished) => {
          stopRef.current = null
          if (unmounting.current) return
          quiet.current = true
          setRunning(null)
          record(id, finished ? "done" : "dismissed")
          if (!finished) return
          const seen = stateRef.current?.tours ?? {}
          const next = (tour.next ?? [])
            .map((n) => toursRef.current.find((x) => x.id === n))
            .find((x) => x && !seen[x.id])
          if (next) setOffer({ tour: next, kind: "next" })
        },
      })
    },
    [navigate, record],
  )

  useEffect(() => {
    const onOpen = () => setHub(true)
    const onStart = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (id) void start(id)
    }
    window.addEventListener(OPEN_GUIDES, onOpen)
    window.addEventListener(START_TOUR, onStart)
    return () => {
      window.removeEventListener(OPEN_GUIDES, onOpen)
      window.removeEventListener(START_TOUR, onStart)
    }
  }, [start])

  // the tour a reload was for (see start)
  useEffect(() => {
    if (resumed.current) return
    let id: string | null = null
    try {
      id = sessionStorage.getItem(RESUME_KEY)
      sessionStorage.removeItem(RESUME_KEY)
    } catch {
      return
    }
    if (!id) return
    resumed.current = true
    void start(id)
  }, [start])

  useEffect(() => {
    // StrictMode mounts twice in dev: re-arm after the first teardown
    unmounting.current = false
    return () => {
      unmounting.current = true
      stopRef.current?.()
    }
  }, [])

  // a page's suggestion belongs to that page
  useEffect(() => {
    quiet.current = false
    setOffer((o) => (o?.kind === "page" && o.tour.route !== path ? null : o))
  }, [path])

  useEffect(() => {
    if (!loaded || !state?.offers || props.kiosk || running || hub || offer) return
    if (quiet.current) return
    if (path === "/setup" || path.startsWith("/setup/")) return
    const timer = window.setTimeout(() => {
      const fresh = (x: Tour) => !state.tours[x.id] && !offered.current.has(x.id)
      const welcome = tours.find((x) => x.id === "welcome")
      // nothing else is suggested until the welcome tour is taken or waved off
      if (welcome && !state.tours.welcome) {
        if (fresh(welcome)) {
          offered.current.add(welcome.id)
          setOffer({ tour: welcome, kind: "welcome" })
        }
        return
      }
      const page = tours.find((x) => x.route === path && fresh(x))
      if (page) {
        offered.current.add(page.id)
        setOffer({ tour: page, kind: "page" })
      }
    }, OFFER_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [path, loaded, state, props.kiosk, running, hub, offer, tours])

  const setOffers = (on: boolean) => {
    update((s) => ({ ...s, offers: on }))
    call("kamra.tours.set_tour_offers", { enabled: on ? 1 : 0 }).catch(() => {})
  }

  const reset = () => {
    if (!window.confirm(t("Forget which tours you have taken? Each one will be suggested again.")))
      return
    offered.current.clear()
    update(() => EMPTY)
    call("kamra.tours.reset_tours").catch(() => {})
  }

  return (
    <>
      {offer && !running && !hub && !props.kiosk && (
        <OfferCard
          offer={offer}
          railFrom={props.railFrom}
          onStart={() => void start(offer.tour.id)}
          onDismiss={() => {
            record(offer.tour.id, "dismissed")
            quiet.current = true
            setOffer(null)
          }}
        />
      )}
      {hub && (
        <GuidesSheet
          tours={tours}
          state={state ?? EMPTY}
          path={path}
          onStart={(id) => void start(id)}
          onClose={() => setHub(false)}
          onOffers={setOffers}
          onReset={reset}
        />
      )}
    </>
  )
}

function OfferCard(props: {
  offer: Offer
  railFrom: "lg" | "xl"
  onStart: () => void
  onDismiss: () => void
}) {
  const { t } = useT()
  const { tour, kind } = props.offer
  const title =
    kind === "welcome"
      ? t("New here?")
      : kind === "next"
        ? t("Up next: {title}", { title: t(tour.title) })
        : t("Take the tour: {title}", { title: t(tour.title) })
  const body =
    kind === "welcome"
      ? t("Take a one-minute tour: where the apps, search and bookings are.")
      : t(tour.summary)
  return (
    <div
      role="status"
      className={cn(
        // above the floating help button on a phone, where the two would meet
        "fixed bottom-20 left-5 z-40 w-[22rem] sm:bottom-5 max-w-[calc(100vw-2.5rem)] animate-fade-in rounded-xl border border-zinc-200 bg-white p-4 shadow-lg ring-1 ring-black/5 print:hidden",
        props.railFrom === "lg" ? "lg:left-[16.25rem]" : "xl:left-[16.25rem]",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <GraduationCap className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900">{title}</p>
          <p className="mt-0.5 text-sm text-zinc-500">{body}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={props.onStart}>
              {kind === "welcome" ? t("Show me around") : t("Start tour")}
            </Button>
            <Button variant="ghost" onClick={props.onDismiss}>
              {t("Not now")}
            </Button>
            <span className="ml-auto text-xs text-zinc-400">
              {t("{n} min", { n: tour.minutes })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function GuidesSheet(props: {
  tours: Tour[]
  state: TourState
  path: string
  onStart: (id: string) => void
  onClose: () => void
  onOffers: (on: boolean) => void
  onReset: () => void
}) {
  const { t } = useT()
  const { tours, state } = props
  const done = tours.filter((x) => state.tours[x.id]?.s === "done").length
  const here = tours.filter((x) => x.route === props.path)
  const rest = tours.filter((x) => x.route !== props.path)
  const groups = [
    { id: "start", label: t("Getting started"), items: rest.filter((x) => !x.app) },
    ...APPS.map((app) => ({
      id: app.id,
      label: t(app.name),
      items: rest.filter((x) => x.app === app.id),
    })),
  ].filter((g) => g.items.length > 0)

  const row = (tour: Tour) => (
    <TourRow
      key={tour.id}
      tour={tour}
      status={state.tours[tour.id]}
      onStart={() => props.onStart(tour.id)}
    />
  )

  return (
    <Sheet
      title={t("Guides")}
      description={t("Short walkthroughs of the screens you use.")}
      onClose={props.onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 text-sm text-zinc-600">
            <input
              type="checkbox"
              className="size-4 accent-brand-600"
              checked={state.offers}
              onChange={(e) => props.onOffers(e.target.checked)}
            />
            {t("Suggest a tour on my first visit to a page")}
          </label>
          <button
            type="button"
            onClick={props.onReset}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-800"
          >
            {t("Start over")}
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-zinc-700">{t("Your progress")}</span>
            <span className="tabular-nums text-zinc-500">
              {t("{done} of {total} done", { done, total: tours.length })}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={tours.length}
            aria-valuenow={done}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${tours.length ? (done / tours.length) * 100 : 0}%` }}
            />
          </div>
        </div>

        {here.length > 0 && (
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
              {t("On this page")}
            </h3>
            <ul className="space-y-2">{here.map(row)}</ul>
          </section>
        )}

        {groups.map((g) => (
          <section key={g.id}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
              {g.label}
            </h3>
            <ul className="space-y-2">{g.items.map(row)}</ul>
          </section>
        ))}
      </div>
    </Sheet>
  )
}

function TourRow(props: {
  tour: Tour
  status?: TourState["tours"][string]
  onStart: () => void
}) {
  const { t } = useT()
  const { tour, status } = props
  const done = status?.s === "done"
  const updated = done && (status?.v ?? 1) < tour.version
  const Icon = APPS.find((a) => a.id === tour.app)?.icon ?? Compass
  return (
    <li className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          done ? "bg-emerald-50 text-emerald-700" : "bg-brand-50 text-brand-700",
        )}
      >
        {done ? (
          <Check className="size-4" aria-label={t("Done")} />
        ) : (
          <Icon className="size-4" strokeWidth={1.75} aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-900">
          {t(tour.title)}
          {updated && (
            <span className="ml-2 rounded-full bg-brand-50 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-brand-700">
              {t("Updated")}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500">{t(tour.summary)}</p>
        <p className="mt-1 text-[11px] text-zinc-400">{t("{n} min", { n: tour.minutes })}</p>
      </div>
      <Button
        variant={done ? "outline" : "primary"}
        className="shrink-0"
        onClick={props.onStart}
      >
        {done ? t("Replay") : t("Start")}
      </Button>
    </li>
  )
}
