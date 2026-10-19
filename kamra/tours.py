"""Guided tours: which walkthroughs each person has finished or waved off.

The tours themselves live in the SPA (frontend/src/tours). The server only
remembers, per user, how each one ended, so a tour finished on the front-desk
PC is not offered again on the tablet. Stored as a user default, like the
update nag's dismissal.
"""

from __future__ import annotations

import json
import re

import frappe
from frappe.utils import cint, now_datetime

STATE_KEY = "kamra_tours"
STATUSES = ("done", "dismissed")
# Tour ids are short slugs from the SPA's registry; anything else is noise.
TOUR_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
# A user default is one text row: keep it far from any size limit.
MAX_TOURS = 60


def _read() -> dict:
	raw = frappe.defaults.get_user_default(STATE_KEY, user=frappe.session.user)
	if not raw:
		return {}
	try:
		data = json.loads(raw) if isinstance(raw, str) else raw
	except (TypeError, ValueError):
		return {}
	return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
	frappe.defaults.set_user_default(STATE_KEY, json.dumps(data, separators=(",", ":")))


def _public(data: dict) -> dict:
	tours = data.get("tours")
	return {
		"tours": tours if isinstance(tours, dict) else {},
		# Suggestions on a page's first visit; the Guides list works either way.
		"offers": data.get("offers", True) is not False,
	}


@frappe.whitelist()
def tour_state():
	"""How each tour ended for the signed-in user."""
	return _public(_read())


@frappe.whitelist(methods=["POST"])
def save_tour(tour: str, status: str, version: int = 1):
	"""Record that the user finished (done) or closed (dismissed) a tour."""
	tour = (tour or "").strip()
	if not TOUR_ID.match(tour):
		frappe.throw("Unknown tour.")
	if status not in STATUSES:
		frappe.throw("Unknown tour status.")

	data = _read()
	tours = data.get("tours") if isinstance(data.get("tours"), dict) else {}
	prev = tours.get(tour) if isinstance(tours.get(tour), dict) else {}
	# Closing a tour you once finished doesn't un-finish it.
	if prev.get("s") == "done" and status == "dismissed":
		status = "done"
	tours[tour] = {"s": status, "v": max(1, cint(version)), "at": str(now_datetime())[:19]}
	if len(tours) > MAX_TOURS:
		for old in sorted(tours, key=lambda k: str(tours[k].get("at", "")))[: len(tours) - MAX_TOURS]:
			tours.pop(old, None)
	data["tours"] = tours
	_write(data)
	return _public(data)


@frappe.whitelist(methods=["POST"])
def set_tour_offers(enabled: int = 1):
	"""Turn the first-visit tour suggestions on or off for the user."""
	data = _read()
	data["offers"] = bool(cint(enabled))
	_write(data)
	return _public(data)


@frappe.whitelist(methods=["POST"])
def reset_tours():
	"""Forget every tour, so each is offered again."""
	data = _read()
	data["tours"] = {}
	data["offers"] = True
	_write(data)
	return _public(data)
