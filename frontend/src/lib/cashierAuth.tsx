import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { call, getCurrentProperty } from "./api"
import { useAuth } from "./auth"
import { serverError } from "./resource"
import { PinPad } from "../components/PinPad"
import { t } from "./i18n"

type PinStatus = {
  required: boolean
  has_pin: boolean
  must_reset: boolean
  locked: boolean
  unlocked: boolean
  /** How long an unlock lasts at this property (Settings → Finance). */
  unlock_minutes?: number
}

type CashierAuth = {
  status: PinStatus | null
  refresh: () => Promise<void>
  /** Ensure unlock window; opens PinPad if needed. Resolves when ready.
   * `property` defaults to the current one; the PIN rule is per property. */
  ensureUnlocked: (property?: string) => Promise<void>
  /** Legacy helper: returns pin string only when still needed per-call. */
  withPin: <T>(fn: (pin?: string) => Promise<T>) => Promise<T>
}

const Ctx = createContext<CashierAuth | null>(null)

export function CashierAuthProvider({ children }: { children: ReactNode }) {
  // the PIN status belongs to a signed-in user: asking before login only
  // earns a 403 from the server
  const { status: authStatus } = useAuth()
  const [status, setStatus] = useState<PinStatus | null>(null)
  const [padOpen, setPadOpen] = useState(false)
  const [padMode, setPadMode] = useState<"unlock" | "enroll">("unlock")
  const [padProperty, setPadProperty] = useState<string | null>(null)
  const [padError, setPadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [waiter, setWaiter] = useState<{
    resolve: () => void
    reject: (e: Error) => void
  } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await call<PinStatus>("kamra.api.cashier_pin_status", {
        property: getCurrentProperty(),
      })
      setStatus(s)
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    if (authStatus === "authed") void refresh()
    else setStatus(null)
  }, [refresh, authStatus])

  const finishOk = useCallback(() => {
    setPadOpen(false)
    setPadError(null)
    waiter?.resolve()
    setWaiter(null)
  }, [waiter])

  const onSubmit = useCallback(
    async (pin: string) => {
      setBusy(true)
      setPadError(null)
      try {
        if (padMode === "enroll") {
          await call("kamra.api.set_cashier_pin", { pin })
          await call("kamra.api.verify_cashier_pin", {
            property: padProperty ?? getCurrentProperty(),
            pin,
          })
        } else {
          await call("kamra.api.verify_cashier_pin", {
            property: padProperty ?? getCurrentProperty(),
            pin,
          })
        }
        await refresh()
        finishOk()
      } catch (e) {
        setPadError(serverError(e))
      } finally {
        setBusy(false)
      }
    },
    [padMode, padProperty, refresh, finishOk],
  )

  const ensureUnlocked = useCallback((property?: string) => {
    const prop = property ?? getCurrentProperty()
    const current = prop === getCurrentProperty()
    return new Promise<void>((resolve, reject) => {
      void (async () => {
        // ask fresh: a cached "unlocked" outlives the 15-minute window
        const s = await call<PinStatus>("kamra.api.cashier_pin_status", {
          property: prop,
        }).catch(() => (current ? status : null))
        if (s && current) setStatus(s)
        if (!s?.required || s.unlocked) {
          resolve()
          return
        }
        if (s.locked) {
          reject(new Error("PIN locked - try again later."))
          return
        }
        setPadMode(s.has_pin && !s.must_reset ? "unlock" : "enroll")
        setPadProperty(prop)
        setPadError(null)
        setWaiter({ resolve, reject })
        setPadOpen(true)
      })()
    })
  }, [status])

  const withPin = useCallback(
    async <T,>(fn: (pin?: string) => Promise<T>) => {
      await ensureUnlocked()
      // Unlock window is active - backends accept missing pin.
      return fn(undefined)
    },
    [ensureUnlocked],
  )

  const value = useMemo(
    () => ({ status, refresh, ensureUnlocked, withPin }),
    [status, refresh, ensureUnlocked, withPin],
  )

  return (
    <Ctx.Provider value={value}>
      {children}
      <PinPad
        open={padOpen}
        mode={padMode}
        title={padMode === "enroll" ? t("Set your cashier PIN") : t("Cashier PIN")}
        subtitle={
          padMode === "enroll"
            ? t("4-8 digits. Required for money actions at this property.")
            : t("Unlocks money actions for {n} minutes.", {
                n: status?.unlock_minutes ?? 15,
              })
        }
        error={padError}
        busy={busy}
        onSubmit={onSubmit}
        onClose={() => {
          setPadOpen(false)
          waiter?.reject(new Error("PIN entry cancelled."))
          setWaiter(null)
        }}
      />
    </Ctx.Provider>
  )
}

export function useCashierAuth(): CashierAuth {
  const ctx = useContext(Ctx)
  if (!ctx) {
    // Safe no-op fallback when used outside provider (tests / rare screens)
    return {
      status: null,
      refresh: async () => {},
      ensureUnlocked: async () => {},
      withPin: async (fn) => fn(undefined),
    }
  }
  return ctx
}
