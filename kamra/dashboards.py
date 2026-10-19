"""Operational dashboards - one property, and the whole portfolio.

Property dashboard: the day at a glance for a single hotel, arranged by
department (front desk / housekeeping / finance) on top of the numbers the
manager flash already computes. Portfolio dashboard: the same headline
metrics rolled up across every property the signed-in user can access, with
a per-property table - the chain's central view.
"""

import frappe
from frappe import _
from frappe.utils import date_diff, getdate, nowdate

from kamra.authz import require_roles

# Longest period a dashboard reports on in one call.
_MAX_PERIOD_DAYS = 366


def _resolve_period(from_date: str | None, to_date: str | None, date: str):
	"""from_date..to_date inclusive; either end left out falls back to `date`."""
	end = getdate(to_date or date)
	start = getdate(from_date) if from_date else end
	if start > end:
		frappe.throw(_("The start date is after the end date."))
	if date_diff(end, start) >= _MAX_PERIOD_DAYS:
		frappe.throw(_("Choose a period of at most {0} days.").format(_MAX_PERIOD_DAYS))
	return str(start), str(end)


def _period_collections(property: str, start: str, end: str) -> float:
	"""Money taken over the period, by the cashier summary's rule
	(kamra.cashier.cash_summary_v2): a day the till was used counts its
	cashier transactions, any other day its folio payments."""
	till = frappe.db.sql(
		"""SELECT business_date, kind, COALESCE(SUM(amount), 0) AS total
		   FROM `tabCashier Transaction`
		   WHERE property = %(p)s AND business_date BETWEEN %(s)s AND %(e)s
		   GROUP BY business_date, kind""",
		{"p": property, "s": start, "e": end}, as_dict=True)
	till_days = {str(r.business_date) for r in till}
	total = sum(float(r.total or 0) for r in till
	            if r.kind not in ("Paid Out", "Drop", "Petty Cash"))
	folio = frappe.db.sql(
		"""SELECT fp.posting_date, COALESCE(SUM(fp.amount), 0) AS total
		   FROM `tabFolio Payment` fp
		   JOIN `tabFolio` f ON fp.parent = f.name
		   WHERE f.property = %(p)s AND fp.posting_date BETWEEN %(s)s AND %(e)s
		   GROUP BY fp.posting_date""",
		{"p": property, "s": start, "e": end}, as_dict=True)
	total += sum(float(r.total or 0) for r in folio
	             if str(r.posting_date) not in till_days)
	return round(total, 0)


def _period_stats(property: str, start: str, end: str, total_rooms: int):
	"""Room nights, revenue and the rates on top of them for any span of
	days - kamra.reports._day_stats summed the way the flash sums its month
	to date, in one query instead of one per day."""
	row = frappe.db.sql(
		"""
		SELECT
		  COUNT(DISTINCT CASE WHEN fc.charge_type = 'Room'
		        THEN CONCAT(COALESCE(fc.reservation, f.reservation), '|',
		                    fc.posting_date) END) AS room_nights,
		  COALESCE(SUM(CASE WHEN fc.charge_type = 'Room'
		        THEN fc.amount ELSE 0 END), 0) AS room_revenue,
		  COALESCE(SUM(CASE WHEN fc.charge_type IN ('Food & Beverage',
		        'Meal Plan', 'Minibar') THEN fc.amount ELSE 0 END), 0)
		        AS fnb_revenue,
		  COALESCE(SUM(CASE WHEN fc.charge_type NOT IN ('Room',
		        'Food & Beverage', 'Meal Plan', 'Minibar', 'Discount')
		        THEN fc.amount ELSE 0 END), 0) AS other_revenue
		FROM `tabFolio Charge` fc
		JOIN `tabFolio` f ON fc.parent = f.name
		WHERE f.property = %(p)s AND fc.posting_date BETWEEN %(s)s AND %(e)s
		""",
		{"p": property, "s": start, "e": end}, as_dict=True)[0]
	days = date_diff(end, start) + 1
	capacity = total_rooms * days
	nights = int(row.room_nights or 0)
	rev = float(row.room_revenue or 0)
	fnb = float(row.fnb_revenue or 0)
	other = float(row.other_revenue or 0)
	return {
		"from_date": start,
		"to_date": end,
		"days": days,
		"room_nights": nights,
		"occupancy_pct": round(100 * nights / capacity, 1) if capacity else 0,
		"room_revenue": round(rev, 0),
		"fnb_revenue": round(fnb, 0),
		"other_revenue": round(other, 0),
		"revenue": round(rev + fnb + other, 0),
		"adr": round(rev / nights, 0) if nights else 0,
		"revpar": round(rev / capacity, 0) if capacity else 0,
		"collections": _period_collections(property, start, end),
	}


