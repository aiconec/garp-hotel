"""Outbound HTTP for the channel-manager adapters, held to each provider's
own API hosts.

A connection's endpoint is typed in by a Revenue Manager, a Hotel Admin or a
trial owner, and the hourly ARI push POSTs to it from inside the shared
container. Sent wherever it pointed, that is a request to the container's
loopback or the platform's private network, with the reply read back into the
push status. So an endpoint must be:
  - https on the standard port, with no credentials in it;
  - on a host the provider serves its API from (PROVIDER_HOSTS), checked when
    the connection is saved and again on every request, so a connection saved
    before this rule fails its next push instead of reaching inside;
  - a name that resolves only to public addresses. The request is then made
    to the address that was checked, with the host name sent for TLS and
    checked against the certificate, so the name can't be re-pointed at an
    inner address between the check and the request. No redirects.
A reply's body is the caller's to parse, never to echo: errors carry the
HTTP status only.

Same approach as the lending app's webhook delivery (paylater integration
safe_url / post_pinned), kept here so Hotel doesn't depend on Lending.
"""

from __future__ import annotations

import ipaddress
import json
import socket
from urllib.parse import urlencode, urlparse

import frappe
from frappe import _

# provider -> the domains its API is served from (the domain or a subdomain)
PROVIDER_HOSTS = {
	"Channex": ("channex.io",),
	"STAAH": ("staah.net", "staah.com"),
	"AioSell": ("aiosell.com",),
}


class ChannelHTTPError(frappe.ValidationError):
	"""A request that was refused or didn't get through, in words fit to show
	in the push status."""


def _url_form(url: str):
	parsed = urlparse((url or "").strip())
	if parsed.scheme != "https" or not parsed.hostname:
		raise ChannelHTTPError(_("The channel manager endpoint must start with https://."))
	if parsed.username or parsed.password:
		raise ChannelHTTPError(_("Leave credentials out of the channel manager endpoint."))
	try:
		port = parsed.port
	except ValueError:
		port = -1
	if port not in (None, 443):
		raise ChannelHTTPError(_("The channel manager endpoint must use the standard HTTPS port (443)."))
	return parsed


def _assert_provider_host(provider: str, host: str) -> None:
	domains = PROVIDER_HOSTS.get(provider)
	if domains is None:
		return  # a provider added by another app brings its own transport
	host = host.lower().rstrip(".")
	if not any(host == d or host.endswith("." + d) for d in domains):
		raise ChannelHTTPError(_("The {0} endpoint must be on {1}.").format(
			provider, " or ".join(domains)))


def public_addresses(host: str) -> list[str]:
	"""Every address the host resolves to, all of them public, or a refusal.
	IPv4 first: the container's way out is IPv4."""
	try:
		infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
	except (socket.gaierror, UnicodeError):
		raise ChannelHTTPError(_("{0} can't be found.").format(host))
	out = []
	for info in infos:
		ip = ipaddress.ip_address(info[4][0])
		if not ip.is_global or ip.is_multicast:
			raise ChannelHTTPError(_("The channel manager endpoint must point to a public server."))
		if str(ip) not in out:
			out.append(str(ip))
	if not out:
		raise ChannelHTTPError(_("{0} can't be found.").format(host))
	return sorted(out, key=lambda a: ipaddress.ip_address(a).version)


def check_endpoint(provider: str, url: str) -> str:
	"""Refuse an endpoint this provider doesn't serve, or one that isn't a
	public https server. Returns the URL, trimmed."""
	parsed = _url_form(url)
	_assert_provider_host(provider, parsed.hostname)
	public_addresses(parsed.hostname)
	return (url or "").strip()


class Reply:
	def __init__(self, status: int, content: bytes):
		self.status_code = status
		self.content = content or b""

	@property
	def ok(self) -> bool:
		return 200 <= self.status_code < 300

	@property
	def text(self) -> str:
		return self.content.decode("utf-8", "replace")

	def json(self):
		return json.loads(self.content or b"null")


def request(provider: str, method: str, url: str, *, params: dict | None = None,
            json_body=None, data: bytes | str | None = None,
            headers: dict | None = None, basic_auth: tuple[str, str] | None = None,
            timeout: int = 20) -> Reply:
	"""One HTTPS request to a provider's API, on the address its host
	resolved to when checked. Raises ChannelHTTPError when the endpoint is
	refused or the server can't be reached; any HTTP status is a Reply."""
	parsed = _url_form(url)
	host = parsed.hostname
	_assert_provider_host(provider, host)
	address = public_addresses(host)[0]  # checked and connected to: one lookup

	import certifi
	import urllib3

	path = parsed.path or "/"
	query = "&".join(q for q in (parsed.query, urlencode(params or {})) if q)
	if query:
		path += "?" + query
	send = {**(headers or {}), "Host": host}
	body = None
	if json_body is not None:
		body = json.dumps(json_body).encode()
		send.setdefault("Content-Type", "application/json")
	elif data is not None:
		body = data.encode() if isinstance(data, str) else data
	if basic_auth:
		send.update(urllib3.util.make_headers(basic_auth=f"{basic_auth[0]}:{basic_auth[1]}"))

	pool = urllib3.HTTPSConnectionPool(
		address, port=443, server_hostname=host, assert_hostname=host,
		cert_reqs="CERT_REQUIRED", ca_certs=certifi.where(),
		timeout=urllib3.Timeout(total=timeout), retries=False, maxsize=1,
	)
	try:
		r = pool.urlopen(method, path, body=body, headers=send,
		                 redirect=False, assert_same_host=False)
		return Reply(r.status, r.data)
	except urllib3.exceptions.SSLError:
		raise ChannelHTTPError(_("{0}'s TLS certificate was not accepted.").format(host))
	except Exception:
		raise ChannelHTTPError(_("Could not reach {0}.").format(host))
	finally:
		pool.close()
