"""Front-office business date.

Opera advances the business date only after night audit, so a 01:00 charge
still posts to yesterday until the audit rolls the day. Every money and
revenue posting should use get_business_date(property), not nowdate()."""

from __future__ import annotations

import frappe
from frappe.utils import add_days, nowdate


def get_business_date(property: str) -> str:
	"""Current business date for a property; falls back to calendar today."""
	if not property:
		return nowdate()
	bd = frappe.db.get_value("Property", property, "business_date")
	return str(bd) if bd else nowdate()


def property_today(property: str) -> str:
	"""Calendar date at the property, in its own time zone. Built from the
	site's nowdate() plus the day the time zones differ by, so the audit
	tests that pin nowdate pin this too."""
	today = nowdate()
	tz = (frappe.db.get_value("Property", property, "timezone") or "").strip()
	if tz:
		from datetime import datetime
		from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

		from frappe.utils import get_system_timezone

		try:
			now = datetime.now(ZoneInfo(get_system_timezone()))
			shift = (now.astimezone(ZoneInfo(tz)).date() - now.date()).days
			return add_days(today, shift) if shift else today
		except (ZoneInfoNotFoundError, ValueError):
			pass
	return today


def ensure_business_date(property: str) -> str:
	"""Seed business_date if blank, then return it."""
	bd = frappe.db.get_value("Property", property, "business_date")
	if not bd:
		bd = nowdate()
		frappe.db.set_value("Property", property, "business_date", bd,
		                    update_modified=False)
	return str(bd)


def advance_business_date(property: str, from_date: str | None = None) -> str:
	"""Roll the business date forward by one day after a successful night audit."""
	current = from_date or get_business_date(property)
	nxt = add_days(current, 1)
	frappe.db.set_value("Property", property, "business_date", nxt,
	                    update_modified=False)
	return str(nxt)
