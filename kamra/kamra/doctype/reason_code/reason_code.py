# Copyright (c) 2026, Kamra and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class ReasonCode(Document):
	def validate(self):
		self.supervisors_only()

	def on_trash(self):
		self.supervisors_only()

	def supervisors_only(self):
		"""Reason codes decide which voids, refunds, comps and rate changes
		need a supervisor, so only a supervisor adds, changes or removes one:
		a cashier who could untick "requires supervisor" would be approving
		themselves. Hotel seeding its default codes is not a user edit."""
		from kamra.authz import kamra_initiated
		from kamra.ledger import is_supervisor
		if is_supervisor() or kamra_initiated():
			return
		frappe.throw(
			_("Only a supervisor (Hotel Admin or Finance) can change reason codes."),
			frappe.PermissionError)
