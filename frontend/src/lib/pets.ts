/** How a property's pet charge reads next to its price - one wording for
 * the booking dialog and both public pages. */
export function petChargeBasis(basis?: string | null) {
  return basis === "Per night" ? "per pet per night" : "per pet per stay"
}
