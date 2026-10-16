import { useState } from "react"
import { Check, Loader2, ShieldCheck, X } from "lucide-react"

import {
  approveAction,
  declineAction,
  isNetworkError,
  type AgentAction,
} from "../lib/api"
import { useCashierAuth } from "../lib/cashierAuth"
import { useT } from "../lib/i18n"
import { serverError } from "../lib/resource"
import { cn } from "../lib/utils"
import { Button } from "./ui/button"

/** A change the agent proposed. Nothing happens until the person presses
 * Approve; the server then runs the stored call as them, so their PIN and
 * POS session apply. */

const PROPOSAL_LABEL: Record<string, string> = {
  create_booking: "Create a booking",
  check_in: "Check the guest in",
  check_out: "Check the guest out",
  post_charge: "Post a charge",
  record_payment: "Record a payment",
  cancel_booking: "Cancel the booking",
  amend_stay: "Change the stay dates",
  move_room: "Move to another room",
  void_charge: "Remove a charge",
  apply_allowance: "Credit back part of the bill",
  close_folio: "Close the folio and invoice",
  raise_ticket: "Raise a ticket",
  set_room_rate: "Change a room rate",
  run_night_audit: "Run the night audit",
  promote_waitlist: "Give a waitlisted guest a room",
  set_room_hk_status: "Set a room's housekeeping status",
}

const FIELD_LABEL: Record<string, string> = {
  reservation: "Reservation",
  folio: "Folio",
  amount: "Amount",
  mode: "Mode",
  reference: "Reference",
  reason: "Reason",
  note: "Note",
  room: "Room",
  current_room: "Current room",
  new_room: "New room",
  guest: "Guest",
  guest_name: "Guest name",
  phone: "Phone",
  room_type: "Room type",
  check_in_date: "Check-in",
  check_out_date: "Check-out",
  stay: "Stay",
  status: "Status",
  stay_status: "Stay status",
  balance: "Balance",
  rate: "Rate",
  description: "Description",
  subject: "Subject",
  priority: "Priority",
  category: "Category",
  adults: "Adults",
  children: "Children",
  meal_plan: "Meal plan",
  company: "Company",
  business_date: "Business date",
}

const ROW_ORDER = [
  "guest", "guest_name", "reservation", "current_room", "stay", "stay_status",
  "room", "new_room", "status", "folio",
  "balance", "amount", "mode", "reference", "reason", "note",
]

const words = (s: string) => {
  const w = s.replace(/_/g, " ")
  return w.charAt(0).toUpperCase() + w.slice(1)
}

const show = (v: unknown) =>
  typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)

/** Refusals the person can clear and approve again; the server keeps the
 * proposal for these (assistant.RETRYABLE). */
const PIN_ERROR = /^PIN_(REQUIRED|NOT_SET|MUST_RESET)/
const POS_ERROR = /^NO_OPEN_SESSION/

/** What a failed approve/decline means for the proposal. Only "refused" is
 * a real "it didn't run"; a lost response may have run, and the server
 * answers "expired" for one that ran or was declined elsewhere. */
type Refusal = "unknown" | "busy" | "gone" | "pin" | "pos" | "refused"
function classify(e: unknown): Refusal {
  const status = (e as { status?: number }).status ?? 0
  if (isNetworkError(e) || [502, 503, 504].includes(status)) return "unknown"
  const msg = serverError(e)
  if (PIN_ERROR.test(msg)) return "pin"
  if (POS_ERROR.test(msg)) return "pos"
  if (msg.includes("already being handled")) return "busy"
  if (msg.includes("expired or isn't yours")) return "gone"
  return "refused"
}

