/** Window events the tour host in AppShell listens for, so any part of the
 *  app (sidebar, account menu, search) can reach the tours without props. */

export const OPEN_GUIDES = "kamra:open-guides"
export const START_TOUR = "kamra:start-tour"

/** Open the Guides list. */
export const openGuides = () => window.dispatchEvent(new Event(OPEN_GUIDES))

/** Start a tour by id. */
export const startTour = (id: string) =>
  window.dispatchEvent(new CustomEvent(START_TOUR, { detail: id }))
