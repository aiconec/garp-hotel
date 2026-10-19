# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

"""The three ways Kamra Agent talks to a model.

- Claude: Anthropic's Messages API, through the official SDK.
- Responses: OpenAI's /v1/responses. GPT-6.1 Sol and GPT-6 Astra call
  tools only there; Chat Completions refuses tools on them.
- ChatCompletions: /chat/completions on any OpenAI-compatible host
  (Gemini, Groq, OpenRouter, Ollama, Azure, custom).

A Chat lives for one staff question. It starts from the text history,
grows only by appending the model's output and the tool results (Claude
binds its reasoning to the exact conversation it came from), and is
dropped once the answer is out. Nothing here touches the database, so a
Chat can keep streaming after the request handler has returned.
"""

from __future__ import annotations

import json
from typing import NamedTuple
from urllib.parse import urlsplit

import requests

from kamra.llm_compat import chat_payload, is_reasoning_model, retry_chat_payload

TIMEOUT = 60
MAX_TOKENS = 16000

ANTHROPIC_BASE_URL = "https://api.anthropic.com"
OPENAI_HOST = "api.openai.com"

# fallbacks "default": a request Claude's safety classifiers decline is
# answered by another Claude model instead of refused.
CLAUDE_BETAS = ("server-side-fallback-2026-07-01",)
# The words an older Claude model's 400 uses for an option it doesn't take.
CLAUDE_OPTION_WORDS = {"output_config": ("effort", "output_config"),
                       "fallbacks": ("fallback",)}

DECLINED = ("The AI model declined to answer that. Rephrase the request, "
            "or do it on screen.")
TRUNCATED = "The answer ran too long - ask for a smaller piece."


class ProviderError(Exception):
	"""A provider failure, worded for the person at the desk. Never carries
	the raw response body."""


class Call(NamedTuple):
	id: str
	name: str
	args: dict


class Reply(NamedTuple):
	text: str
	calls: list


def api_kind(base_url: str | None) -> str:
	"""Which wire format a base URL speaks: claude, responses or chat."""
	host = (urlsplit((base_url or "").strip()).hostname or "").lower()
	if host == "api.anthropic.com":
		return "claude"
	if host == OPENAI_HOST:
		return "responses"
	return "chat"


def open_chat(base_url: str, model: str, key: str, system: str,
              history: list, tools: list | None = None,
              effort: str = "medium") -> Chat:
	"""A conversation with the provider behind base_url.

	tools: [(name, description, JSON-schema properties)], fixed for the
	conversation. effort: how hard a reasoning model thinks - "medium" for
	the agent, "low" for quick how-to answers.
	"""
	cls = {"claude": Claude, "responses": Responses}.get(
		api_kind(base_url), ChatCompletions)
	return cls(base_url, model, key, system, history, tools or [], effort)


def _args(raw) -> dict:
	if isinstance(raw, dict):
		return raw
	try:
		args = json.loads(raw or "{}")
	except ValueError:
		return {}
	return args if isinstance(args, dict) else {}


def _schema(params: dict) -> dict:
	return {"type": "object", "properties": params, "required": []}


def _error_text(status: int | None, body) -> str:
	"""The provider's own error message, never the raw body."""
	body = body[0] if isinstance(body, list) and body else body
	err = body.get("error") if isinstance(body, dict) else None
	msg = err.get("message") if isinstance(err, dict) else err
	text = f"AI provider error ({status})" if status else "AI provider error"
	return f"{text}: {msg[:200]}" if isinstance(msg, str) and msg else text


def provider_error(resp) -> str:
	try:
		body = resp.json()
	except Exception:
		body = None
	return _error_text(resp.status_code, body)


def _sse_data(resp):
	"""The JSON payloads of a server-sent event stream."""
	for raw in resp.iter_lines():
		if not raw:
			continue
		line = raw.decode("utf-8")
		if not line.startswith("data: "):
			continue
		chunk = line[6:]
		if chunk == "[DONE]":
			return
		try:
			yield json.loads(chunk)
		except ValueError:
			continue


class Chat:
	def __init__(self, base_url, model, key, system, history, tools, effort):
		self.base = (base_url or "").rstrip("/")
		self.model = model
		self.key = key
		self.system = system
		self.history = [{"role": m["role"], "content": m["content"]} for m in history]
		self.tools = tools
		self.effort = effort

	def send(self) -> Reply:
		"""One model turn with the tools on offer. The output joins the
		conversation; tool calls come back for the caller to answer."""
		raise NotImplementedError

	def add_results(self, results: list):
		"""[(call id, result text, is_error)] for the calls of the last send."""
		raise NotImplementedError

	def stream(self):
		"""The answer as text pieces, with no tool calls allowed."""
		raise NotImplementedError

	def _post(self, url, headers, body, *, stream=False):
		# Redirects aren't followed: the host list is checked on the URL
		# posted to, not on wherever it points.
		try:
			return requests.post(url, headers=headers, json=body, timeout=TIMEOUT,
			                     stream=stream, allow_redirects=False)
		except requests.RequestException:
			raise ProviderError(f"Could not reach {self.base}.")


