import { useCallback, useEffect, useState } from "react"
import {
  BedDouble,
  Camera,
  ClipboardList,
  LogIn,
  LogOut,
  Users,
  Wallet,
  ListChecks,
  PieChart,
} from "lucide-react"
import { useNavigate, useOutletContext } from "react-router-dom"
import {
  call,
  checkOut,
  getCurrentProperty,
  getSnapshot,
  setHousekeepingStatus,
  type ReservationRow,
  type RoomRow,
  type Snapshot,
} from "../lib/api"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card"
import { StatCard } from "../components/ui/stat-card"
import { Avatar } from "../components/ui/avatar"
import { RoomMediaDialog } from "../components/HkMedia"
import { cn } from "../lib/utils"
import type { ShellContext } from "../AppShell"
import CheckInDialog from "../components/CheckInDialog"
import { serverError } from "../lib/resource"
import { toFullPath } from "../lib/routing"
import { cur, moneyLocale } from "../lib/money"
import { useT } from "../lib/i18n"

const HK_STATUSES: RoomRow["housekeeping_status"][] = [
  "Dirty",
  "Clean",
  "Inspected",
  "Out of Order",
]

// same tones as the Housekeeping room board, so a room reads the same on both
const hkTone: Record<RoomRow["housekeeping_status"], string> = {
  Clean: "border-emerald-300 bg-emerald-50 text-emerald-900",
  Inspected: "border-sky-300 bg-sky-50 text-sky-900",
  Dirty: "border-amber-300 bg-amber-50 text-amber-900",
  "Out of Order": "border-rose-300 bg-rose-50 text-rose-900",
}
const hkDot: Record<RoomRow["housekeeping_status"], string> = {
  Clean: "bg-emerald-500",
  Inspected: "bg-sky-500",
  Dirty: "bg-amber-500",
  "Out of Order": "bg-rose-500",
}

const inr0 = (n: number) =>
  Number(n).toLocaleString(moneyLocale(), { maximumFractionDigits: 0 })

/** Paid / due / unpaid at a glance - the folio is the source of truth,
 * this chip just saves the trip to Billing. */
function PaymentChip({ row }: { row: ReservationRow }) {
  const { t } = useT()
  const paid = Number(row.paid_total ?? 0)
  const due = Number(row.balance_due ?? 0)
  if (due <= 0 && paid > 0) return <Badge tone="green">{t("Paid")}</Badge>
  if (paid > 0)
    return (
      <Badge tone="amber">
        {cur()}
        {inr0(due)} {t("due")}
      </Badge>
    )
  if (due > 0) return <Badge tone="zinc">{t("Unpaid")}</Badge>
  return null
}

function SourceBadge({ row }: { row: ReservationRow }) {
  const { t } = useT()
  if (row.source === "AI Agent") return <Badge tone="brand">{t("AI Agent")}</Badge>
  if (row.source === "OTA")
    return <Badge tone="indigo">{row.channel || t("OTA")}</Badge>
  return <Badge tone="zinc">{t(row.source)}</Badge>
}

// Illustrative micro-trend for the KPI sparklines until a history endpoint
// lands; the headline value itself is always real.
const mkTrend = (n: number, up = true) =>
  Array.from({ length: 8 }, (_, i) => {
    const b = Math.max(1, Math.abs(n))
    const t = i / 7
    return b * (0.78 + (up ? t : 1 - t) * 0.3 + Math.sin(i * 1.6) * 0.05)
  })

