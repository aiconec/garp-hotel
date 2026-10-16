"""Front-office business date.

Opera advances the business date only after night audit, so a 01:00 charge
still posts to yesterday until the audit rolls the day. Every money and
revenue posting should use get_business_date(property), not nowdate()."""

from __future__ import annotations

import frappe
from frappe.utils import add_days, getdate, nowdate


def get_business_date(property: str) -> str:
	"""Current business date for a property; falls back to calendar today."""
	if not property:
		return nowdate()
	bd = frappe.db.get_value("Property", property, "business_date")
	return str(bd) if bd else nowdate()


def property_today(property: str) -> str:
	"""Calendar date at the property, in its own time zone; the site clock
	when the property has none (or an unknown one)."""
	tz = (frappe.db.get_value("Property", property, "timezone") or "").strip()
	if tz:
		from datetime import datetime
		from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

		try:
			return datetime.now(ZoneInfo(tz)).date().isoformat()
		except (ZoneInfoNotFoundError, ValueError):
			pass
	return nowdate()


def ensure_business_date(property: str) -> str:
	"""Seed business_date if blank, then return it."""
	bd = frappe.db.get_value("Property", property, "business_date")
	if not bd:
		bd = nowdate()
		frappe.db.set_value("Property", property, "business_date", bd,
		                    update_modified=False)
	return str(bd)


def advance_business_date(property: str, from_date: str | None = None) -> str:
	"""Roll the business date forward by one day after a successful night audit.
	Closing a day that is already past (catching up) never rolls it back."""
	current = get_business_date(property)
	nxt = add_days(from_date or current, 1)
	if getdate(nxt) <= getdate(current):
		return str(current)
	frappe.db.set_value("Property", property, "business_date", nxt,
	                    update_modified=False)
	return str(nxt)
