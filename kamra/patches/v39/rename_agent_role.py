"""The assistant's role is "Hotel Agent", not upstream's "Kamra Agent".

Runs before the doctypes sync, so the permissions they carry find the role
under its new name. rename_doc follows every link to it: users' Has Role
rows, DocPerm and Custom DocPerm, Role Profiles.
"""

import frappe

OLD, NEW = "Kamra Agent", "Hotel Agent"


def execute():
	if not frappe.db.exists("Role", OLD) or frappe.db.exists("Role", NEW):
		return
	frappe.rename_doc("Role", OLD, NEW, force=True)
	frappe.clear_cache()
