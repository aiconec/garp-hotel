"""Give the site root back to BizConnect.

Installing Hotel used to set Website Settings' home page to the hotel screen,
so a tenant that added Hotel opened on the hotel sign-in and app instead of
the BizConnect sign-in and desk. Only the value install wrote is cleared; a
home page someone chose by hand stays.
"""

import frappe
from frappe.website.utils import clear_cache


def execute():
	home = (frappe.db.get_single_value("Website Settings", "home_page") or "").strip().strip("/")
	if home != "kamra":
		return
	frappe.db.set_single_value("Website Settings", "home_page", "")
	clear_cache()
