import { useEffect, useState } from "react"
import PrivacyNotice, { setPrivacyTerms } from "../components/PrivacyNotice"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import {
  BedDouble,
  Check,
  Clock,
  ExternalLink,
  Eye,
  MapPin,
  Minus,
  Navigation,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Star,
  Users,
  Wallet,
} from "lucide-react"
import { callGuest, getDefaultProperty } from "../lib/api"
import { useT, tValue } from "../lib/i18n"
import { setLang } from "../lib/dir"
import { serverError } from "../lib/resource"
import { accentVars } from "../lib/accents"
import { Badge } from "../components/ui/badge"
import { Button } from "../components/ui/button"
import { BookingCodeStep } from "../components/BookingCodeStep"
import { Sheet } from "../components/ui/sheet"
import { cur, moneyLocale, adoptUiLocale } from "../lib/money"
import { formatPhoneDisplay, formatPhoneTel } from "../lib/phone"

const inr = (n: number) =>
  n.toLocaleString(moneyLocale(), { maximumFractionDigits: 0 })

interface Showcase {
  property: {
    name: string
    property_name: string
    description: string | null
    logo_url: string | null
    hero_image: string | null
    brand_accent: string | null
    payment_mode: string
    advance_percent: number
    registration_fee: number
    cleaning_fee: number
    security_deposit_amount: number
    minimum_nights: number
    free_cancel_days: number
    cancellation_fee: string
    booking_mode: string
    property_kind: string
    currency?: string
    country_code?: string
    star_category: string | null
    address_line: string | null
    city: string
    state: string
    pincode: string | null
    country?: string | null
    phone: string | null
    google_reviews_url: string | null
    tripadvisor_url: string | null
    amenities: string[]
    checkin_time: string
    checkout_time: string
    privacy_contact?: string | null
    guest_retention_months?: number | null
    driving_directions: string | null
    latitude: number | null
    longitude: number | null
    gallery: { url: string; caption: string | null }[]
    faqs: { question: string; answer: string }[]
    house_rules: string | null
    pets_policy: string | null
    children_policy: string | null
    extra_bed_policy: string | null
    meta_title: string | null
    meta_description: string | null
    og_image: string | null
    page_slug: string | null
  }
  room_types: {
    name: string
    room_type_name: string
    listing_slug: string | null
    description: string | null
    base_price: number
    adults_capacity: number
    bed_type: string | null
    room_view: string | null
    amenities: string[]
    media: { media_type: string; url: string; caption: string | null }[]
    location_name: string | null
    location_address: string | null
    google_maps_url: string | null
    latitude: number | null
    longitude: number | null
  }[]
  // One pin per distinct site - a single-property hotel gets one entry
  // (the property's own address); a multi-villa portfolio gets
  // one per villa, each listing which room types live there.
  locations: {
    name: string
    slug: string | null
    address: string | null
    google_maps_url: string | null
    latitude: number | null
    longitude: number | null
    room_types: string[]
  }[]
  meal_plans: { name: string; code: string; label: string; price_per_adult: number }[]
  experiences: {
    name: string
    experience_name: string
    category: string | null
    price: number
    duration: string | null
    description: string | null
    image_url: string | null
    gst_rate: number
  }[]
}

interface StayResult {
  room_type: string
  rooms_left: number
  quote: {
    nights: number
    amount_after_tax: number
    discount: number
    cleaning_fee?: number
    totals?: { deposit_required?: number }
  } | null
}

const inputCls =
  "w-full rounded-lg border border-zinc-300 bg-white px-3.5 py-2.5 text-base " +
  "focus:outline-2 focus:outline-offset-1 focus:outline-brand-600"

function todayPlus(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function nightsBetween(a: string, b: string) {
  const ms = new Date(b).getTime() - new Date(a).getTime()
  return Math.max(1, Math.round(ms / 86_400_000))
}

function addDays(date: string, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "Sat, 17 Oct" in the guest's language; a date-only ISO string is local. */
function stayDate(iso: string, lang: string, weekday = false) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(
    lang === "id" ? "id-ID" : "en-GB",
    weekday
      ? { weekday: "short", day: "numeric", month: "short" }
      : { day: "numeric", month: "short" },
  )
}

/** Guest count with − / + buttons, the same height as the date inputs. */
function Stepper({
  label,
  value,
  min,
  max = 20,
  onChange,
  less,
  more,
}: {
  label: string
  value: number
  min: number
  max?: number
  onChange: (n: number) => void
  less: string
  more: string
}) {
  const btn =
    "flex size-9 items-center justify-center rounded-md text-zinc-600 " +
    "hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-30"
  return (
    <div>
      <span className="mb-1 block text-xs font-medium text-zinc-500">{label}</span>
      <div className="flex items-center justify-between rounded-lg border border-zinc-300 bg-white px-1 py-1">
        <button type="button" className={btn} aria-label={`${less}: ${label}`}
          disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Minus className="size-4" aria-hidden />
        </button>
        <span className="text-base font-medium tabular-nums text-zinc-900" aria-live="polite">
          {value}
        </span>
        <button type="button" className={btn} aria-label={`${more}: ${label}`}
          disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  )
}

function setMetaTag(name: string, content: string) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement("meta")
    el.name = name
    document.head.appendChild(el)
  }
  el.content = content
}