class ChatCompletions(Chat):
	"""POST {base}/chat/completions on an OpenAI-compatible host."""

	def __init__(self, *args):
		super().__init__(*args)
		self.convo = ([{"role": "system", "content": self.system}] if self.system else []
		              ) + self.history
		self.defs = [{"type": "function",
		              "function": {"name": n, "description": d, "parameters": _schema(p)}}
		             for n, d, p in self.tools]

	def _chat(self, body, *, stream=False):
		"""GPT-5.6 luna/terra/sol refuse function tools on Chat Completions
		unless reasoning_effort is none (#23): retry once with the payload
		the error asks for. Hosts that accept the first body are unchanged."""
		url = f"{self.base}/chat/completions"
		headers = {"Authorization": f"Bearer {self.key}",
		           "Content-Type": "application/json"}
		resp = self._post(url, headers, body, stream=stream)
		if resp.status_code == 400:
			retry = retry_chat_payload(body, resp.text or "")
			if retry:
				resp = self._post(url, headers, retry, stream=stream)
		if resp.status_code != 200:
			raise ProviderError(provider_error(resp))
		return resp

	def send(self) -> Reply:
		resp = self._chat(chat_payload(self.model, self.convo,
		                               tools=self.defs or None, temperature=0.2))
		try:
			msg = resp.json()["choices"][0]["message"]
		except (KeyError, IndexError, ValueError, TypeError):
			raise ProviderError("The AI provider sent an answer Kamra can't read.")
		# appended whole: Gemini 3 keeps its thought signatures on tool_calls
		self.convo.append(msg)
		calls = [Call(c.get("id"), (c.get("function") or {}).get("name"),
		              _args((c.get("function") or {}).get("arguments")))
		         for c in msg.get("tool_calls") or []]
		return Reply(msg.get("content") or "", calls)

	def add_results(self, results):
		for call_id, content, _is_error in results:
			self.convo.append({"role": "tool", "tool_call_id": call_id,
			                   "content": content})

	def stream(self):
		resp = self._chat(chat_payload(self.model, self.convo, stream=True,
		                               temperature=0.2), stream=True)
		for event in _sse_data(resp):
			try:
				delta = event["choices"][0].get("delta", {})
			except (KeyError, IndexError, TypeError, AttributeError):
				continue
			if delta.get("content"):
				yield delta["content"]


class Responses(Chat):
	"""POST https://api.openai.com/v1/responses, stateless: store is off,
	so every request replays the whole turn, reasoning items included."""

	def __init__(self, *args):
		super().__init__(*args)
		self.items = list(self.history)
		self.defs = [{"type": "function", "name": n, "description": d,
		              "parameters": _schema(p)} for n, d, p in self.tools]
		self.reasoning = is_reasoning_model(self.model)

	def _body(self, **extra) -> dict:
		body = {"model": self.model, "input": self.items, "store": False, **extra}
		if self.system:
			body["instructions"] = self.system
		if self.defs:
			body["tools"] = self.defs
		if self.reasoning:
			body["reasoning"] = {"effort": self.effort}
			body["include"] = ["reasoning.encrypted_content"]
		return body

	def _respond(self, body, *, stream=False):
		url = f"{self.base}/responses"
		headers = {"Authorization": f"Bearer {self.key}",
		           "Content-Type": "application/json"}
		resp = self._post(url, headers, body, stream=stream)
		if resp.status_code == 400 and "reasoning" in body and "reasoning" in (resp.text or "").lower():
			# a model that doesn't reason (gpt-4.1, gpt-4o-mini) or doesn't
			# take this effort: ask again on its defaults
			self.reasoning = False
			body = {k: v for k, v in body.items() if k not in ("reasoning", "include")}
			resp = self._post(url, headers, body, stream=stream)
		if resp.status_code != 200:
			raise ProviderError(provider_error(resp))
		return resp

	def send(self) -> Reply:
		resp = self._respond(self._body())
		try:
			data = resp.json()
			output = data["output"]
		except (KeyError, ValueError, TypeError):
			raise ProviderError("The AI provider sent an answer Kamra can't read.")
		self.items.extend(output)
		text, calls, refused = [], [], False
		for item in output:
			if item.get("type") == "function_call":
				calls.append(Call(item.get("call_id"), item.get("name"),
				                  _args(item.get("arguments"))))
			elif item.get("type") == "message":
				for part in item.get("content") or []:
					if part.get("type") == "output_text":
						text.append(part.get("text") or "")
					elif part.get("type") == "refusal":
						refused = True
		if data.get("status") == "incomplete":
			# cut off mid-answer: a half-written tool call must not run
			return Reply("".join(text) or TRUNCATED, [])
		if refused and not text and not calls:
			return Reply(DECLINED, [])
		return Reply("".join(text), calls)

	def add_results(self, results):
		for call_id, content, _is_error in results:
			self.items.append({"type": "function_call_output", "call_id": call_id,
			                   "output": content})

	def stream(self):
		extra = {"stream": True}
		if self.defs:
			extra["tool_choice"] = "none"
		resp = self._respond(self._body(**extra), stream=True)
		for event in _sse_data(resp):
			kind = event.get("type")
			if kind == "response.output_text.delta" and event.get("delta"):
				yield event["delta"]
			elif kind in ("error", "response.failed"):
				err = event.get("error") or (event.get("response") or {}).get("error")
				raise ProviderError(_error_text(None, {"error": err}))