def _housekeeping_slice(property: str):
	"""Room-status breakdown + task load for the housekeeping department."""
	rooms = frappe.get_all(
		"Room", filters={"property": property},
		fields=["housekeeping_status", "occupancy_status"])
	status = {"Clean": 0, "Dirty": 0, "Inspected": 0, "Out of Order": 0}
	occupied = 0
	for r in rooms:
		status[r.housekeeping_status] = status.get(r.housekeeping_status, 0) + 1
		if r.occupancy_status == "Occupied":
			occupied += 1
	from frappe.utils import now_datetime
	open_tasks = frappe.get_all(
		"Housekeeping Task",
		filters={"property": property, "status": ("in", ["Pending", "In Progress"])},
		fields=["due_by"])
	now = now_datetime()
	overdue = sum(
		1 for t in open_tasks
		if t.due_by and frappe.utils.get_datetime(t.due_by) < now)
	return {
		"room_status": status,
		"occupied": occupied,
		"vacant": len(rooms) - occupied,
		"open_tasks": len(open_tasks),
		"overdue_tasks": overdue,
	}


def _finance_slice(property: str, date: str):
	"""Collections today (by mode), and money still owed on open folios."""
	from kamra.api import cash_summary
	collections = cash_summary(property, date)
	outstanding = frappe.db.sql(
		"""SELECT COALESCE(SUM(balance), 0) FROM `tabFolio`
		   WHERE property = %(p)s AND status = 'Open'""",
		{"p": property})[0][0]
	open_folios = frappe.db.count(
		"Folio", {"property": property, "status": "Open"})
	return {
		"collections_today": collections.get("grand_total", 0),
		"collections_by_mode": collections.get("modes", []),
		"outstanding": float(outstanding or 0),
		"open_folios": open_folios,
	}


@frappe.whitelist()
@require_roles("Front Desk", "Finance", "Revenue Manager", "Hotel Admin", "Hotel Agent")
def property_dashboard(property: str, date: str | None = None,
                       from_date: str | None = None, to_date: str | None = None):
	"""Everything one hotel's dashboard needs, by department. `period`
	covers from_date..to_date (default: `date`); the rest is `date`."""
	from kamra.crs import assert_property_access
	assert_property_access(property)
	date = date or nowdate()
	start, end = _resolve_period(from_date, to_date, date)
	from kamra.reports import manager_flash
	flash = manager_flash(property, date)
	today = flash.get("today") or {}
	mtd = flash.get("mtd") or {}
	move = flash.get("movement") or {}
	finance = _finance_slice(property, date)
	hk = _housekeeping_slice(property)

	return {
		"property": property,
		"property_name": frappe.db.get_value("Property", property, "property_name"),
		"date": date,
		"total_rooms": flash.get("total_rooms", 0),
		# headline metrics
		"occupancy_pct": today.get("occupancy_pct", 0),
		"arrivals": move.get("arrivals", 0),
		"departures": move.get("departures", 0),
		"in_house": move.get("in_house", 0),
		"no_shows": move.get("no_shows", 0),
		"revenue_today": round(
			today.get("room_revenue", 0) + today.get("fnb_revenue", 0)
			+ today.get("other_revenue", 0), 0),
		"collections_today": finance["collections_today"],
		# statistics (month to date)
		"statistics": {
			"mtd_occupancy_pct": mtd.get("occupancy_pct", 0),
			"mtd_revenue": round(mtd.get("room_revenue", 0)
			                     + mtd.get("fnb_revenue", 0)
			                     + mtd.get("other_revenue", 0), 0),
			"adr": mtd.get("adr", 0),
			"revpar": mtd.get("revpar", 0),
			"rooms_sold_mtd": mtd.get("rooms_sold", 0),
		},
		# department dashboards
		"front_desk": {
			"arrivals": move.get("arrivals", 0),
			"departures": move.get("departures", 0),
			"in_house": move.get("in_house", 0),
			"no_shows": move.get("no_shows", 0),
		},
		"housekeeping": hk,
		"finance": finance,
		"outlook": flash.get("outlook", []),
		"period": _period_stats(property, start, end, flash.get("total_rooms", 0)),
	}


