# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class AIAssistantSettings(Document):
	def validate(self):
		# the key and guest data go to base_url, so only listed hosts
		from kamra.assistant import check_base_url

		# only when it changes: a stored address that is no longer allowed
		# must not stop an admin switching the assistant off
		if self.base_url and self.has_value_changed("base_url"):
			self.base_url = check_base_url(self.base_url)
