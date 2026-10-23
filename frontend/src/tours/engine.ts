/*  Runs one tour on driver.js (spotlight, popover, scrolling). This layer adds
    what a PMS walkthrough needs on top: steps on several pages, steps that
    wait for a dialog the person opens, anchors that live in either the rail
    or the drawer, translated copy, and arrow keys that leave form fields
    alone. Loaded on demand, so the app doesn't carry it until a tour starts. */

import { driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"
import "./tour.css"
import type { Tour, TourContext } from "./types"

type Translate = (s: string, vars?: Record<string, string | number>) => string

export interface RunOptions {
  ctx: TourContext
  t: Translate
  /** Current in-app path (router-relative). */
  path: () => string
  navigate: (to: string) => void
  /** finished = the person reached the end, not closed it early. */
  onEnd: (finished: boolean) => void
}

// long enough for a lazy screen to load and its first data to land
const WAIT_MS = 5000
// an optional step on a page that's already up: there or not, quickly
const OPTIONAL_WAIT_MS = 800

function shown(el: Element) {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"
}

/** The first of the anchors that is on screen. */
export function findAnchor(at?: string | string[]): Element | undefined {
  for (const name of at ? (Array.isArray(at) ? at : [at]) : []) {
    for (const el of document.querySelectorAll(`[data-tour="${name}"]`)) {
      if (shown(el)) return el
    }
  }
  return undefined
}

const ESC: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])

/** driver.js renders popover copy as HTML: escape it, then allow **bold**
 *  and `keys`. */
const rich = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<kbd>$1</kbd>")

const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))

