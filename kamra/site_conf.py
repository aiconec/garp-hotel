"""Site config switches, under BizConnect.id names.

The keys were `kamra_<name>` upstream; the hotel's own keys are
`hotel_<name>`. Patch v39 renames them in each site's site_config.json, and
until a site has migrated the old key still answers, so a deploy never flips
a switch.
"""

import frappe

# every key read through site_conf(); the patch renames exactly these
KEYS = (
	"ai_enabled",
	"ai_hosts",
	"mcp_enabled",
	"mcp_disabled",
	"public_max_nights",
	"public_max_days_ahead",
	"razorpay_signup_url",
	"cashfree_signup_url",
)


def site_conf(name: str, default=None):
	"""`hotel_<name>` from site config, else the upstream `kamra_<name>`."""
	value = frappe.conf.get(f"hotel_{name}")
	if value is None:
		value = frappe.conf.get(f"kamra_{name}")
	return default if value is None else value
