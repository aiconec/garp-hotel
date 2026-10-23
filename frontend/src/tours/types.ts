/** What a tour can know about the person taking it. */
export interface TourContext {
  roles: string[]
  canBook: boolean
  /** More than one property to switch between. */
  multiProperty: boolean
  /** More than one app to switch between. */
  multiApp: boolean
  /** The side menu is on screen, not behind the menu button. Set at start. */
  rail: boolean
}

export interface TourStep {
  /** `data-tour` anchor(s) to spotlight; the first one on screen wins (the
   *  rail and the drawer both hold the menu, and only one shows). None = a
   *  centred card. */
  at?: string | string[]
  title: string
  /** English source, translated at run time; **bold** and `keys` render. */
  body: string
  /** Page the step lives on; later steps stay there until one names another. */
  route?: string
  side?: "top" | "right" | "bottom" | "left"
  align?: "start" | "center" | "end"
  /** The person clicks the spotlit control (Next clicks it for them), and the
   *  tour moves on once the next step's anchor appears. */
  action?: boolean
  /** On an action step: the click opens another page (a folio, a guest), so
   *  later steps stay wherever it lands instead of returning to this one. */
  leavesPage?: boolean
  /** Let the person use the spotlit control, e.g. type in a field. */
  interactive?: boolean
  /** Skip the step when its anchor never shows (no data, a closed session). */
  optional?: boolean
  /** No Back: the step before it sits behind a dialog this step opened. */
  noBack?: boolean
  when?: (ctx: TourContext) => boolean
}

export interface Tour {
  /** Slug, also the key the server stores progress under (kamra.tours). */
  id: string
  /** Bump when the steps change enough to flag the tour as updated. */
  version: number
  title: string
  summary: string
  /** App in lib/apps it belongs to; none = getting started, for everyone. */
  app?: string
  /** Page it starts on and is suggested on. None = wherever you are. */
  route?: string
  /** Lives on a page of its own outside the app shell (the housekeeping
   *  phone app at /hk). Started from the shell, it opens that page. */
  standalone?: boolean
  minutes: number
  /** Tours to suggest once this one is finished; the first open one wins. */
  next?: string[]
  when?: (ctx: Omit<TourContext, "rail">) => boolean
  steps: TourStep[]
}

export type TourStatus = "done" | "dismissed"

export interface TourState {
  tours: Record<string, { s: TourStatus; v: number; at?: string }>
  /** Suggest a page's tour the first time it's opened. */
  offers: boolean
}