/** Start the tour; returns a function that stops it. */
export function runTour(tour: Tour, o: RunOptions): () => void {
  const steps = tour.steps.filter((s) => !s.when || s.when(o.ctx))
  // the page each step lives on; unknown after a click that opens a page
  let route = tour.route
  const routes = steps.map((s, i) => {
    if (s.route) route = s.route
    else if (i > 0 && steps[i - 1].leavesPage) route = undefined
    return route
  })
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

  let finished = false
  let ended = false
  let watch: MutationObserver | undefined
  let frame = 0
  const unwatch = () => {
    watch?.disconnect()
    watch = undefined
    cancelAnimationFrame(frame)
  }

  const index = () => d.getActiveIndex() ?? 0

  // Optional steps whose anchor is missing get skipped, so "n of m" and the
  // Done button are worked out from what will really show.
  const seen = new Set<number>()
  // A later step whose anchor a click must first open (the check-in form)
  // counts if that click's step will show.
  const willShow = (j: number, from: number): boolean =>
    !steps[j].optional ||
    routes[j] !== routes[from] ||
    !!findAnchor(steps[j].at) ||
    steps.slice(from, j).some((s, k) => s.action && (from + k === from || willShow(from + k, from)))
  const remaining = (i: number) => {
    let n = 0
    for (let j = i + 1; j < steps.length; j++) if (willShow(j, i)) n++
    return n
  }

  function go(i: number) {
    unwatch()
    if (i < 0) return
    if (i >= steps.length) {
      finished = true
      stop()
      return
    }
    const r = routes[i]
    if (r && r !== o.path()) o.navigate(r)
    d.moveTo(i)
  }

  function next() {
    const i = index()
    if (!remaining(i)) {
      finished = true
      return stop()
    }
    if (!steps[i]?.action) return go(i + 1)
    // Next on an action step does the click for them; the watcher moves on
    // when the dialog opens, and this moves on if it never does.
    const el = d.getActiveElement()
    if (el instanceof HTMLElement && el.id !== "driver-dummy-element") el.click()
    window.setTimeout(() => {
      if (!ended && index() === i) go(i + 1)
    }, 1500)
  }

  function back() {
    const i = index()
    if (i > 0 && !steps[i].noBack) go(i - 1)
  }

  /** Move on from an action step once the next step's anchor shows up. */
  function armAction(i: number) {
    const target = steps[i + 1]?.at
    if (!target) return
    const check = () => {
      if (!ended && index() === i && findAnchor(target)) go(i + 1)
    }
    if (findAnchor(target)) {
      // already open (they opened it before the tour got here)
      window.setTimeout(check)
      return
    }
    watch = new MutationObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(check)
    })
    watch.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden"],
    })
  }

  // what a click opened (a dialog, a page) may still be loading its data
  const wait = (i: number) =>
    !steps[i].at
      ? 0
      : steps[i].optional && i > 0 && routes[i] === routes[i - 1] && !steps[i - 1].action
        ? OPTIONAL_WAIT_MS
        : WAIT_MS

  const driveSteps: DriveStep[] = steps.map((s, i) => ({
    element: s.at ? (() => findAnchor(s.at) as Element) : undefined,
    waitForElement: wait(i),
    skipMissingElement: !!s.optional,
    disableActiveInteraction: !(s.action || s.interactive),
    popover: {
      title: rich(o.t(s.title)),
      description: rich(o.t(s.body)),
      side: s.side,
      align: s.align,
      ...(s.noBack ? { disableButtons: ["previous" as const] } : {}),
    },
    onHighlightStarted: () => void seen.add(i),
    onHighlighted: s.action ? () => armAction(i) : undefined,
    onDeselected: s.action ? unwatch : undefined,
  }))

  const d = driver({
    steps: driveSteps,
    animate: !reduced,
    smoothScroll: !reduced,
    overlayColor: "#000",
    overlayOpacity: 0.55,
    stagePadding: 6,
    stageRadius: 10,
    popoverOffset: 8,
    popoverClass: "kamra-tour",
    // a stray click on the dimmed page shouldn't throw the tour away
    overlayClickBehavior: "none",
    // our own keys below: arrows must not page the tour while typing
    allowKeyboardControl: false,
    showProgress: steps.length > 1,
    nextBtnText: esc(o.t("Next")),
    prevBtnText: esc(o.t("Back")),
    doneBtnText: esc(o.t("Done")),
    closeBtnLabel: o.t("Close tour"),
    onPopoverRender: (popover, { state }) => {
      const i = state.activeIndex ?? 0
      const current = [...seen].filter((j) => j <= i).length
      const left = remaining(i)
      popover.progress.textContent = o.t("{current} of {total}", {
        current,
        total: current + left,
      })
      // An opening card can show before the page's data does, and the total
      // would jump on the next step; leave the count off until it can't.
      const unsettled =
        !steps[i].at &&
        steps.some((s, j) => j > i && s.optional && routes[j] === routes[i] && !findAnchor(s.at))
      popover.progress.style.visibility = unsettled ? "hidden" : "visible"
      // driver.js counts steps behind a click as missing and calls this one
      // the last; the label comes from what will really follow
      popover.nextButton.innerHTML = esc(o.t(left ? "Next" : "Done"))
    },
    onNextClick: next,
    onPrevClick: back,
    onDoneClick: next,
    onCloseClick: () => stop(),
    onDestroyed: () => end(),
  })

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") return stop()
    if (typing(e.target) || e.altKey || e.ctrlKey || e.metaKey) return
    const rtl = document.documentElement.dir === "rtl"
    if (e.key === (rtl ? "ArrowLeft" : "ArrowRight")) next()
    else if (e.key === (rtl ? "ArrowRight" : "ArrowLeft")) back()
  }
  window.addEventListener("keyup", onKey)

  function end() {
    if (ended) return
    ended = true
    unwatch()
    window.removeEventListener("keyup", onKey)
    o.onEnd(finished)
  }

  function stop() {
    // destroy() skips onDestroyed while a step is still waiting for its
    // anchor, so end() runs here too
    if (d.isActive()) d.destroy()
    end()
  }

  if (!steps.length) {
    end()
    return () => {}
  }
  if (routes[0] && routes[0] !== o.path()) o.navigate(routes[0])
  d.drive(0)
  return stop
}
