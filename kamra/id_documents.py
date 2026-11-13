"""Guest ID scans - the only place in Kamra that writes a private file.

Two callers, one gate: the guest's token-gated self check-in
(public_api.precheckin_upload_id) and the desk's authenticated counter
capture (api.upload_id_document). Both land in the same shape, so retention
only ever has to know about one shape.

Three things here are deliberate and will look wrong to someone skimming:

1. is_private=1 IS A LITERAL, never a parameter. Frappe's own upload_file
   takes is_private from the client form_dict - i.e. it trusts the browser to
   protect an Aadhaar scan. Nothing in this module can be talked into writing
   an ID where the public web can read it, because there is no argument that
   would do it.

2. THE FILE HANGS OFF THE RESERVATION, NOT THE GUEST. Guest is a shared
   profile keyed by phone, reused across stays. If the scan lived there,
   checkout of one stay would delete a document a repeat guest's OTHER live
   stay still needs. (_scrub_stay_ids already has that bug for the id_number
   TEXT - tolerable, the desk retypes it. For a file it is irreversible.)
   Attaching per-reservation makes cross-stay safety structural.

3. RE-ENCODING IS THE SECURITY BOUNDARY, not the format check. See _sanitise.

The image is deleted at checkout under the property's "Verify & Discard"
retention (see discard_id_document, called from api._scrub_stay_ids). Note
for anyone reading this before an audit: `bench backup --with-files` tars
private/files, so a scan survives in backups after that delete. No code here
fixes that; it is a backup-rotation decision. Do not let the guest-facing
copy over-promise.
"""

import base64
import io
import sys

import frappe
from frappe import _

# The client downscales to ~400KB before sending; this is the ceiling for a
# hostile caller, not a target. Capped BEFORE decode - a 500MB base64 string
# must not become 375MB of RAM on the way to being rejected.
MAX_BYTES = 4 * 1024 * 1024
MAX_EDGE = 2000
ALLOWED_FORMATS = {"JPEG", "PNG"}
DOC_FIELD = "id_document"
ACTIVE_STATUSES = ("Confirmed", "Checked In")


