# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class Property(Document):
	# The property's time zone is the hotel's own setting: business dates and
	# "today" at the property read it (kamra.business_date). Saving it does not
	# touch System Settings: the workspace clock is shared with every other
	# app on the site (accounting, HR, POS) and belongs to its administrator.
	# Hotel's health page says so when the two differ.
	pass