class Claude(Chat):
	"""Anthropic's Messages API. Each assistant turn goes back exactly as
	it came, thinking blocks included: Claude checks that the conversation
	its reasoning came from is unchanged."""

	def __init__(self, *args):
		super().__init__(*args)
		import anthropic

		self.anthropic = anthropic
		self.client = anthropic.Anthropic(
			api_key=self.key, base_url=ANTHROPIC_BASE_URL,
			timeout=TIMEOUT, max_retries=1)
		history = [m for m in self.history if m["content"]]
		# Claude takes no assistant turn before the first question, and an
		# assistant turn at the end would be read as the start of its answer.
		while history and history[0]["role"] != "user":
			history.pop(0)
		while history and history[-1]["role"] != "user":
			history.pop()
		self.messages = history
		self.defs = [{"name": n, "description": d, "input_schema": _schema(p)}
		             for n, d, p in self.tools]
		self.options = {"output_config": {"effort": self.effort}}
		# Haiku has no fallback model to hand a declined request to
		if "haiku" not in (self.model or ""):
			self.options["fallbacks"] = "default"

	def _params(self, **extra) -> dict:
		params = {"model": self.model, "max_tokens": MAX_TOKENS,
		          "messages": self.messages, "betas": list(CLAUDE_BETAS),
		          # caches the system prompt and tool list between tool rounds
		          "cache_control": {"type": "ephemeral"},
		          **self.options, **extra}
		if self.system:
			params["system"] = self.system
		if self.defs:
			params["tools"] = self.defs
		return params

	def _call(self, fn):
		"""Run a request, dropping an option an older model rejects
		(effort on Haiku 4.5, say) and asking once more."""
		a = self.anthropic
		for _ in range(len(self.options) + 1):
			try:
				return fn()
			except a.BadRequestError as e:
				text = _error_text(e.status_code, e.body)
				dropped = [k for k in self.options
				           if any(w in text.lower() for w in CLAUDE_OPTION_WORDS[k])]
				if not dropped:
					raise ProviderError(text)
				for k in dropped:
					self.options.pop(k)
			except a.APIStatusError as e:
				raise ProviderError(_error_text(e.status_code, e.body))
			except a.APIConnectionError:
				raise ProviderError("Could not reach Anthropic.")
		raise ProviderError("Anthropic refused the request.")

	def send(self) -> Reply:
		msg = self._call(lambda: self.client.beta.messages.create(**self._params()))
		if msg.stop_reason == "refusal":
			# not added to the conversation: the turn ends here
			return Reply(DECLINED, [])
		self.messages.append({"role": "assistant", "content": msg.content})
		text = "".join(b.text for b in msg.content if b.type == "text")
		if msg.stop_reason == "max_tokens":
			# cut off mid-answer: a half-written tool call must not run
			return Reply(text or TRUNCATED, [])
		calls = [Call(b.id, b.name, _args(b.input))
		         for b in msg.content if b.type == "tool_use"]
		return Reply(text, calls)

	def add_results(self, results):
		self.messages.append({"role": "user", "content": [
			{"type": "tool_result", "tool_use_id": call_id, "content": content,
			 "is_error": bool(is_error)}
			for call_id, content, is_error in results]})

	def stream(self):
		# The tool list stays on the request (a conversation with tool calls
		# in it needs one); tool_choice none keeps the answer to text.
		extra = {"tool_choice": {"type": "none"}} if self.defs else {}
		events = self._call(lambda: self.client.beta.messages.create(
			**self._params(stream=True, **extra)))
		a = self.anthropic
		try:
			for event in events:
				if event.type == "content_block_delta" and event.delta.type == "text_delta":
					yield event.delta.text
				elif event.type == "message_delta" and event.delta.stop_reason == "refusal":
					yield "\n\n" + DECLINED
		except a.APIStatusError as e:
			raise ProviderError(_error_text(e.status_code, e.body))
		except a.APIConnectionError:
			raise ProviderError("Could not reach Anthropic.")
