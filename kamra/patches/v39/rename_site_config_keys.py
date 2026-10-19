"""Site config keys move from `kamra_<name>` to `hotel_<name>`.

Only this site's own site_config.json changes; a value already set under the
new name wins over the old one.
"""

import json

import frappe
from frappe.installer import update_site_config

from kamra.site_conf import KEYS


def execute():
	with open(frappe.get_site_path("site_config.json")) as f:
		site_config = json.load(f)
	for name in KEYS:
		old, new = f"kamra_{name}", f"hotel_{name}"
		if old not in site_config:
			continue
		if new not in site_config:
			update_site_config(new, site_config[old])
		update_site_config(old, "None")