def _property_summary(property: str, start: str, end: str):
	"""Compact headline numbers for one property in the portfolio table:
	the period's business, and what is in house and owed right now."""
	total_rooms = frappe.db.count("Room", {"property": property}) or 0
	s = _period_stats(property, start, end, total_rooms)
	outstanding = frappe.db.sql(
		"""SELECT COALESCE(SUM(balance), 0) FROM `tabFolio`
		   WHERE property = %(p)s AND status = 'Open'""",
		{"p": property})[0][0]
	return {
		"property": property,
		"property_name": frappe.db.get_value("Property", property, "property_name"),
		"total_rooms": total_rooms,
		"occupancy_pct": s["occupancy_pct"],
		"rooms_sold": s["room_nights"],
		"arrivals": frappe.db.count("Reservation", {
			"property": property, "check_in_date": ("between", [start, end]),
			"status": ("in", ["Confirmed", "Checked In", "Checked Out"])}),
		"departures": frappe.db.count("Reservation", {
			"property": property, "check_out_date": ("between", [start, end]),
			"status": ("in", ["Checked In", "Checked Out"])}),
		"in_house": frappe.db.count("Reservation", {
			"property": property, "status": "Checked In"}),
		"revenue": s["revenue"],
		"collections": s["collections"],
		"outstanding": float(outstanding or 0),
	}


@frappe.whitelist()
@require_roles("Finance", "Revenue Manager", "Hotel Admin", "Hotel Agent")
def portfolio_dashboard(date: str | None = None,
                        from_date: str | None = None, to_date: str | None = None):
	"""The chain's central view: headline metrics rolled up across every
	property the signed-in user may access, plus a per-property table.
	Covers from_date..to_date (default: `date`, which defaults to today)."""
	date = date or nowdate()
	start, end = _resolve_period(from_date, to_date, date)
	from kamra.api import my_properties
	props = [p["name"] for p in my_properties()]
	rows = [_property_summary(p, start, end) for p in props]
	for r in rows:
		# names from before the period existed, kept for API callers
		r["revenue_today"], r["collections_today"] = r["revenue"], r["collections"]

	rooms = sum(r["total_rooms"] for r in rows)
	sold = sum(r["rooms_sold"] for r in rows)
	capacity = rooms * (date_diff(end, start) + 1)
	revenue = round(sum(r["revenue"] for r in rows), 0)
	collections = round(sum(r["collections"] for r in rows), 0)
	totals = {
		"properties": len(rows),
		"total_rooms": rooms,
		"occupancy_pct": round(100 * sold / capacity, 1) if capacity else 0,
		"arrivals": sum(r["arrivals"] for r in rows),
		"departures": sum(r["departures"] for r in rows),
		"in_house": sum(r["in_house"] for r in rows),
		"revenue": revenue,
		"collections": collections,
		"revenue_today": revenue,
		"collections_today": collections,
		"outstanding": round(sum(r["outstanding"] for r in rows), 0),
	}
	rows.sort(key=lambda r: r["revenue"], reverse=True)
	return {"date": date, "from_date": start, "to_date": end,
	        "totals": totals, "properties": rows}
