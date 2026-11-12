# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class Room(Document):
	def validate(self):
		self.validate_housekeeping_status_change()

	def validate_housekeeping_status_change(self):
		"""The rule of api.set_housekeeping_status on every path (REST, the
		Desk form, bulk edit): an attendant marks a room Clean or Dirty;
		passing a room, or taking it out of order and so out of sale, is a
		supervisor's call."""
		if self.is_new() or not self.has_value_changed("housekeeping_status"):
			return
		from kamra.api import _ATTENDANT_STATUSES, _is_room_supervisor
		if self.housekeeping_status not in _ATTENDANT_STATUSES \
				and not _is_room_supervisor():
			frappe.throw(
				_("Only a housekeeping supervisor can set a room to {0}.").format(
					self.housekeeping_status),
				frappe.PermissionError)

	def after_insert(self):
		# Keep Sellable Units in sync with physical inventory (ADR-001).
		try:
			from kamra.siu.units import ensure_individual_siu
			ensure_individual_siu(self.name)
		except Exception:
			frappe.log_error(title="Sellable Unit sync on Room insert")