function ReservationList(props: {
  rows: ReservationRow[]
  empty: string
  action: (row: ReservationRow) => React.ReactNode
}) {
  const { t } = useT()
  if (props.rows.length === 0) {
    return <p className="px-1 py-3 text-sm text-zinc-400">{props.empty}</p>
  }
  return (
    <ul className="divide-y divide-zinc-100">
      {props.rows.map((row) => (
        <li key={row.name} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 truncate text-sm font-medium">
                {row.guest_name}
              </span>
              <SourceBadge row={row} />
              <PaymentChip row={row} />
              {row.precheckin_status === "Submitted" && (
                <Badge tone="green">{t("Pre-checked-in")}</Badge>
              )}
            </div>
            <div className="mt-0.5 text-xs text-zinc-500">
              {row.room
                ? t("Room {n}", { n: row.room.split("-").pop() ?? "" })
                : t("Unassigned")}{" "}
              · {t("{n} night{s}", { n: row.nights, s: row.nights === 1 ? "" : "s" })} ·{" "}
              {t("{n} ad", { n: row.adults })}
              {row.children ? ` + ${row.children} ch` : ""}
              {row.eta && ` · ETA ${row.eta}`}
              {row.booked_by_name && (
                <span
                  title={
                    (row.booked_by_phone
                      ? `${row.booked_by_phone} · `
                      : "") +
                    t("send links & updates to: {pref}", {
                      pref: row.contact_preference ?? "Booker",
                    })
                  }
                >
                  {" "}
                  · {t("via {name}", { name: row.booked_by_name })}
                  {row.booker_relation ? ` (${row.booker_relation})` : ""}
                </span>
              )}
              {row.status === "Confirmed" && (
                <a
                  href={toFullPath(`/grc/${encodeURIComponent(row.name)}`)}
                  className="ml-2 font-medium text-brand-700 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {t("GRC")}
                </a>
              )}
              {row.status === "Confirmed" &&
                row.precheckin_status !== "Submitted" &&
                row.precheckin_token && (
                  <button
                    className="ml-2 font-medium text-brand-700 hover:underline"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard.writeText(
                        window.location.origin + toFullPath(`/checkin/${row.precheckin_token}`),
                      )
                    }}
                    title={
                      row.contact_preference === "Booker" && row.booked_by_name
                        ? t("Copy the self check-in link - send to the booker, {name}{phone}", {
                            name: row.booked_by_name,
                            phone: row.booked_by_phone ? ` (${row.booked_by_phone})` : "",
                          })
                        : row.contact_preference === "Both" && row.booked_by_name
                          ? t("Copy the self check-in link - send to the guest and the booker ({name})", {
                              name: row.booked_by_name,
                            })
                          : t("Copy the self check-in link - send to the guest")
                    }
                  >
                    {t("copy check-in link")}
                  </button>
                )}
            </div>
          </div>
          {props.action(row)}
        </li>
      ))}
    </ul>
  )
}

function ordinalFloor(f: string, t: (s: string, vars?: Record<string, string | number>) => string) {
  const n = Number(f)
  if (Number.isNaN(n)) return t("{f} Floor", { f })
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return t("{n}{ord} Floor", { n, ord: s[(v - 20) % 10] || s[v] || s[0] })
}

function relDay(
  dateStr: string,
  t: (s: string, vars?: Record<string, string | number>) => string,
  today?: string,
) {
  const base = today ? new Date(today + "T00:00:00") : new Date()
  const d = Math.round(
    (new Date(dateStr + "T00:00:00").getTime() - base.getTime()) / 86_400_000,
  )
  if (d <= 0) return t("Today")
  if (d === 1) return t("Tomorrow")
  return t("In {n} days", { n: d })
}

