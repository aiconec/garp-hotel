/* Public booking page — the second step of a booking with nothing to pay
 * online. The room is Held; the guest confirms it with the 6-digit code we
 * emailed, which proves the booking came from a real address. If the email
 * couldn't be sent, the hold waits for the hotel to confirm instead. */

import { useState } from "react"
import { Button } from "./ui/button"
import { callGuest } from "../lib/api"
import { serverError } from "../lib/resource"
import { useT } from "../lib/i18n"

export function BookingCodeStep({
  reservation,
  email,
  codeSent,
  minutes,
  inputCls,
  onConfirmed,
}: {
  reservation: string
  email: string
  codeSent: boolean
  minutes: number
  inputCls: string
  onConfirmed: () => void
}) {
  const { t } = useT()
  const [code, setCode] = useState("")
  const [sent, setSent] = useState(codeSent)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await callGuest("kamra.public_api.confirm_booking", { reservation, code })
      onConfirmed()
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    setError(null)
    try {
      const r = await callGuest<{ code_sent: boolean }>(
        "kamra.public_api.resend_booking_code",
        { reservation },
      )
      setSent(r.code_sent)
      setResent(true)
    } catch (e) {
      setError(serverError(e))
    }
  }

  if (!sent)
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
        <p className="font-semibold">{t("{reservation} is held for you", { reservation })}</p>
        <p className="mt-1">
          {t("We couldn't email your confirmation code. The hotel will contact you to confirm this booking.")}
        </p>
      </div>
    )

  return (
    <div className="space-y-3">
      <p className="text-sm text-zinc-600">
        {t("We emailed a 6-digit code to {email}. Enter it within {minutes} minutes to confirm booking {reservation}.", { email, minutes, reservation })}
      </p>
      <input
        className={inputCls + " text-center text-lg tracking-[0.4em]"}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        aria-label={t("Booking code")}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && code.length === 6 && !busy && confirm()}
      />
      {error && <p className="text-sm text-rose-600">{error}</p>}
      <Button
        className="w-full justify-center py-2.5 text-base"
        disabled={busy || code.length !== 6}
        onClick={confirm}
      >
        {busy ? t("Confirming…") : t("Confirm booking")}
      </Button>
      <p className="text-center text-xs text-zinc-500">
        {resent ? t("A new code is on its way.") : t("No email? Check spam, or")}{" "}
        {!resent && (
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={resend}>
            {t("send a new code")}
          </button>
        )}
      </p>
    </div>
  )
}
