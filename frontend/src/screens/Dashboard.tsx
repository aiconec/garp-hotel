import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRealtime } from "../lib/realtime"
import {
  BedDouble, LogIn, Users, Banknote, Wallet, Building2, Brush, ReceiptText,
  PieChart, TrendingUp, BarChart3,
} from "lucide-react"
import { call, getCurrentProperty } from "../lib/api"
import { serverError } from "../lib/resource"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { StatCard } from "../components/ui/stat-card"
import { cur, moneyLocale } from "../lib/money"
import { useT } from "../lib/i18n"

const inr = (n: unknown) =>
  Number(n ?? 0).toLocaleString(moneyLocale(), { maximumFractionDigits: 0 })

type Preset = "today" | "yesterday" | "last7" | "last30" | "month" | "lastMonth" | "custom"

const PRESETS: Preset[] = ["today", "yesterday", "last7", "last30", "month", "lastMonth", "custom"]

// Dates stay "YYYY-MM-DD" strings; arithmetic runs in UTC so no timezone
// can shift a day.
const iso = (d: Date) => d.toISOString().slice(0, 10)
const utc = (s: string) => new Date(s + "T00:00:00Z")
function addDays(s: string, n: number) {
  const d = utc(s)
  d.setUTCDate(d.getUTCDate() + n)
  return iso(d)
}

/** The from..to of a preset, counted back from the server's today. */
function presetRange(p: Exclude<Preset, "custom">, today: string) {
  const d = utc(today)
  const monthStart = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)))
  switch (p) {
    case "today": return { from: today, to: today }
    case "yesterday": return { from: addDays(today, -1), to: addDays(today, -1) }
    case "last7": return { from: addDays(today, -6), to: today }
    case "last30": return { from: addDays(today, -29), to: today }
    case "month": return { from: monthStart, to: today }
    case "lastMonth": return {
      from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))),
      to: addDays(monthStart, -1),
    }
  }
}

function rangeLabel(from: string, to: string) {
  const f = (s: string, year: boolean) =>
    utc(s).toLocaleDateString(moneyLocale(), {
      day: "numeric", month: "short", timeZone: "UTC",
      ...(year ? { year: "numeric" } : {}),
    })
  return from === to ? f(to, true) : `${f(from, from.slice(0, 4) !== to.slice(0, 4))} – ${f(to, true)}`
}

interface Period {
  from_date: string
  to_date: string
  days: number
  room_nights: number
  occupancy_pct: number
  room_revenue: number
  fnb_revenue: number
  other_revenue: number
  revenue: number
  adr: number
  revpar: number
  collections: number
}

interface PropDash {
  property_name: string
  date: string
  total_rooms: number
  occupancy_pct: number
  arrivals: number
  departures: number
  in_house: number
  no_shows: number
  revenue_today: number
  collections_today: number
  statistics: {
    mtd_occupancy_pct: number
    mtd_revenue: number
    adr: number
    revpar: number
    rooms_sold_mtd: number
  }
  housekeeping: {
    room_status: Record<string, number>
    occupied: number
    vacant: number
    open_tasks: number
    overdue_tasks: number
  }
  finance: {
    collections_today: number
    outstanding: number
    open_folios: number
  }
  period: Period
}

interface Portfolio {
  date: string
  from_date: string
  to_date: string
  totals: {
    properties: number
    total_rooms: number
    occupancy_pct: number
    arrivals: number
    departures: number
    in_house: number
    revenue: number
    collections: number
    outstanding: number
  }
  properties: {
    property: string
    property_name: string
    total_rooms: number
    occupancy_pct: number
    arrivals: number
    departures: number
    in_house: number
    revenue: number
    collections: number
    outstanding: number
  }[]
}

function Tile({ icon: Icon, label, value, sub, tone }: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  tone?: string
}) {
  return (
    <StatCard
      icon={<Icon className="size-4" />}
      label={label}
      value={value}
      sub={sub}
      accent={tone === "text-brand-600"}
    />
  )
}