export default function PublicBooking() {
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { t, lang } = useT()
  const [property, setProperty] = useState<string | null>(null)
  const [catalogMode, setCatalogMode] = useState<string | null>(null)
  const [sites, setSites] = useState<
    {
      name: string
      slug: string | null
      address: string | null
      from_rate: number
      room_types: string[]
      listing_count?: number
      cover_image?: string | null
      google_maps_url?: string | null
      phone?: string | null
      city?: string | null
      state?: string | null
      latitude?: number | null
      longitude?: number | null
    }[]
  >([])
  const [data, setData] = useState<Showcase | null>(null)
  const [search, setSearch] = useState(() => {
    const check_in_date = params.checkin ?? todayPlus(1)
    return {
      check_in_date,
      check_out_date: params.checkout ?? addDays(check_in_date, 2),
      adults: Number(params.adults ?? 2) || 2,
      children: Number(params.children ?? 0) || 0,
    }
  })
  const [results, setResults] = useState<Record<string, StayResult>>({})
  const [booking, setBooking] = useState<string | null>(null) // room type name
  const [form, setForm] = useState({ guest_name: "", phone: "", email: "", meal_plan: "", special_requests: "" })
  // experience add-ons the guest picked: docname -> quantity
  const [addons, setAddons] = useState<Record<string, number>>({})
  const [voucher, setVoucher] = useState("")
  const [voucherMsg, setVoucherMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [done, setDone] = useState<{ reservation: string; amount: number; verify?: boolean; codeSent?: boolean; minutes?: number; status?: string; advance?: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const checkOut = search.check_out_date

  useEffect(() => {
    callGuest<{
      mode: string
      property?: string
      sites?: typeof sites
      listing_slug?: string
    }>("kamra.public_api.catalog_index")
      .then((idx) => {
        setCatalogMode(idx.mode)
        if (idx.mode === "single_listing" && idx.listing_slug) {
          navigate(`/stay/${idx.listing_slug}`, { replace: true })
          return null
        }
        if (idx.mode === "sites" && idx.sites) {
          setSites(idx.sites)
        }
        const p = idx.property
        if (!p) return getDefaultProperty().then((name) => ({ p: name, idx }))
        return { p, idx }
      })
      .then((ctx) => {
        if (!ctx) return
        const p = typeof ctx === "object" && "p" in ctx ? ctx.p : ctx
        setProperty(p)
        return callGuest<Showcase>("kamra.public_api.showcase", { property: p })
      })
      .then((d) => {
        if (!d) return
        adoptUiLocale((d as unknown as { ui_locale?: { currency_symbol?: string; locale?: string } }).ui_locale)
        setPrivacyTerms((d as unknown as { ui_locale?: { privacy_authority?: string } }).ui_locale)
        setData(d)
        setForm((f) => ({ ...f, meal_plan: d.meal_plans[0]?.name ?? "" }))
      })
      .catch((e) => setError(serverError(e)))
  }, [navigate])

  // stay state lives in the URL - shareable, crawlable, UTM params kept
  useEffect(() => {
    navigate(
      `/book/${search.check_in_date}/${checkOut}/${search.adults}/${search.children}${location.search}`,
      { replace: true },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, checkOut])

  // SEO: title, description, canonical, and schema.org Hotel JSON-LD
  useEffect(() => {
    if (!data) return
    const p = data.property
    const minPrice = Math.min(...data.room_types.map((r) => r.base_price))
    document.title = p.meta_title || `${p.property_name}, ${p.city} - book direct from ${cur()}${inr(minPrice)}/night`
    setMetaTag(
      "description",
      p.meta_description ||
        (`${p.property_name} in ${p.city}: ${data.room_types.length} room types from ${cur()}${inr(minPrice)}/night. ` +
          `Best-rate direct booking, pay at hotel. ${p.description ?? ""}`).slice(0, 158),
    )
    if (p.og_image) {
      setMetaTag("og:image", p.og_image)
    }
    let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement("link")
      canonical.rel = "canonical"
      document.head.appendChild(canonical)
    }
    canonical.href = `${window.location.origin}/book`

    const isStr = p.property_kind === "Short Term Rental"
    const schemaType = isStr ? "VacationRental" : "Hotel"
    const offerType = isStr ? "Accommodation" : "HotelRoom"
    const jsonld = {
      "@context": "https://schema.org",
      "@type": schemaType,
      name: p.property_name,
      description: p.description ?? undefined,
      image: p.hero_image ?? undefined,
      logo: p.logo_url ?? undefined,
      telephone: p.phone
        ? formatPhoneTel(p.phone, p.country)
        : undefined,
      address: {
        "@type": "PostalAddress",
        addressLocality: p.city,
        addressRegion: p.state,
        addressCountry: p.country_code || undefined,
      },
      checkinTime: p.checkin_time?.slice(0, 5),
      checkoutTime: p.checkout_time?.slice(0, 5),
      amenityFeature: p.amenities.map((a) => ({
        "@type": "LocationFeatureSpecification",
        name: a,
      })),
      makesOffer: data.room_types.map((rt) => ({
        "@type": "Offer",
        name: rt.room_type_name,
        priceCurrency: p.currency || undefined,
        price: rt.base_price,
        itemOffered: {
          "@type": offerType,
          name: rt.room_type_name,
          occupancy: {
            "@type": "QuantitativeValue",
            maxValue: rt.adults_capacity,
          },
        },
      })),
    }
    let script = document.getElementById("kamra-jsonld") as HTMLScriptElement | null
    if (!script) {
      script = document.createElement("script")
      script.id = "kamra-jsonld"
      script.type = "application/ld+json"
      document.head.appendChild(script)
    }
    script.textContent = JSON.stringify(jsonld)
  }, [data])

  useEffect(() => {
    if (!property || catalogMode === "sites") return
    const t = setTimeout(fetchResults, 300)
    return () => clearTimeout(t)
  }, [property, search, checkOut, catalogMode])

  function fetchResults() {
    if (!property) return
    callGuest<StayResult[]>("kamra.public_api.search_stay", {
      property,
      check_in_date: search.check_in_date,
      check_out_date: checkOut,
      adults: search.adults,
      children: search.children,
    }).then((rows) => {
      const map: Record<string, StayResult> = {}
      rows.forEach((r) => (map[r.room_type] = r))
      setResults(map)
    })
  }

  async function submitBooking() {
    if (!booking || !property) return
    setBusy(true)
    setError(null)
    try {
      const res = await callGuest<{ reservation: string; amount_after_tax: number; verify?: boolean; code_sent?: boolean; verify_minutes?: number; status?: string; advance_due?: number }>("kamra.public_api.book",
        {
          property,
          room_type: booking,
          check_in_date: search.check_in_date,
          check_out_date: checkOut,
          adults: search.adults,
          children: search.children,
          ...form,
          voucher_code: voucherMsg?.ok ? voucher.trim() : "",
          addons: Object.entries(addons)
            .filter(([, qty]) => qty > 0)
            .map(([experience, qty]) => ({ experience, qty })),
        },
      )
      setDone({
        reservation: res.reservation, amount: res.amount_after_tax,
        verify: res.verify, codeSent: res.code_sent, minutes: res.verify_minutes,
        status: res.status, advance: res.advance_due,
      })
    } catch (e) {
      setError(serverError(e))
    } finally {
      setBusy(false)
    }
  }

  if (!data)
    return (
      <p className="py-20 text-center text-zinc-400">
        {error ?? t("Loading…")}
      </p>
    )

  const p = data.property
  const minNights = p.minimum_nights || 1
  const isStr = p.property_kind === "Short Term Rental"
  const money = (n: number) => `${cur()}${inr(n)}`
  const nightsLabel = (n: number) => t(n === 1 ? "{n} night" : "{n} nights", { n })
  const nights = nightsBetween(search.check_in_date, search.check_out_date)
  const guestsLabel = [
    t(search.adults === 1 ? "{n} adult" : "{n} adults", { n: search.adults }),
    search.children > 0 &&
      t(search.children === 1 ? "{n} child" : "{n} children", { n: search.children }),
  ]
    .filter(Boolean)
    .join(", ")
  const bookCta =
    p.booking_mode === "Request to Book"
      ? t("Request to book")
      : p.payment_mode === "Full online"
        ? t("Confirm & pay")
        : isStr
          ? t("Book this listing")
          : t("Book now")
  const locations = data.locations?.length
    ? data.locations
    : [{ name: p.property_name, address: p.address_line, google_maps_url: null,
         latitude: p.latitude, longitude: p.longitude, room_types: [] }]
  // Prefer the booking-engine hero, then gallery / listing cover so /book
  // never shows an empty grey strip when photos exist elsewhere.
  const heroSrc =
    p.hero_image ||
    p.gallery?.find((g) => g.url)?.url ||
    data.room_types.find((rt) => rt.media?.[0]?.url)?.media?.[0]?.url ||
    sites.find((s) => s.cover_image)?.cover_image ||
    null
  const checkinAt = p.checkin_time?.slice(0, 5)
  const checkoutAt = p.checkout_time?.slice(0, 5)
  const freeCancel = p.free_cancel_days || 0
  const cancelAfter =
    p.cancellation_fee === "First Night"
      ? t("After that, the first night is charged")
      : p.cancellation_fee === "Full Stay"
        ? t("After that, the full stay is charged")
        : ""
  // the three things a guest weighs before scrolling to the rooms
  const facts = [
    { icon: Clock, text: t("Check-in {in} · Check-out {out}", { in: checkinAt, out: checkoutAt }) },
    freeCancel > 0 && {
      icon: ShieldCheck,
      text: t(
        freeCancel === 1
          ? "Free cancellation until 1 day before arrival"
          : "Free cancellation until {n} days before arrival",
        { n: freeCancel },
      ),
    },
    p.payment_mode === "Pay at hotel" && {
      icon: Wallet,
      text: t("Pay at the hotel, no prepayment"),
    },
  ].filter(Boolean) as { icon: typeof Clock; text: string }[]
  const policyTexts = [
    [t("House rules"), p.house_rules],
    [t("Pets"), p.pets_policy],
    [t("Children"), p.children_policy],
    [t("Extra beds"), p.extra_bed_policy],
  ].filter(([, v]) => v) as [string, string][]
  // a one-site property shows the street with its town; villas show their own
  const placeLine = (address: string | null) => {
    if (locations.length > 1) return address || [p.city, p.state].filter(Boolean).join(", ")
    return [address, p.city, p.state]
      .filter((part, i, all) => part && !all.slice(0, i).some((prev) => prev?.includes(part)))
      .join(", ")
  }
  const directionsUrl = (loc: (typeof locations)[number]) =>
    loc.google_maps_url ||
    "https://www.google.com/maps/search/?api=1&query=" +
      encodeURIComponent(
        loc.latitude && loc.longitude
          ? `${loc.latitude},${loc.longitude}`
          : `${p.property_name}, ${placeLine(loc.address)}`,
      )

  return (
    <div
      className="min-h-screen bg-zinc-50"
      style={accentVars(data?.property.brand_accent)}
    >
      {/* hero: photo when available, otherwise a lit brand fill, kept shorter */}
      <div className={"relative overflow-hidden " + (heroSrc ? "h-72 sm:h-96" : "h-60 sm:h-64")}>
        {heroSrc ? (
          <>
            <img
              src={heroSrc}
              alt=""
              className="absolute inset-0 size-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10" />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 85% 0%, rgb(255 255 255 / 0.18), transparent 45%), " +
                "radial-gradient(circle at 0% 100%, rgb(0 0 0 / 0.3), transparent 55%), " +
                "linear-gradient(145deg, var(--color-brand-600) 0%, var(--color-brand-900) 100%)",
            }}
          />
        )}
        <div
          role="group"
          aria-label={t("Language")}
          className="absolute right-4 top-4 flex rounded-full bg-black/25 p-0.5 text-xs font-medium backdrop-blur"
        >
          {[["en", "EN"], ["id", "ID"]].map(([code, label]) => (
            <button
              key={code}
              type="button"
              aria-pressed={lang === code}
              onClick={() => {
                try {
                  setLang(code)
                } catch {
                  /* storage blocked: the page stays in its language */
                }
              }}
              className={
                "rounded-full px-2.5 py-1 transition " +
                (lang === code ? "bg-white text-zinc-900" : "text-white/80 hover:text-white")
              }
            >
              {label}
            </button>
          ))}
        </div>
        <div className="absolute inset-x-0 bottom-0 mx-auto flex max-w-5xl items-end gap-4 px-5 pb-12 text-white">
          {/* hotel logo slot - falls back to a monogram until one is set */}
          <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-white/40 sm:size-20">
            {p.logo_url ? (
              <img
                src={p.logo_url}
                alt={`${p.property_name} logo`}
                className="size-full object-contain p-1"
              />
            ) : (
              <span className="text-2xl font-bold text-brand-700 sm:text-3xl">
                {p.property_name
                  .split(" ")
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join("")}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {p.star_category && (
                <span className="inline-flex items-center gap-1 rounded-md bg-white/15 px-2 py-0.5 backdrop-blur">
                  <Star className="size-3.5 fill-amber-300 text-amber-300" aria-hidden />
                  {tValue(p.star_category)}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-white/85">
                <MapPin className="size-3.5" aria-hidden />
                {[p.city, p.state].filter(Boolean).join(", ")}
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {p.property_name}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {p.phone && (
                <a
                  href={`tel:${formatPhoneTel(p.phone, p.country)}`}
                  className="inline-flex items-center gap-1 text-white/85 underline-offset-2 hover:underline"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {formatPhoneDisplay(p.phone, p.country)}
                </a>
              )}
              {p.google_reviews_url && (
                <a
                  href={p.google_reviews_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-white/90 underline-offset-2 hover:underline"
                >
                  Google Reviews <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
              {p.tripadvisor_url && (
                <a
                  href={p.tripadvisor_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-white/90 underline-offset-2 hover:underline"
                >
                  TripAdvisor <ExternalLink className="size-3.5" aria-hidden />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 pb-16">
        {/* search bar: one row from lg, guests side by side on a phone */}
        <div className="relative z-10 -mt-8 mb-10 rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg sm:p-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-[1fr_1fr_9rem_9rem_auto] lg:items-end">
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1 block text-xs font-medium text-zinc-500">{t("Check-in")}</span>
              <input
                type="date"
                className={inputCls}
                value={search.check_in_date}
                min={todayPlus(0)}
                onChange={(e) => {
                  const check_in_date = e.target.value
                  const minCheckOut = addDays(check_in_date, minNights)
                  setSearch((s) => ({
                    ...s,
                    check_in_date,
                    check_out_date:
                      s.check_out_date > minCheckOut ? s.check_out_date : minCheckOut,
                  }))
                }}
              />
            </label>
            <label className="col-span-2 block sm:col-span-1">
              <span className="mb-1 flex items-center justify-between text-xs font-medium text-zinc-500">
                <span>{t("Check-out")}</span>
                <span className="text-brand-700">{nightsLabel(nights)}</span>
              </span>
              <input
                type="date"
                className={inputCls}
                value={search.check_out_date}
                min={addDays(search.check_in_date, minNights)}
                onChange={(e) =>
                  setSearch({ ...search, check_out_date: e.target.value })
                }
              />
            </label>
            <Stepper
              label={t("Adults")}
              value={search.adults}
              min={1}
              less={t("Decrease")}
              more={t("Increase")}
              onChange={(adults) => setSearch({ ...search, adults })}
            />
            <Stepper
              label={t("Children")}
              value={search.children}
              min={0}
              less={t("Decrease")}
              more={t("Increase")}
              onChange={(children) => setSearch({ ...search, children })}
            />
            <Button
              className="col-span-2 h-[46px] justify-center gap-2 px-6 text-base lg:col-span-1"
              onClick={() => {
                fetchResults()
                document
                  .getElementById("stay-results")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }}
            >
              <Search className="size-4" aria-hidden />
              {t("Check availability")}
            </Button>
          </div>
          {minNights > 1 && (
            <p className="mt-2 text-xs text-zinc-500">
              {t("{n}-night minimum stay", { n: minNights })}
            </p>
          )}
        </div>

        <section className="mb-10 space-y-4">
          {p.description && (
            <p className="max-w-3xl text-[15px] leading-relaxed text-zinc-600">
              {p.description}
            </p>
          )}
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-700">
            {facts.map((f) => (
              <li key={f.text} className="inline-flex items-center gap-2">
                <f.icon className="size-4 shrink-0 text-brand-600" aria-hidden />
                {f.text}
              </li>
            ))}
          </ul>
          {p.amenities.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {p.amenities.map((a) => (
                <Badge key={a} tone="zinc">{tValue(a)}</Badge>
              ))}
            </div>
          )}
        </section>

        {p.gallery && p.gallery.length > 0 && (
          <div className="mb-10">
            <h2 className="mb-3 text-lg font-semibold text-zinc-900">{t("Photos")}</h2>
            <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin">
              {p.gallery.map((img: any, i: number) => (
                <div key={i} className="relative h-40 w-64 shrink-0 rounded-xl overflow-hidden shadow-sm border border-zinc-200 bg-zinc-100">
                  <img src={img.url} alt={img.caption || ""} className="size-full object-cover" />
                  {img.caption && (
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-1 text-center text-xs text-white truncate">
                      {img.caption}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {catalogMode === "sites" && sites.length > 0 ? (
          <div id="stay-results" className="mb-10 scroll-mt-4">
            <div className="mb-5">
              <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
                {t("Places to stay")}
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                {t("Pick a villa, then choose a room or the whole house.")}
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              {sites.map((site) => {
                const stayPath = site.slug
                  ? `/stay/${site.slug}/${search.check_in_date}/${checkOut}/${search.adults}/${search.children}`
                  : "/book"
                const count = site.listing_count ?? site.room_types.length
                return (
                  <Link
                    key={site.slug ?? site.name}
                    to={stayPath}
                    className="group overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-brand-600/40 hover:shadow-md"
                  >
                    <div className="relative aspect-[4/3] bg-zinc-100">
                      {site.cover_image ? (
                        <img
                          src={site.cover_image}
                          alt=""
                          className="size-full object-cover transition duration-500 group-hover:scale-[1.02]"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-gradient-to-br from-brand-700 to-brand-900 text-white">
                          <span className="text-4xl font-semibold tracking-tight">
                            {site.name
                              .split(" ")
                              .map((w) => w[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      <h3 className="text-xl font-semibold text-zinc-900 group-hover:text-brand-900">
                        {site.name}
                      </h3>
                      {(site.address || site.city) && (
                        <p className="mt-1.5 inline-flex items-start gap-1.5 text-sm text-zinc-500">
                          <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                          <span>
                            {site.address ||
                              [site.city, site.state].filter(Boolean).join(", ")}
                          </span>
                        </p>
                      )}
                      <div className="mt-4 flex flex-wrap items-end justify-between gap-2 border-t border-zinc-100 pt-4">
                        <p className="text-sm text-zinc-500">
                          {t("From {price} per night", { price: money(site.from_rate) })}
                        </p>
                        <p className="text-sm font-medium text-brand-700">
                          {t(count === 1 ? "1 listing" : "{n} listings", { n: count })} →
                        </p>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        ) : (
          <div id="stay-results" className="scroll-mt-4">
            {/* room cards — hotel / single-site catalog */}
            <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
                {isStr ? t("Choose your stay") : t("Choose your room")}
              </h2>
              <p className="text-sm text-zinc-500">
                {stayDate(search.check_in_date, lang)} – {stayDate(checkOut, lang)}
                {" · "}
                {nightsLabel(nights)} · {guestsLabel}
              </p>
            </div>
            <div className="space-y-4">
              {data.room_types.map((rt) => {
                const r = results[rt.name]
                const soldOut = r && r.rooms_left === 0
                return (
                  <article
                    key={rt.name}
                    className="grid overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition hover:shadow-md sm:grid-cols-[15rem_1fr]"
                  >
                    <div className="relative">
                      {rt.media[0] ? (
                        <img
                          src={rt.media[0].url}
                          alt={rt.media[0].caption ?? rt.room_type_name}
                          className="h-48 w-full object-cover sm:h-full"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-28 items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 sm:h-full">
                          <BedDouble className="size-9 text-brand-600/40" aria-hidden />
                        </div>
                      )}
                      {rt.media.length > 1 && (
                        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-xs text-white">
                          {t("{n} photos", { n: rt.media.length })}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col p-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-zinc-900">{rt.room_type_name}</h3>
                        {soldOut ? (
                          <Badge tone="rose">{t("Sold out")}</Badge>
                        ) : r?.quote && r.rooms_left <= 2 ? (
                          <Badge tone="amber">{t("Only {n} left", { n: r.rooms_left })}</Badge>
                        ) : null}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3.5" aria-hidden />
                          {rt.adults_capacity === 1
                            ? t("1 adult")
                            : t("Up to {n} adults", { n: rt.adults_capacity })}
                        </span>
                        {rt.bed_type && (
                          <span className="inline-flex items-center gap-1">
                            <BedDouble className="size-3.5" aria-hidden />
                            {t("{bed} bed", { bed: tValue(rt.bed_type) })}
                          </span>
                        )}
                        {rt.room_view && (
                          <span className="inline-flex items-center gap-1">
                            <Eye className="size-3.5" aria-hidden />
                            {t("{view} view", { view: tValue(rt.room_view) })}
                          </span>
                        )}
                      </div>
                      {locations.length > 1 && rt.location_name && (
                        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-700">
                          <MapPin className="size-3.5" aria-hidden />
                          {rt.location_name}
                        </p>
                      )}
                      {rt.description && (
                        <p className="mt-2 text-sm leading-relaxed text-zinc-600">{rt.description}</p>
                      )}
                      {rt.amenities.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                          {rt.amenities.map((a) => (
                            <li
                              key={a}
                              className="inline-flex items-center gap-1 text-xs text-zinc-600"
                            >
                              <Check className="size-3 text-brand-600" aria-hidden />
                              {tValue(a)}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex-1" />
                      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 border-t border-zinc-100 pt-4">
                        <div>
                          {r?.quote ? (
                            <>
                              <p className="text-2xl font-semibold tracking-tight tabular-nums text-zinc-900">
                                {money(r.quote.amount_after_tax)}
                              </p>
                              <p className="text-xs text-zinc-500">
                                {t(
                                  r.quote.nights === 1
                                    ? "for 1 night, taxes included"
                                    : "for {n} nights, taxes included",
                                  { n: r.quote.nights },
                                )}
                              </p>
                              {(r.quote.cleaning_fee || 0) > 0 && (
                                <p className="text-xs text-zinc-500">
                                  {t("Includes {amount} cleaning fee", {
                                    amount: money(r.quote.cleaning_fee || 0),
                                  })}
                                </p>
                              )}
                              {(r.quote.totals?.deposit_required || 0) > 0 && (
                                <p className="text-xs text-zinc-500">
                                  {t("Refundable deposit {amount}, paid separately", {
                                    amount: money(r.quote.totals?.deposit_required || 0),
                                  })}
                                </p>
                              )}
                            </>
                          ) : soldOut ? (
                            <p className="text-sm text-zinc-500">
                              {t("Not available for these dates")}
                            </p>
                          ) : (
                            <p className="text-sm text-zinc-500">
                              {t("From {price} per night", { price: money(rt.base_price) })}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {rt.listing_slug && (
                            <Button
                              variant="outline"
                              className="px-4 py-2.5"
                              onClick={() => navigate(`/stay/${rt.listing_slug}`)}
                            >
                              {t("View details")}
                            </Button>
                          )}
                          <Button
                            className="px-5 py-2.5 text-base"
                            disabled={!r?.quote}
                            onClick={() => setBooking(rt.name)}
                          >
                            {bookCta}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )}

        {catalogMode !== "sites" && (
        <>
        <div className="mt-14 grid gap-8 border-t border-zinc-200 pt-10 md:grid-cols-2">
          {/* Policies & Rules */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-zinc-900">
              {isStr ? t("Stay policies") : t("Hotel policies")}
            </h2>
            <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm">
              <dl className="divide-y divide-zinc-100">
                {(
                  [
                    [t("Check-in"), t("From {time}", { time: checkinAt })],
                    [t("Check-out"), t("Until {time}", { time: checkoutAt })],
                    minNights > 1 && [t("Minimum stay"), nightsLabel(minNights)],
                    (p.cleaning_fee || 0) > 0 && [
                      t("Cleaning fee"),
                      t("{amount}, one-time", { amount: money(p.cleaning_fee) }),
                    ],
                    (p.security_deposit_amount || 0) > 0 && [
                      t("Security deposit"),
                      t("{amount}, refundable", { amount: money(p.security_deposit_amount) }),
                    ],
                    [
                      t("Cancellation"),
                      freeCancel > 0
                        ? t(
                            freeCancel === 1
                              ? "Free until 1 day before arrival"
                              : "Free until {n} days before arrival",
                            { n: freeCancel },
                          )
                        : t("Per property policy"),
                      cancelAfter,
                    ],
                  ].filter(Boolean) as [string, string, string?][]
                ).map(([label, value, sub]) => (
                  <div key={label} className="flex justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="text-right font-medium text-zinc-900">
                      {value}
                      {sub && (
                        <span className="block text-xs font-normal text-zinc-500">{sub}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
              {policyTexts.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-zinc-100 pt-4">
                  {policyTexts.map(([label, text]) => (
                    <div key={label}>
                      <p className="mb-1 font-medium text-zinc-800">{label}</p>
                      <p className="whitespace-pre-line text-xs leading-relaxed text-zinc-600">{text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Map & Directions - one card per villa/site when the property
              spans multiple addresses, one card when it doesn't. A site
              without coordinates gets no map, only the directions link. */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-zinc-900">
              {locations.length > 1 ? t("Our locations") : t("Location")}
            </h2>
            <div className="space-y-4">
              {locations.map((loc, i) => (
                <div key={loc.name + i} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm">
                  {locations.length > 1 && (
                    <p className="font-semibold text-zinc-900">{loc.name}</p>
                  )}
                  {loc.latitude && loc.longitude ? (
                    <iframe
                      title={`${loc.name} map`}
                      width="100%"
                      height="220"
                      src={`https://maps.google.com/maps?q=${loc.latitude},${loc.longitude}&t=&z=15&ie=UTF8&iwloc=&output=embed`}
                      className="rounded-lg border border-zinc-200"
                    />
                  ) : null}
                  <p className="flex items-start gap-2 font-medium text-zinc-800">
                    <MapPin className="mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden />
                    {placeLine(loc.address)}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={directionsUrl(loc)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
                    >
                      <Navigation className="size-3.5 text-brand-600" aria-hidden />
                      {t("Get directions")}
                    </a>
                    {locations.length <= 1 && p.phone && (
                      <a
                        href={`tel:${formatPhoneTel(p.phone, p.country)}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
                      >
                        <Phone className="size-3.5 text-brand-600" aria-hidden />
                        {t("Call the hotel")}
                      </a>
                    )}
                  </div>
                  {locations.length > 1 && loc.room_types.length > 0 && (
                    <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                      {t("Rooms here: {list}", {
                        list: loc.room_types
                          .map((rt) => data.room_types.find((r) => r.name === rt)?.room_type_name || rt)
                          .join(", "),
                      })}
                    </p>
                  )}
                  {locations.length <= 1 && p.driving_directions && (
                    <div className="border-t border-zinc-100 pt-3 text-xs text-zinc-600">
                      <p className="mb-1 font-medium text-zinc-800">{t("Driving directions")}</p>
                      <p className="whitespace-pre-line leading-relaxed">{p.driving_directions}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>

        {p.faqs && p.faqs.length > 0 && (
          <div className="mx-auto mt-14 max-w-3xl space-y-4 border-t border-zinc-200 pt-10">
            <h2 className="mb-6 text-center text-lg font-semibold text-zinc-900">{t("Frequently asked questions")}</h2>
            <div className="space-y-3">
              {p.faqs.map((faq: any, i: number) => (
                <details key={i} className="group rounded-xl border border-zinc-200 bg-white p-4 shadow-sm [&_summary::-webkit-details-marker]:hidden cursor-pointer">
                  <summary className="flex items-center justify-between text-sm font-medium text-zinc-800 select-none">
                    <span>{faq.question}</span>
                    <span className="transition group-open:rotate-180">
                      <svg fill="none" height="24" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="24" className="size-4 text-zinc-500"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </span>
                  </summary>
                  <p className="mt-3 text-xs leading-relaxed text-zinc-600 border-t border-zinc-100 pt-3">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        )}
        </>
        )}

        <p className="mt-12 text-center text-xs text-zinc-400">
          {t("Powered by BizConnect.id Hotel")}
        </p>
      </div>

      {booking && (
        <Sheet
          wide
          title={
            done?.verify
              ? t("Confirm your booking")
              : done?.status === "Pending Payment"
                ? t("Booking held")
                : done
                  ? t("Booking confirmed")
                  : t("Complete your booking")
          }
          description={
            done
              ? undefined
              : `${data.room_types.find((r) => r.name === booking)?.room_type_name} · ` +
                `${stayDate(search.check_in_date, lang, true)} → ${stayDate(checkOut, lang, true)} · ` +
                `${nightsLabel(nights)}, ${guestsLabel}`
          }
          onClose={() => {
            setBooking(null)
            setDone(null)
          }}
          footer={
            done?.verify ? undefined : done ? (
              <Button className="w-full justify-center py-2.5" onClick={() => { setBooking(null); setDone(null) }}>
                {t("Done")}
              </Button>
            ) : (
              <div className="w-full space-y-2">
                <PrivacyNotice propertyName={p.property_name} contact={p.privacy_contact}
                  retentionMonths={p.guest_retention_months} />
                <Button
                  className="w-full justify-center py-2.5 text-base"
                  disabled={busy || !form.guest_name || !form.phone || !form.email}
                  onClick={submitBooking}
                >
                  {busy ? t("Booking…") : bookCta}
                </Button>
              </div>
            )
          }
        >
          {done?.verify ? (
            <BookingCodeStep
              reservation={done.reservation}
              email={form.email}
              codeSent={!!done.codeSent}
              minutes={done.minutes ?? 30}
              inputCls={inputCls}
              onConfirmed={() => setDone({ ...done, verify: false, status: "Confirmed" })}
            />
          ) : done?.status === "Pending Payment" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-amber-900">
              <p className="text-lg font-semibold">
                {t("{reservation} is held for you", { reservation: done.reservation })}
              </p>
              <p className="mt-1 text-sm">
                {t(
                  "Total {total}. The hotel will send you a payment link for the {advance} advance that confirms this booking.",
                  { total: money(done.amount), advance: money(done.advance ?? 0) },
                )}
              </p>
            </div>
          ) : done ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-emerald-800">
                <p className="text-lg font-semibold">{done.reservation}</p>
                <p className="mt-1 text-sm">
                  {t(
                    "Total {total}, payable at the hotel. We've saved your number; the front desk will reach out before arrival.",
                    { total: money(done.amount) },
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600">{t("Full name")}</span>
                <input className={inputCls} value={form.guest_name} autoFocus autoComplete="name"
                  onChange={(e) => setForm({ ...form, guest_name: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600">{t("Phone")}</span>
                <input className={inputCls} type="tel" value={form.phone} placeholder="+62 …" autoComplete="tel"
                  onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600">{t("Email")}</span>
                <input className={inputCls} type="email" value={form.email} autoComplete="email"
                  onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600">{t("Meal plan")}</span>
                <select className={inputCls} value={form.meal_plan}
                  onChange={(e) => setForm({ ...form, meal_plan: e.target.value })}>
                  <option value="">{t("Room only")}</option>
                  {data.meal_plans.map((mp) => (
                    <option key={mp.name} value={mp.name}>
                      {t("{label} (+{price} per adult per night)", {
                        label: mp.label,
                        price: money(mp.price_per_adult),
                      })}
                    </option>
                  ))}
                </select>
              </label>
              {data.experiences.length > 0 && (
                <div className="block sm:col-span-2">
                  <span className="mb-1.5 block text-sm font-medium text-zinc-600">
                    {t("Add experiences")}
                  </span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {data.experiences.map((exp) => {
                      const qty = addons[exp.name] || 0
                      const on = qty > 0
                      return (
                        <div
                          key={exp.name}
                          className={
                            "flex items-center gap-3 rounded-xl border p-2.5 " +
                            (on ? "border-brand-600/50 bg-brand-50/50" : "border-zinc-200")
                          }
                        >
                          {exp.image_url && (
                            <img
                              src={exp.image_url}
                              alt=""
                              className="size-12 shrink-0 rounded-lg object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium text-zinc-800">
                                {exp.experience_name}
                              </span>
                              {exp.category && (
                                <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
                                  {exp.category}
                                </span>
                              )}
                            </div>
                            <div className="truncate text-xs text-zinc-500">
                              {money(exp.price)}
                              {exp.duration ? ` · ${exp.duration}` : ""}
                              {exp.description ? ` · ${exp.description}` : ""}
                            </div>
                          </div>
                          {on ? (
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                aria-label={`${t("Decrease")}: ${exp.experience_name}`}
                                className="size-7 rounded-lg border border-zinc-300 text-zinc-600 hover:bg-white"
                                onClick={() =>
                                  setAddons((a) => ({ ...a, [exp.name]: qty - 1 }))
                                }
                              >
                                −
                              </button>
                              <span className="w-5 text-center text-sm tabular-nums">
                                {qty}
                              </span>
                              <button
                                type="button"
                                aria-label={`${t("Increase")}: ${exp.experience_name}`}
                                className="size-7 rounded-lg border border-zinc-300 text-zinc-600 hover:bg-white"
                                onClick={() =>
                                  setAddons((a) => ({ ...a, [exp.name]: qty + 1 }))
                                }
                              >
                                +
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="shrink-0 rounded-lg border border-brand-600 px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
                              onClick={() =>
                                setAddons((a) => ({ ...a, [exp.name]: 1 }))
                              }
                            >
                              {t("Add")}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {(() => {
                    const addonTotal = data.experiences.reduce(
                      (s, e) => s + (addons[e.name] || 0) * e.price,
                      0,
                    )
                    return addonTotal > 0 ? (
                      <p className="mt-2 text-right text-xs text-zinc-500">
                        {t("Experiences: +{amount} · added to your bill at the hotel", {
                          amount: money(addonTotal),
                        })}
                      </p>
                    ) : null
                  })()}
                </div>
              )}
              <label className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600">{t("Special requests")}</span>
                <textarea className={inputCls} rows={2} value={form.special_requests}
                  onChange={(e) => setForm({ ...form, special_requests: e.target.value })} />
              </label>
              <div className="block sm:col-span-2">
                <span className="mb-1.5 block text-sm font-medium text-zinc-600">
                  {t("Promo code")}
                </span>
                <div className="flex gap-2">
                  <input className={inputCls} placeholder={t("Have a code?")}
                    value={voucher}
                    onChange={(e) => {
                      setVoucher(e.target.value)
                      setVoucherMsg(null)
                    }} />
                  <button type="button"
                    className="shrink-0 rounded-lg border border-brand-600 px-4 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50"
                    disabled={!voucher.trim() || !property}
                    onClick={async () => {
                      if (!property) return
                      const nights = Math.max(
                        1,
                        Math.round(
                          (new Date(checkOut).getTime() -
                            new Date(search.check_in_date).getTime()) /
                            86_400_000,
                        ),
                      )
                      try {
                        const r = await callGuest<{ ok: boolean; message: string }>("kamra.public_api.check_voucher",
                          { property, code: voucher.trim(), nights },
                        )
                        setVoucherMsg({ ok: r.ok, text: r.message })
                      } catch {
                        setVoucherMsg({ ok: false, text: t("Couldn't check that code.") })
                      }
                    }}>
                    {t("Apply")}
                  </button>
                </div>
                {voucherMsg && (
                  <p className={
                    "mt-1 text-xs " +
                    (voucherMsg.ok ? "text-brand-700" : "text-rose-600")
                  }>
                    {voucherMsg.text}
                  </p>
                )}
              </div>
              {data.property.payment_mode &&
                data.property.payment_mode !== "Pay at hotel" && (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-600 sm:col-span-2">
                    {data.property.payment_mode === "Full online"
                      ? t("Full amount is paid online to confirm this booking.")
                      : data.property.payment_mode === "Advance percent"
                        ? t("A {pct}% advance is collected to confirm; the rest is paid at the hotel.", {
                            pct: data.property.advance_percent,
                          })
                        : t("A {amount} registration fee is collected to confirm; the rest is paid at the hotel.", {
                            amount: money(data.property.registration_fee),
                          })}
                  </div>
                )}
              {(data.property.cleaning_fee || 0) > 0 && (
                <p className="text-xs text-zinc-500 sm:col-span-2">
                  {t("Cleaning fee {amount} is included in the total.", {
                    amount: money(data.property.cleaning_fee),
                  })}
                </p>
              )}
              {(data.property.security_deposit_amount || 0) > 0 && (
                <p className="text-xs text-zinc-500 sm:col-span-2">
                  {t("A refundable security deposit of {amount} may be collected separately.", {
                    amount: money(data.property.security_deposit_amount),
                  })}
                </p>
              )}
              {error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">
                  {error}
                </div>
              )}
            </div>
          )}
        </Sheet>
      )}
    </div>
  )
}
