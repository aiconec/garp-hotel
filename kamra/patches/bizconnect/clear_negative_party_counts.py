"""A booking made before the party was checked may carry a negative head
count: the public booking page took children=-6, and the night audit and
checkout then billed each night below the booked price, or as a credit.
Nothing legitimate is negative, so those counts become 0 (adults: 1, the
fewest a stay may have). New bookings are refused at the source, and the
fields are non_negative, so a row left negative could no longer be saved."""

import frappe


def execute():
	frappe.db.sql("UPDATE `tabReservation` SET adults = 1 WHERE adults < 1")
	for field in ("children", "infants", "extra_beds"):
		frappe.db.sql(  # nosemgrep: frappe-sql-format-injection -- field is a constant from this loop
			f"UPDATE `tabReservation` SET `{field}` = 0 WHERE `{field}` < 0")
