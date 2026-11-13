import frappe
from frappe.model.document import Document


class ChannelManagerConnection(Document):
	def validate(self):
		self.validate_endpoint()
		# Inbound webhooks are refused until the connection can authenticate
		# them - say so up front instead of letting bookings silently bounce.
		if not self.active:
			return
		if self.provider == "AioSell":
			missing = not (self.api_username and self.api_key)
			what = "API username and API key"
		else:
			missing = not self.webhook_secret
			what = "webhook secret"
		if missing:
			frappe.msgprint(
				f"Set the {what}: inbound bookings from {self.provider} are "
				"rejected until it is configured.",
				indicator="orange", alert=True)

	def validate_endpoint(self):
		"""The ARI push posts to this address from inside the server: only the
		provider's own API hosts, over https, on a public address (see
		kamra.channels.transport). Blank uses the provider's default. Checked
		when it changes; every request checks it again."""
		if not (self.endpoint or "").strip():
			return
		if not (self.is_new() or self.has_value_changed("endpoint")
		        or self.has_value_changed("provider")):
			return
		from kamra.channels.transport import ChannelHTTPError, check_endpoint
		try:
			self.endpoint = check_endpoint(self.provider, self.endpoint)
		except ChannelHTTPError as exc:
			frappe.throw(str(exc), title=frappe._("Endpoint not allowed"))