export function ActionProposal({
  action,
  onResolved,
  disabled,
}: {
  action: AgentAction
  onResolved: (patch: Partial<AgentAction>) => void
  /** while the agent is still answering, so its save can't drop the outcome */
  disabled?: boolean
}) {
  const { t } = useT()
  const { ensureUnlocked } = useCashierAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = t(PROPOSAL_LABEL[action.tool] ?? words(action.tool))
  // saved conversations come back with sorted keys: keep a fixed order
  const rank = (k: string) => {
    const i = ROW_ORDER.indexOf(k)
    return i < 0 ? ROW_ORDER.length : i
  }
  const rows = [
    ...Object.entries(action.context ?? {}).sort(([a], [b]) => rank(a) - rank(b)),
    ...Object.entries(action.args ?? {}).sort(([a], [b]) => rank(a) - rank(b)),
  ].filter(([, v]) => v !== null && v !== undefined && v !== "")

  /** Show a refusal; the card stays open unless the proposal is gone. */
  function settle(e: unknown, refusedIsFailure: boolean) {
    const kind = classify(e)
    if (kind === "gone") return onResolved({ status: "expired" })
    if (kind === "refused") {
      if (refusedIsFailure) return onResolved({ status: "failed", error: serverError(e) })
      return setError(serverError(e))
    }
    setError(
      {
        unknown: t("Couldn't confirm the result. Check the record before you approve again."),
        busy: t("This is being handled in another window."),
        pin: t("Enter your cashier PIN to approve."),
        pos: t("Open your POS session first, then approve again."),
      }[kind],
    )
  }

  async function approve() {
    if (!action.id || busy) return
    setBusy(true)
    setError(null)
    try {
      let out
      try {
        out = await approveAction(action.id)
      } catch (e) {
        if (classify(e) !== "pin") throw e
        try {
          // the proposal's property: the PIN rule is per property
          await ensureUnlocked(action.property)
        } catch (pinErr) {
          // cancelled or locked: the server still holds the proposal
          const m = (pinErr as Error).message ?? ""
          setError(m.startsWith("PIN locked") ? m : t("Enter your cashier PIN to approve."))
          return
        }
        out = await approveAction(action.id)
      }
      onResolved({ status: "approved", note: out.note })
    } catch (e) {
      settle(e, true)
    } finally {
      setBusy(false)
    }
  }

  async function decline() {
    if (!action.id || busy) return
    setBusy(true)
    setError(null)
    try {
      await declineAction(action.id)
      onResolved({ status: "declined" })
    } catch (e) {
      settle(e, false)
    } finally {
      setBusy(false)
    }
  }

  const done = action.status
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border px-3 py-2.5 text-sm",
        !done && "border-amber-300 bg-amber-50",
        done === "approved" && "border-emerald-200 bg-emerald-50",
        (done === "declined" || done === "expired") &&
          "border-zinc-200 bg-zinc-50 text-zinc-500",
        done === "failed" && "border-rose-200 bg-rose-50",
      )}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck
          className={cn(
            "size-4 shrink-0",
            !done && "text-amber-600",
            done === "approved" && "text-emerald-600",
            (done === "declined" || done === "expired") && "text-zinc-400",
            done === "failed" && "text-rose-600",
          )}
          aria-hidden
        />
        <span className="font-medium text-zinc-800">{label}</span>
        <span className="ml-auto text-[11px] font-medium">
          {!done && <span className="text-amber-700">{t("Needs your approval")}</span>}
          {done === "approved" && <span className="text-emerald-700">{t("Done")}</span>}
          {done === "declined" && <span>{t("Declined")}</span>}
          {done === "expired" && <span>{t("No longer waiting")}</span>}
          {done === "failed" && <span className="text-rose-700">{t("Failed")}</span>}
        </span>
      </div>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {rows.map(([k, v], i) => (
            <div key={`${k}-${i}`} className="contents">
              <dt className="text-zinc-500">{t(FIELD_LABEL[k] ?? words(k))}</dt>
              <dd className="min-w-0 break-words text-zinc-800">{show(v)}</dd>
            </div>
          ))}
        </dl>
      )}
      {done === "failed" && action.error && (
        <p className="text-xs text-rose-700">{action.error}</p>
      )}
      {!done && (
        <>
          {error && <p className="text-xs text-rose-700">{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={approve} disabled={busy || disabled} className="px-2.5 py-1 text-xs">
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Check className="size-3.5" aria-hidden />
              )}
              {t("Approve")}
            </Button>
            <Button
              variant="outline"
              onClick={decline}
              disabled={busy || disabled}
              className="px-2.5 py-1 text-xs"
            >
              <X className="size-3.5" aria-hidden />
              {t("Decline")}
            </Button>
            <span className="text-[11px] text-zinc-500">
              {t("Nothing changes until you approve.")}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

/** The outcome of a message's proposals, as text for the model's next turn,
 * so it knows what ran and what didn't. */
export function outcomeNotes(actions: AgentAction[] | undefined): string[] {
  return (actions ?? [])
    .filter((a) => a.pending)
    .map((a) => {
      if (a.status === "approved")
        return `[Staff approved ${a.tool} and it ran. Result: ${a.note ?? "ok"}]`
      if (a.status === "failed")
        return `[Staff approved ${a.tool} but it failed: ${a.error ?? "error"}]`
      if (a.status === "declined") return `[Staff declined ${a.tool}; it did not run.]`
      if (a.status === "expired")
        return `[${a.tool} is no longer waiting: it expired or was handled in another window. Check the record before proposing it again.]`
      return `[${a.tool} is still waiting for the staff member's Approve on its card; it has not run. Don't propose it again.]`
    })
}