export default function Dashboard() {
  const { t } = useT()
  const [scope, setScope] = useState<"property" | "portfolio">("property")
  const [multi, setMulti] = useState(false)
  const [prop, setProp] = useState<PropDash | null>(null)
  const [port, setPort] = useState<Portfolio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preset, setPreset] = useState<Preset>("today")
  const [custom, setCustom] = useState({ from: "", to: "" })
  // The server's date, so presets count from the hotel's today, not the
  // browser's. Until the first answer, the browser's will do.
  const [serverToday, setServerToday] = useState<string | null>(null)
  const today = serverToday ?? iso(new Date())

  const range = useMemo(
    () => (preset === "custom" ? custom : presetRange(preset, today)),
    [preset, custom, today],
  )
  const isToday = preset === "today"
  // [option in the picker, what the tiles say the number covers]
  const presetText: Record<Preset, [string, string]> = {
    today: [t("Today"), t("today")],
    yesterday: [t("Yesterday"), t("yesterday")],
    last7: [t("Last 7 days"), t("last 7 days")],
    last30: [t("Last 30 days"), t("last 30 days")],
    month: [t("This month"), t("month to date")],
    lastMonth: [t("Last month"), t("last month")],
    custom: [t("Custom range"), rangeLabel(range.from, range.to)],
  }
  const period = presetText[preset][1]

  function pickDate(which: "from" | "to", value: string) {
    if (!value) return
    const next = { ...range, [which]: value }
    // keep the range the right way round: moving one end past the other
    // drags the other along
    if (next.from > next.to) {
      if (which === "from") next.to = next.from
      else next.from = next.to
    }
    setCustom(next)
    setPreset("custom")
  }

  useEffect(() => {
    call<{ name: string }[]>("kamra.api.my_properties")
      .then((p) => setMulti((p?.length ?? 0) > 1))
      .catch(() => setMulti(false))
  }, [])

  // "Today" sends no dates and lets the server pick its own today.
  const from = isToday ? undefined : range.from
  const to = isToday ? undefined : range.to
  // Only the latest request may land: a slow answer for the period picked
  // before must not overwrite the one picked after.
  const seq = useRef(0)
  const load = useCallback(() => {
    const n = ++seq.current
    const latest = () => n === seq.current
    setError(null)
    const dates = from && to ? { from_date: from, to_date: to } : {}
    if (scope === "property") {
      call<PropDash>("kamra.dashboards.property_dashboard", {
        property: getCurrentProperty(), ...dates,
      }).then((d) => { if (latest()) { setProp(d); setServerToday(d.date) } })
        .catch((e) => { if (latest()) setError(serverError(e)) })
    } else {
      call<Portfolio>("kamra.dashboards.portfolio_dashboard", dates)
        .then((d) => { if (latest()) { setPort(d); setServerToday(d.date) } })
        .catch((e) => { if (latest()) setError(serverError(e)) })
    }
  }, [scope, from, to])
  useEffect(load, [load])
  useRealtime(load)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">{t("Dashboard")}</h1>
          <p className="text-xs text-zinc-500">
            {scope === "property"
              ? isToday
                ? t("Today at this property, by department.")
                : t("This property, by department.")
              : t("The whole portfolio at a glance.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <select
              className={dateCls}
              value={preset}
              onChange={(e) => {
                const p = e.target.value as Preset
                // "Custom range" starts from whatever is showing now
                if (p === "custom") setCustom(range)
                setPreset(p)
              }}
              aria-label={t("Period")}
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>{presetText[p][0]}</option>
              ))}
            </select>
            <div className="flex items-center gap-1.5">
              <input type="date" className={dateCls} value={range.from}
                onChange={(e) => pickDate("from", e.target.value)} aria-label={t("From")} />
              <span className="text-zinc-400">→</span>
              <input type="date" className={dateCls} value={range.to}
                onChange={(e) => pickDate("to", e.target.value)} aria-label={t("To")} />
            </div>
          </div>
          {multi && (
            <div className="flex rounded-lg border border-zinc-200 bg-white p-0.5 text-sm">
              {(["property", "portfolio"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={
                    "rounded-md px-3 py-1.5 font-medium " +
                    (scope === s ? "bg-brand-600 text-white" : "text-zinc-600")
                  }
                >
                  {s === "property" ? t("This property") : t("All properties")}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      {scope === "property" && prop && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Tile icon={PieChart} label={t("Occupancy")} value={`${prop.period.occupancy_pct}%`}
              sub={isToday ? t("{n} rooms", { n: prop.total_rooms }) : period} tone="text-brand-600" />
            <Tile icon={TrendingUp} label={t("ADR")} value={`${cur()}${inr(prop.period.adr)}`}
              sub={period} />
            <Tile icon={BarChart3} label={t("RevPAR")} value={`${cur()}${inr(prop.period.revpar)}`}
              sub={period} />
            <Tile icon={Banknote} label={t("Revenue")} value={`${cur()}${inr(prop.period.revenue)}`}
              sub={period} />
            <Tile icon={Wallet} label={t("Collections")} value={`${cur()}${inr(prop.period.collections)}`}
              sub={period} />
            <Tile icon={ReceiptText} label={t("Outstanding")} value={`${cur()}${inr(prop.finance.outstanding)}`}
              sub={t("receivable")} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("Statistics")}</CardTitle>
              <span className="text-xs text-zinc-400">{rangeLabel(prop.period.from_date, prop.period.to_date)}</span>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                {[
                  [t("Rooms sold"), inr(prop.period.room_nights)],
                  [t("Room revenue"), `${cur()}${inr(prop.period.room_revenue)}`],
                  [t("F&B revenue"), `${cur()}${inr(prop.period.fnb_revenue)}`],
                  [t("Other revenue"), `${cur()}${inr(prop.period.other_revenue)}`],
                  [t("Total revenue"), `${cur()}${inr(prop.period.revenue)}`],
                ].map(([k, v]) => (
                  <div key={String(k)}>
                    <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">{k}</div>
                    <div className="mt-0.5 text-lg font-semibold text-zinc-800">{v}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><Brush className="size-4 text-brand-600" />{t("Housekeeping")}</CardTitle>
                {!isToday && <span className="text-xs text-zinc-400">{t("right now")}</span>}
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <Row label={t("Clean")} value={prop.housekeeping.room_status.Clean ?? 0} />
                <Row label={t("Dirty")} value={prop.housekeeping.room_status.Dirty ?? 0} tone={prop.housekeeping.room_status.Dirty ? "text-amber-600" : undefined} />
                <Row label={t("Inspected")} value={prop.housekeeping.room_status.Inspected ?? 0} />
                <Row label={t("Out of order")} value={prop.housekeeping.room_status["Out of Order"] ?? 0} />
                <Row label={t("Open tasks")} value={prop.housekeeping.open_tasks} />
                <Row label={t("Overdue")} value={prop.housekeeping.overdue_tasks} tone={prop.housekeeping.overdue_tasks ? "text-rose-600" : undefined} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-1.5"><ReceiptText className="size-4 text-brand-600" />{t("Finance")}</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <Row label={isToday ? t("Collected today") : t("Collected ({period})", { period })}
                  value={`${cur()}${inr(prop.period.collections)}`} />
                <Row label={t("Outstanding")} value={`${cur()}${inr(prop.finance.outstanding)}`} tone={prop.finance.outstanding ? "text-amber-600" : undefined} />
                <Row label={t("Open folios")} value={prop.finance.open_folios} />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {scope === "portfolio" && port && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Tile icon={Building2} label={t("Properties")} value={String(port.totals.properties)}
              sub={t("{n} rooms", { n: port.totals.total_rooms })} />
            <Tile icon={BedDouble} label={t("Occupancy")} value={`${port.totals.occupancy_pct}%`} sub={period} tone="text-brand-600" />
            <Tile icon={LogIn} label={t("Arrivals")} value={String(port.totals.arrivals)} sub={period} />
            <Tile icon={Users} label={t("In house")} value={String(port.totals.in_house)} sub={t("right now")} />
            <Tile icon={Banknote} label={t("Revenue")} value={`${cur()}${inr(port.totals.revenue)}`} sub={period} />
            <Tile icon={Wallet} label={t("Collections")} value={`${cur()}${inr(port.totals.collections)}`} sub={period} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("By property")}</CardTitle>
              <span className="text-xs text-zinc-400">{rangeLabel(port.from_date, port.to_date)}</span>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-xs font-medium uppercase tracking-wider text-zinc-500">
                      <th className="py-2 pr-3">{t("Property")}</th>
                      <th className="py-2 pr-3 text-right">{t("Occ %")}</th>
                      <th className="py-2 pr-3 text-right">{t("Arr")}</th>
                      <th className="py-2 pr-3 text-right">{t("Dep")}</th>
                      <th className="py-2 pr-3 text-right">{t("In-house")}</th>
                      <th className="py-2 pr-3 text-right">{t("Revenue")}</th>
                      <th className="py-2 pr-3 text-right">{t("Collected")}</th>
                      <th className="py-2 text-right">{t("Outstanding")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {port.properties.map((p) => (
                      <tr key={p.property}>
                        <td className="py-2 pr-3 font-medium">{p.property_name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.occupancy_pct}%</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.arrivals}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.departures}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.in_house}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{cur()}{inr(p.revenue)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{cur()}{inr(p.collections)}</td>
                        <td className="py-2 text-right tabular-nums">{cur()}{inr(p.outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

const dateCls =
  "rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

function Row({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{label}</span>
      <span className={`font-semibold tabular-nums ${tone ?? "text-zinc-800"}`}>{String(value)}</span>
    </div>
  )
}