function InHouseTable({
  rows,
  today,
}: {
  rows: ReservationRow[]
  today?: string
}) {
  const { t } = useT()
  const navigate = useNavigate()
  if (!rows.length) {
    return (
      <p className="px-1 py-3 text-sm text-zinc-400">
        {t("Nobody is checked in right now.")}
      </p>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-[11px] font-medium uppercase tracking-wider text-zinc-400">
            <th className="pb-2 pl-1 font-medium">{t("Guest")}</th>
            <th className="pb-2 font-medium">{t("Room")}</th>
            <th className="pb-2 font-medium">{t("Source")}</th>
            <th className="pb-2 font-medium">{t("Balance")}</th>
            <th className="pb-2 font-medium">{t("Stay")}</th>
            <th className="pb-2 pr-1 text-right font-medium">{t("Check-out")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => {
            const due = Number(row.balance_due ?? 0)
            return (
              <tr
                key={row.name}
                onClick={() => navigate(`/grc/${row.name}`)}
                className="cursor-pointer hover:bg-zinc-50/70"
              >
                <td className="py-2.5 pl-1">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={row.guest_name} />
                    <span className="font-medium text-zinc-800">
                      {row.guest_name}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 tabular-nums text-zinc-600">
                  {row.room ? row.room.split("-").pop() : "—"}
                </td>
                <td className="py-2.5">
                  <SourceBadge row={row} />
                </td>
                <td className="py-2.5">
                  {due > 0 ? (
                    <span className="inline-flex items-center gap-1.5 tabular-nums text-zinc-700">
                      {cur()}
                      {inr0(due)}
                      <Badge tone="amber">{t("Due")}</Badge>
                    </span>
                  ) : (
                    <span className="tabular-nums text-zinc-400">{cur()}0</span>
                  )}
                </td>
                <td className="py-2.5 text-zinc-500">
                  {t("{n} night{s}", { n: row.nights, s: row.nights === 1 ? "" : "s" })} ·{" "}
                  {t("{n} adult{s}", { n: row.adults, s: row.adults === 1 ? "" : "s" })}
                </td>
                <td className="py-2.5 pr-1 text-right">
                  <div className="tabular-nums text-zinc-600">
                    {row.check_out_date}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {relDay(row.check_out_date, t, today)}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function Today() {
  const { t } = useT()
  const { refreshKey } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [kpi, setKpi] = useState<any>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [floor, setFloor] = useState("All")
  // room tile menu and the cleaning-photo viewer, by room name
  const [menu, setMenu] = useState<string | null>(null)
  // open the menu leftwards when the tile sits near the right edge
  const [menuRight, setMenuRight] = useState(false)
  const [photos, setPhotos] = useState<string | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return
      if (e instanceof MouseEvent && (e.target as Element).closest?.("[data-room-menu]")) return
      setMenu(null)
    }
    window.addEventListener("mousedown", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("mousedown", close)
      window.removeEventListener("keydown", close)
    }
  }, [menu])

  const refresh = useCallback(async () => {
    try {
      const [s, k] = await Promise.all([
        getSnapshot(),
        call("kamra.dashboards.property_dashboard", {
          property: getCurrentProperty(),
        }).catch(() => null),
      ])
      setSnap(s)
      setKpi(k)
      setError(null)
    } catch (e) {
      setError(serverError(e))
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 30_000)
    return () => clearInterval(t)
  }, [refresh, refreshKey])

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key)
    try {
      await fn()
      await refresh()
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(null)
    }
  }

  const occupied = snap?.rooms.filter(
    (r) => r.occupancy_status === "Occupied",
  ).length
  const occupancyPct = snap?.rooms.length
    ? Math.round(((occupied ?? 0) / snap.rooms.length) * 100)
    : 0
  const arrivalsN = snap?.arrivals.length ?? 0
  const departuresN = snap?.departures.length ?? 0
  const inhouseN = snap?.in_house.length ?? 0
  const roomsN = snap?.rooms.length ?? 0
  const revenue = Number(kpi?.revenue_today ?? 0)
  const revpar = Number(kpi?.statistics?.revpar ?? 0)
  const tasksN = Number(kpi?.housekeeping?.open_tasks ?? 0)
  const overdueN = Number(kpi?.housekeeping?.overdue_tasks ?? 0)
  const allRooms = snap?.rooms ?? []
  const floors = Array.from(
    new Set(allRooms.map((r) => r.floor).filter(Boolean)),
  ).sort() as string[]
  const shownFloors = floor === "All" ? floors : [floor]
  const renderRoom = (room: RoomRow) => {
    const stay = (snap?.in_house ?? []).find((r) => r.room === room.name)
    const dueOut = !!stay && (snap?.departures ?? []).some((r) => r.name === stay.name)
    const isOpen = menu === room.name
    return (
      <div key={room.name} className="relative" data-room-menu>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={isOpen}
          disabled={busy === room.name}
          onClick={(e) => {
            setMenuRight(e.currentTarget.getBoundingClientRect().left > window.innerWidth - 200)
            setMenu(isOpen ? null : room.name)
          }}
          className={cn(
            "w-full cursor-pointer rounded-lg border px-2 pb-1.5 pt-2 text-left transition-transform",
            "hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
            hkTone[room.housekeeping_status],
            busy === room.name && "opacity-60",
          )}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-sm font-semibold">{room.room_number}</span>
            <span className="flex items-center gap-1">
              {dueOut && <LogOut className="size-3.5 text-brand-700" aria-label={t("Due out")} />}
              {stay && <BedDouble className="size-3.5" aria-label={t("Occupied")} />}
            </span>
          </div>
          <div className="mt-0.5 text-[9px] font-medium uppercase tracking-wide opacity-80">
            {t(room.housekeeping_status)}
          </div>
          <div className="mt-0.5 truncate text-[11px] opacity-80">
            {stay ? stay.guest_name : t("Vacant")}
          </div>
        </button>
        {isOpen && (
          <div
            role="menu"
            className={cn(
              "absolute top-full z-20 mt-1 w-max min-w-full overflow-hidden rounded-lg border border-zinc-200 bg-white py-1 shadow-lg",
              menuRight ? "right-0" : "left-0",
            )}
          >
            {HK_STATUSES.filter((s) => s !== room.housekeeping_status).map((s) => (
              <button
                key={s}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  act(room.name, () => setHousekeepingStatus(room.name, s))
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50"
              >
                <span className={cn("size-2 rounded-full", hkDot[s])} aria-hidden />
                {t("Mark {status}", { status: t(s) })}
              </button>
            ))}
            <div className="my-1 border-t border-zinc-100" />
            {stay && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null)
                  navigate(`/grc/${stay.name}`)
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50"
              >
                <ClipboardList className="size-3.5 text-zinc-500" aria-hidden />
                {t("Open registration")}
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(null)
                setPhotos(room.name)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-50"
            >
              <Camera className="size-3.5 text-zinc-500" aria-hidden />
              {t("Cleaning photos")}
            </button>
          </div>
        )}
      </div>
    )
  }
  const hkRoom = kpi?.housekeeping?.room_status ?? {}
  const hkStats = [
    { label: t("Clean"), value: hkRoom.Clean ?? 0, dot: "bg-emerald-500" },
    { label: t("Dirty"), value: hkRoom.Dirty ?? 0, dot: "bg-amber-500" },
    { label: t("Inspected"), value: hkRoom.Inspected ?? 0, dot: "bg-sky-500" },
    {
      label: t("Out of Order"),
      value: hkRoom["Out of Order"] ?? 0,
      dot: "bg-rose-500",
    },
  ]
  const hh = new Date().getHours()
  const greeting =
    hh < 12 ? t("Good morning") : hh < 17 ? t("Good afternoon") : t("Good evening")
  const prettyDate = snap?.date
    ? new Date(snap.date + "T00:00:00").toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : ""

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900">
            {t("Front Desk Overview")}
          </h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            {greeting}. {t("Here's what's happening today.")}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium tabular-nums text-zinc-600">
          {prettyDate}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          icon={<LogIn className="size-4" />}
          label={t("Arrivals")}
          value={arrivalsN}
          spark={mkTrend(arrivalsN)}
        />
        <StatCard
          icon={<LogOut className="size-4" />}
          label={t("Departures")}
          value={departuresN}
          spark={mkTrend(departuresN, false)}
          sparkColor="var(--color-amber-600)"
        />
        <StatCard
          icon={<Users className="size-4" />}
          label={t("In-house")}
          value={inhouseN}
          spark={mkTrend(inhouseN)}
        />
        <StatCard
          icon={<PieChart className="size-4" />}
          label={t("Occupancy")}
          value={`${occupancyPct}%`}
          progress={occupancyPct}
          progressLabel={t("{occupied} of {total} rooms", {
            occupied: occupied ?? 0,
            total: roomsN,
          })}
        />
        <StatCard
          icon={<Wallet className="size-4" />}
          label={t("Revenue")}
          value={`${cur()}${inr0(revenue)}`}
          sub={t("RevPAR {amount}", { amount: `${cur()}${inr0(revpar)}` })}
          spark={mkTrend(revenue)}
        />
        <StatCard
          icon={<ListChecks className="size-4" />}
          label={t("Open tasks")}
          value={tasksN}
          sub={overdueN ? t("{n} overdue", { n: overdueN }) : undefined}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("Arrivals")}</CardTitle>
              <LogIn className="size-4 text-zinc-400" aria-hidden />
            </CardHeader>
            <CardContent className="pt-1">
              <ReservationList
                rows={snap?.arrivals ?? []}
                empty={t("No arrivals expected today.")}
                action={(row) => (
                  <Button
                    disabled={busy === row.name}
                    onClick={() => setCheckingIn(row.name)}
                  >
                    {t("Check in")}
                  </Button>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Departures")}</CardTitle>
              <LogOut className="size-4 text-zinc-400" aria-hidden />
            </CardHeader>
            <CardContent className="pt-1">
              <ReservationList
                rows={snap?.departures ?? []}
                empty={t("No departures due today.")}
                action={(row) => (
                  <Button
                    variant="outline"
                    disabled={busy === row.name}
                    onClick={() => act(row.name, () => checkOut(row.name))}
                  >
                    {t("Check out")}
                  </Button>
                )}
              />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4 xl:col-span-3">
          <Card>
            <CardHeader>
              <CardTitle>{t("Room board")}</CardTitle>
              <span className="text-xs text-zinc-400">
                {t("Tap a room for actions")}
              </span>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-1 border-b border-zinc-100">
                {["All", ...floors].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFloor(f)}
                    className={cn(
                      "relative px-3 py-1.5 text-sm font-medium",
                      floor === f
                        ? "text-brand-700"
                        : "text-zinc-500 hover:text-zinc-700",
                    )}
                  >
                    {f === "All" ? t("All Floors") : ordinalFloor(f, t)}
                    {floor === f && (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600" />
                    )}
                  </button>
                ))}
              </div>
              <div className="space-y-3">
                {shownFloors.map((fl) => (
                  <div key={fl} className="flex items-start gap-3">
                    <div className="w-14 shrink-0 pt-2 text-xs font-medium text-zinc-500">
                      {ordinalFloor(fl, t)}
                    </div>
                    <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2">
                      {allRooms
                        .filter((r) => r.floor === fl)
                        .map((room) => renderRoom(room))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                {t("Tap a room to change its housekeeping status, open the guest's registration or see cleaning photos.")}
              </p>
              {photos && <RoomMediaDialog room={photos} onClose={() => setPhotos(null)} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("In-house guests")}</CardTitle>
              <span className="text-xs text-zinc-400">
                {t("{n} staying", { n: inhouseN })}
              </span>
            </CardHeader>
            <CardContent className="pt-1">
              <InHouseTable rows={snap?.in_house ?? []} today={snap?.date} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t("Housekeeping")}</CardTitle>
              <span className="text-xs text-zinc-400">
                {t("{pct}% occupied · {occupied} of {total}", {
                  pct: occupancyPct,
                  occupied: occupied ?? 0,
                  total: roomsN,
                })}
              </span>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {hkStats.map((s) => (
                  <div
                    key={s.label}
                    className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2"
                  >
                    <span className={cn("size-2 rounded-full", s.dot)} />
                    <span className="text-lg font-semibold tabular-nums">
                      {s.value}
                    </span>
                    <span className="text-xs text-zinc-500">{s.label}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      {checkingIn && (
        <CheckInDialog
          reservation={checkingIn}
          onClose={() => setCheckingIn(null)}
          onDone={() => {
            setCheckingIn(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}