def _decode(data: str) -> bytes:
	"""data:image/jpeg;base64,... -> bytes."""
	if not data or not str(data).startswith("data:image/") or "," not in data:
		frappe.throw(_("Please upload a photo of your ID."))
	b64 = data.split(",", 1)[1]
	# 4/3 is base64's expansion; check the encoded length first so we never
	# allocate the decoded payload of something absurd.
	if len(b64) > (MAX_BYTES * 4 // 3) + 1024:
		frappe.throw(_("That photo is too large. Please retake it."))
	try:
		raw = base64.b64decode(b64, validate=True)
	except Exception:
		frappe.throw(_("That file didn't upload correctly. Please try again."))
	if not raw:
		frappe.throw(_("Please upload a photo of your ID."))
	if len(raw) > MAX_BYTES:
		frappe.throw(_("That photo is too large. Please retake it."))
	return raw


def _sanitise(raw: bytes) -> bytes:
	"""Return bytes we are certain are a plain JPEG, because we made them.

	Sniffing magic bytes only tells you the first few bytes look like an
	image; a JPEG with a webshell appended still starts with \\xff\\xd8.
	Re-encoding guarantees the OUTPUT is a JPEG this function wrote, so
	polyglots and appended payloads die on the way through rather than being
	detected. It also strips EXIF - which on a phone photo of an Aadhaar card
	carries the GPS coordinates of the guest's home.

	Never trust the filename or the Content-Type; Pillow's verdict is the
	only one that counts.
	"""
	from PIL import Image

	try:
		probe = Image.open(io.BytesIO(raw))
		probe.verify()  # structural check; leaves the object unusable
		fmt = probe.format
	except frappe.ValidationError:
		raise
	except Exception:
		frappe.throw(_("That doesn't look like a photo. Please retake it."))
		raise  # frappe.throw always raises; CodeQL does not treat it as noreturn
	if fmt not in ALLOWED_FORMATS:
		frappe.throw(_("Please upload a JPG or PNG photo."))
		raise
	try:
		img = Image.open(io.BytesIO(raw))  # reopen: verify() consumed it
		img = img.convert("RGB")  # drops alpha/palette tricks
		img.thumbnail((MAX_EDGE, MAX_EDGE))
		out = io.BytesIO()
		img.save(out, format="JPEG", quality=82)  # no exif= -> stripped
		return out.getvalue()
	except Exception:
		frappe.throw(_("That photo couldn't be processed. Please retake it."))
		raise


def _existing(reservation: str) -> list:
	"""Files already attached to this booking's ID field. Queried by the
	attachment fields rather than by parsing Reservation.id_document, so a
	file orphaned by a half-failed replace is still found and cleaned up."""
	return frappe.get_all("File", filters={
		"attached_to_doctype": "Reservation",
		"attached_to_name": reservation,
		"attached_to_field": DOC_FIELD,
	}, pluck="name")


def store_id_document(res, data: str, source: str) -> str:
	"""Replace (never append) this booking's ID scan. Returns the file_url.

	`res` is a Reservation doc. This function does NOT check who is calling -
	the caller proves that: the guest endpoint by resolving a 96-bit token,
	the desk endpoint by @require_roles.
	"""
	if res.status not in ACTIVE_STATUSES:
		frappe.throw(_("This booking is no longer active."))

	clean = _sanitise(_decode(data))

	for old in _existing(res.name):  # one scan per booking, always
		try:
			frappe.delete_doc("File", old, ignore_permissions=True,
			                  delete_permanently=True)
		except Exception:
			frappe.log_error(title=f"ID document: stale file kept ({res.name})")

	from frappe.utils.file_manager import save_file
	f = save_file(
		fname=f"id-{res.name}.jpg",
		content=clean,
		dt="Reservation",
		dn=res.name,
		df=DOC_FIELD,
		is_private=1,
		folder="Home/Attachments",
	)
	frappe.db.set_value("Reservation", res.name, {
		DOC_FIELD: f.file_url,
		"id_document_source": source,
		"id_document_on": frappe.utils.now_datetime(),
		"id_document_discarded": 0,
	}, update_modified=False)
	return f.file_url


def discard_id_document(reservation: str) -> int:
	"""Verify & Discard: the scan leaves with the guest. Returns how many
	files went.

	Deliberately swallows its own errors. This runs inside checkout - a file
	Frappe cannot delete must never strand a guest at the desk with their
	luggage in the lobby. It logs and lets checkout finish; the leftover is a
	cleanup problem, not a service-stopping one.

	delete_doc, never os.unlink: File.on_trash -> delete_file_data_content
	handles the disk unlink AND the case where another File row shares the
	same content hash. Unlinking by hand would corrupt an unrelated
	attachment. delete_permanently=True because otherwise Frappe keeps a
	Deleted Document row holding the filename and trail - and "we deleted it"
	should mean it.
	"""
	gone = 0
	try:
		for name in _existing(reservation):
			frappe.delete_doc("File", name, ignore_permissions=True,
			                  delete_permanently=True)
			gone += 1
		frappe.db.set_value("Reservation", reservation, {
			DOC_FIELD: None,
			"id_document_discarded": 1,
		}, update_modified=False)
	except Exception:
		frappe.log_error(title=f"ID document discard failed: {reservation}")
	return gone


# ---------------------------------------------------------------------------
# Who may open a scan
# ---------------------------------------------------------------------------
#
# A scan is a private File attached to its booking (or, for the guest's own
# ID and address proof, to the Guest profile). Frappe lets anyone who may
# READ that booking or profile download it: File.has_permission falls through
# to the attached document. Housekeeping, Finance and Revenue Manager all read
# bookings, so on Frappe's terms they could fetch every guest's KTP or
# passport. A scan is for the people who check IDs - the roles that read the
# permlevel-1 ID fields, the same ones id_document_image admits - whatever
# else a role may read.
#
# Frappe reaches a File's permission three ways, and each needs its own gate:
#   - frappe.has_permission on the File (REST /api/resource/File/<name>, the
#     Desk form): the File has_permission hook, file_has_permission.
#   - the module function File.has_permission, called directly by the
#     /private/files/ download, download_file, zip_files and the cloud-storage
#     redirect. It consults no hook for File; it asks the attached document.
#     So the Reservation and Guest hooks (holder_has_permission) refuse the
#     read when it is being asked on behalf of a scan.
#   - lists of File rows (REST lists, the form's attachment sidebar): the
#     File permission_query_conditions hook, and the getdoc / get_docinfo /
#     get_filtered_attachments overrides, leave scans out for everyone else.
# The rule reads the File row, so scans attached before this rule are covered
# too.

ID_VIEWER_ROLES = ("Front Desk", "Hotel Agent", "Hotel Admin", "System Manager")

# where scans hang: the fields they fill, and the names this module and the
# desk give them (id-<booking>.jpg, occupant-id-<booking>-<n>.jpg on a booking;
# id-<guest>.jpg, address-<guest>.jpg on a profile)
_SCAN_FIELDS = {
	"Reservation": ("id_document", "id_file"),
	"Guest": ("id_file", "address_proof_file"),
}
_SCAN_PREFIXES = {
	"Reservation": ("id-", "occupant-id-"),
	"Guest": ("id-", "address-"),
}


def is_id_scan(file) -> bool:
	"""Is this File row (a doc or a dict) a guest's ID or address scan?"""
	doctype = file.get("attached_to_doctype")
	if doctype not in _SCAN_FIELDS:
		return False
	if file.get("attached_to_field") in _SCAN_FIELDS[doctype]:
		return True
	return (file.get("file_name") or "").lower().startswith(_SCAN_PREFIXES[doctype])


def may_view_id_scans(user: str | None = None) -> bool:
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	return bool(set(ID_VIEWER_ROLES) & set(frappe.get_roles(user)))


def file_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""has_permission hook for File. Frappe treats a falsy return as a deny."""
	if not is_id_scan(doc):
		return True
	return may_view_id_scans(user)


def _file_being_authorised():
	"""The File whose permission Frappe's File.has_permission is deciding
	right now, when that is what asked for this booking's or profile's
	permission; else None. That function hands the decision to the attached
	document and passes nothing on, so the frame is the only place the File
	can be read from (kamra.authz.kamra_initiated reads frames the same way)."""
	frame = sys._getframe(1)
	while frame is not None:
		if frame.f_code.co_name == "has_permission" \
				and frame.f_globals.get("__name__") == "frappe.core.doctype.file.file":
			return frame.f_locals.get("doc")
		frame = frame.f_back
	return None


def holder_has_permission(doc, ptype=None, user=None, debug=False) -> bool:
	"""has_permission hook for Reservation and Guest. Reading the booking
	stays as it is; reading it in order to download a scan attached to it is
	refused to anyone who doesn't check IDs."""
	f = _file_being_authorised()
	if f is None or not is_id_scan(f):
		return True
	return may_view_id_scans(user)


def _scan_condition(doctype: str) -> str:
	fields = ", ".join(frappe.db.escape(f) for f in _SCAN_FIELDS[doctype])
	names = " or ".join(
		f"lower(left(coalesce(`tabFile`.`file_name`, ''), {len(p)})) = {frappe.db.escape(p)}"
		for p in _SCAN_PREFIXES[doctype])
	return (f"(`tabFile`.`attached_to_doctype` = {frappe.db.escape(doctype)}"
	        f" and (coalesce(`tabFile`.`attached_to_field`, '') in ({fields}) or {names}))")


def file_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	"""permission_query_conditions hook for File: lists leave scans out for
	anyone who doesn't check IDs (the same rule as is_id_scan)."""
	if may_view_id_scans(user):
		return ""
	holders = ", ".join(frappe.db.escape(dt) for dt in _SCAN_FIELDS)
	scans = " or ".join(_scan_condition(dt) for dt in _SCAN_FIELDS)
	return (f"(coalesce(`tabFile`.`attached_to_doctype`, '') not in ({holders})"
	        f" or not ({scans}))")


def _hide_scans_from_docinfo() -> None:
	"""Drop scans from the docinfo a getdoc / get_docinfo call just built:
	the attachment list and the "Attachment" timeline entries that link them."""
	docinfo = frappe.response.get("docinfo")
	if not docinfo or docinfo.get("doctype") not in _SCAN_FIELDS or may_view_id_scans():
		return
	hidden = [a for a in docinfo.get("attachments") or []
	          if is_id_scan({**a, "attached_to_doctype": docinfo.doctype})]
	if not hidden:
		return
	docinfo.attachments = [a for a in docinfo.attachments if a not in hidden]
	marks = {m for a in hidden for m in (a.get("file_url"), a.get("file_name")) if m}
	docinfo.attachment_logs = [
		c for c in docinfo.get("attachment_logs") or []
		if not any(m in (c.get("content") or "") for m in marks)]


@frappe.whitelist()
def getdoc(doctype: str, name: str | int):
	"""frappe.desk.form.load.getdoc, without other people's ID scans in the
	attachment sidebar (override_whitelisted_methods)."""
	from frappe.desk.form import load
	load.getdoc(doctype, name)
	_hide_scans_from_docinfo()


@frappe.whitelist()
def get_docinfo(doc=None, doctype: str | None = None, name: str | int | None = None):
	"""frappe.desk.form.load.get_docinfo, the same way as getdoc above."""
	from frappe.desk.form import load
	load.get_docinfo(doc, doctype, name)
	_hide_scans_from_docinfo()


@frappe.whitelist()
def get_filtered_attachments(dt: str, dn: str | int, filters: str):
	"""frappe.desk.form.load.get_filtered_attachments (the attachment
	gallery), the same way as getdoc above."""
	from frappe.desk.form import load
	rows = load.get_filtered_attachments(dt, dn, filters)
	if dt in _SCAN_FIELDS and not may_view_id_scans():
		rows = [r for r in rows if not is_id_scan({**r, "attached_to_doctype": dt})]
	return rows
