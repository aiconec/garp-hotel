# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

"""The night audit closes one business day per calendar day. A second press
of the button must not post tomorrow's room nights, and the 03:00 run must
not close a day the desk already closed in the evening - either one rolls the
business date ahead of the calendar, and every payment and charge after it
is dated a day late."""

import unittest
from unittest.mock import patch

import frappe
from frappe.utils import add_days

from kamra import folio

PROPERTY = "TEST Audit Calendar Hotel"
TODAY = "2026-03-10"


class TestNightAuditCalendarGuard(unittest.TestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		# run_night_audit commits; keep everything inside this test's transaction
		self._commit = patch("frappe.db.commit")
		self._commit.start()
		self._today = patch("kamra.business_date.property_today", return_value=TODAY)
		self._today.start()
		if not frappe.db.exists("Property", PROPERTY):
			frappe.get_doc({"doctype": "Property", "property_name": PROPERTY,
			                "city": "Testville"}).insert(ignore_permissions=True)

	def tearDown(self):
		self._today.stop()
		self._commit.stop()
		frappe.db.rollback()

	def _set_business_date(self, date: str):
		frappe.db.set_value("Property", PROPERTY, "business_date", date,
		                    update_modified=False)

	def _business_date(self) -> str:
		return str(frappe.db.get_value("Property", PROPERTY, "business_date"))

	def test_desk_closes_today_once(self):
		self._set_business_date(TODAY)
		out = folio.run_night_audit(PROPERTY)
		self.assertEqual(out["business_date"], TODAY)
		self.assertEqual(self._business_date(), add_days(TODAY, 1))

	def test_second_press_cannot_close_tomorrow(self):
		self._set_business_date(TODAY)
		folio.run_night_audit(PROPERTY)
		with self.assertRaises(frappe.ValidationError):
			folio.run_night_audit(PROPERTY)
		self.assertEqual(self._business_date(), add_days(TODAY, 1))
		self.assertFalse(frappe.db.exists(
			"Night Audit Run", {"property": PROPERTY,
			                    "business_date": add_days(TODAY, 1)}))

	def test_scheduled_run_leaves_a_day_that_has_not_ended(self):
		self._set_business_date(TODAY)
		out = folio.run_night_audit(PROPERTY, scheduled=True)
		self.assertTrue(out.get("skipped"))
		self.assertEqual(self._business_date(), TODAY)

	def test_scheduled_run_after_an_evening_audit_does_nothing(self):
		self._set_business_date(add_days(TODAY, -1))
		folio.run_night_audit(PROPERTY)  # the desk, last night
		out = folio.run_night_audit(PROPERTY, scheduled=True)  # 03:00 today
		self.assertTrue(out.get("skipped"))
		self.assertEqual(self._business_date(), TODAY)

	def test_scheduled_run_closes_yesterday(self):
		self._set_business_date(add_days(TODAY, -1))
		out = folio.run_night_audit(PROPERTY, scheduled=True)
		self.assertEqual(out["business_date"], add_days(TODAY, -1))
		self.assertEqual(self._business_date(), TODAY)

	def test_rerunning_a_closed_day_is_still_a_no_op(self):
		self._set_business_date(TODAY)
		folio.run_night_audit(PROPERTY)
		out = folio.run_night_audit(PROPERTY, business_date=TODAY)
		self.assertTrue(out.get("already_ran"))

	def test_closing_a_past_day_never_rewinds_the_business_date(self):
		self._set_business_date(TODAY)
		out = folio.run_night_audit(PROPERTY, business_date=add_days(TODAY, -5))
		self.assertEqual(out["next_business_date"], TODAY)
		self.assertEqual(self._business_date(), TODAY)

	def test_desk_cannot_close_another_day_through_the_api(self):
		from kamra import api

		self._set_business_date(TODAY)
		desk = "audit.desk@test.local"
		if not frappe.db.exists("User", desk):
			frappe.get_doc({"doctype": "User", "email": desk, "first_name": "Desk",
			                "send_welcome_email": 0,
			                "roles": [{"role": "Front Desk"}]}).insert(ignore_permissions=True)
		frappe.set_user(desk)
		try:
			with self.assertRaises(frappe.PermissionError):
				api.run_night_audit(PROPERTY, business_date=add_days(TODAY, -5))
		finally:
			frappe.set_user("Administrator")
		self.assertFalse(frappe.db.exists(
			"Night Audit Run", {"property": PROPERTY,
			                    "business_date": add_days(TODAY, -5)}))
