# Copyright (c) 2026, HeyKoala and contributors
# For license information, please see license.txt

"""The three wire formats in kamra.llm_api, against recorded-shape replies."""

import copy
import json
from unittest import mock

import anthropic
import httpx2

from kamra import llm_api
from kamra.llm_api import Call, ProviderError, api_kind, open_chat

TOOLS = [("find_reservations", "Find stays", {"query": {"type": "string"}})]
HISTORY = [{"role": "user", "content": "Who is in room 101?"}]


class FakeResponse:
	def __init__(self, status, body=None, lines=()):
		self.status_code = status
		self._body = body
		self.text = json.dumps(body) if body is not None else ""
		self._lines = lines

	def json(self):
		if self._body is None:
			raise ValueError
		return self._body

	def iter_lines(self):
		yield from self._lines


def post_replies(*replies):
	"""requests.post replaced: hands out replies in order, keeps the bodies."""
	sent = []

	def post(url, headers=None, json=None, **kw):
		assert kw["allow_redirects"] is False
		# what goes on the wire is the body as it is now
		sent.append({"url": url, "body": copy.deepcopy(json), "headers": headers})
		return replies[len(sent) - 1]

	return sent, mock.patch.object(llm_api.requests, "post", side_effect=post)


def test_api_kind():
	assert api_kind("https://api.anthropic.com") == "claude"
	assert api_kind("https://api.openai.com/v1") == "responses"
	assert api_kind("https://generativelanguage.googleapis.com/v1beta/openai") == "chat"
	assert api_kind("https://acme.openai.azure.com/openai/v1") == "chat"
	assert api_kind("https://openrouter.ai/api/v1") == "chat"
	assert api_kind("") == "chat"


# ── OpenAI Responses ──────────────────────────────────────────────────────

REASONING = {"type": "reasoning", "id": "rs_1", "summary": [],
             "encrypted_content": "gAAAA-opaque"}
FUNCTION_CALL = {"type": "function_call", "id": "fc_1", "call_id": "call_1",
                 "name": "find_reservations", "arguments": '{"query": "101"}'}
ANSWER = {"type": "message", "id": "msg_1", "role": "assistant",
          "content": [{"type": "output_text", "text": "Ana Putri is in 101."}]}


def test_responses_tool_round_replays_reasoning():
	sent, patch = post_replies(
		FakeResponse(200, {"status": "completed", "output": [REASONING, FUNCTION_CALL]}),
		FakeResponse(200, {"status": "completed", "output": [ANSWER]}))
	with patch:
		chat = open_chat("https://api.openai.com/v1", "gpt-6.1-sol", "sk-x",
		                 "You are the agent.", HISTORY, tools=TOOLS)
		reply = chat.send()
		assert reply.calls == [Call("call_1", "find_reservations", {"query": "101"})]
		chat.add_results([("call_1", '{"rows": []}', False)])
		assert chat.send().text == "Ana Putri is in 101."

	first, second = sent[0]["body"], sent[1]["body"]
	assert sent[0]["url"] == "https://api.openai.com/v1/responses"
	assert first["store"] is False
	assert first["instructions"] == "You are the agent."
	assert first["reasoning"] == {"effort": "medium"}
	assert "temperature" not in first
	assert first["tools"] == [{"type": "function", "name": "find_reservations",
	                           "description": "Find stays",
	                           "parameters": {"type": "object",
	                                          "properties": {"query": {"type": "string"}},
	                                          "required": []}}]
	# the reasoning item goes back untouched with the call and its output
	assert second["input"] == [
		{"role": "user", "content": "Who is in room 101?"}, REASONING, FUNCTION_CALL,
		{"type": "function_call_output", "call_id": "call_1", "output": '{"rows": []}'}]


def test_responses_classic_model_sends_no_reasoning():
	sent, patch = post_replies(FakeResponse(200, {"status": "completed", "output": [ANSWER]}))
	with patch:
		open_chat("https://api.openai.com/v1", "gpt-4o-mini", "sk-x", "", HISTORY).send()
	assert "reasoning" not in sent[0]["body"]
	assert "instructions" not in sent[0]["body"]


def test_responses_retries_without_reasoning_when_refused():
	sent, patch = post_replies(
		FakeResponse(400, {"error": {"message": "Unsupported parameter: 'reasoning.effort'"}}),
		FakeResponse(200, {"status": "completed", "output": [ANSWER]}))
	with patch:
		text = open_chat("https://api.openai.com/v1", "gpt-6-custom", "sk-x", "",
		                 HISTORY).send().text
	assert text == "Ana Putri is in 101."
	assert "reasoning" not in sent[1]["body"]


def test_responses_incomplete_runs_no_tools():
	_sent, patch = post_replies(
		FakeResponse(200, {"status": "incomplete", "output": [REASONING, FUNCTION_CALL]}))
	with patch:
		reply = open_chat("https://api.openai.com/v1", "gpt-6.1-sol", "sk-x", "",
		                  HISTORY, tools=TOOLS).send()
	assert reply.calls == []
	assert reply.text == llm_api.TRUNCATED


def test_responses_error_is_the_message_not_the_body():
	_sent, patch = post_replies(
		FakeResponse(401, {"error": {"message": "Incorrect API key provided"},
		                   "echo": "secret request body"}))
	with patch:
		try:
			open_chat("https://api.openai.com/v1", "gpt-6.1-sol", "sk-x", "", HISTORY).send()
		except ProviderError as e:
			assert str(e) == "AI provider error (401): Incorrect API key provided"
		else:
			raise AssertionError("expected ProviderError")


def test_responses_final_stream_keeps_tools_but_allows_none():
	lines = [b'data: {"type": "response.output_text.delta", "delta": "Ana "}',
	         b'data: {"type": "response.output_text.delta", "delta": "Putri"}',
	         b'data: {"type": "response.completed"}']
	sent, patch = post_replies(FakeResponse(200, lines=lines))
	with patch:
		chat = open_chat("https://api.openai.com/v1", "gpt-6.1-sol", "sk-x", "",
		                 HISTORY, tools=TOOLS)
		assert "".join(chat.stream()) == "Ana Putri"
	assert sent[0]["body"]["stream"] is True
	assert sent[0]["body"]["tool_choice"] == "none"


# ── Chat Completions ──────────────────────────────────────────────────────

def test_chat_completions_tool_round():
	call_msg = {"role": "assistant", "content": None, "tool_calls": [
		{"id": "c1", "type": "function",
		 "function": {"name": "find_reservations", "arguments": '{"query": "101"}'},
		 "extra_content": {"google": {"thought_signature": "sig"}}}]}
	sent, patch = post_replies(
		FakeResponse(200, {"choices": [{"message": call_msg}]}),
		FakeResponse(200, {"choices": [{"message": {"role": "assistant",
		                                            "content": "In 101: Ana."}}]}))
	with patch:
		chat = open_chat("https://generativelanguage.googleapis.com/v1beta/openai",
		                 "gemini-3.8-flash", "k", "sys", HISTORY, tools=TOOLS)
		assert chat.send().calls == [Call("c1", "find_reservations", {"query": "101"})]
		chat.add_results([("c1", "{}", False)])
		assert chat.send().text == "In 101: Ana."
	assert sent[0]["url"].endswith("/chat/completions")
	msgs = sent[1]["body"]["messages"]
	assert msgs[0] == {"role": "system", "content": "sys"}
	# Gemini's thought signature travels back on the call it came with
	assert msgs[2] == call_msg
	assert msgs[3] == {"role": "tool", "tool_call_id": "c1", "content": "{}"}


# ── Claude ────────────────────────────────────────────────────────────────

THINKING = {"type": "thinking", "thinking": "", "signature": "EqQBCkYI-opaque"}
TOOL_USE = {"type": "tool_use", "id": "toolu_1", "name": "find_reservations",
            "input": {"query": "101"}}


def message(content, stop_reason="end_turn"):
	return {"id": "msg_1", "type": "message", "role": "assistant",
	        "model": "claude-opus-5-5", "content": content,
	        "stop_reason": stop_reason, "stop_sequence": None,
	        "usage": {"input_tokens": 10, "output_tokens": 5}}


def claude(replies, **kw):
	"""A Claude chat whose HTTP goes to `replies` (status, body) in order."""
	sent = []

	def handler(request):
		sent.append({"body": json.loads(request.content),
		             "beta": request.headers.get("anthropic-beta")})
		status, body = replies[len(sent) - 1]
		if isinstance(body, str):
			return httpx2.Response(status, text=body,
			                       headers={"content-type": "text/event-stream"})
		return httpx2.Response(status, json=body)

	chat = open_chat("https://api.anthropic.com", kw.get("model", "claude-opus-5-5"),
	                 "sk-ant-x", "You are the agent.", kw.get("history", HISTORY),
	                 tools=kw.get("tools", TOOLS), effort=kw.get("effort", "medium"))
	chat.client = anthropic.Anthropic(
		api_key="sk-ant-x", max_retries=0,
		http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler)))
	return chat, sent


def test_claude_tool_round_replays_thinking_verbatim():
	chat, sent = claude([
		(200, message([THINKING, TOOL_USE], "tool_use")),
		(200, message([{"type": "text", "text": "Ana Putri is in 101."}])),
	])
	reply = chat.send()
	assert reply.calls == [Call("toolu_1", "find_reservations", {"query": "101"})]
	chat.add_results([("toolu_1", '{"rows": []}', False)])
	assert chat.send().text == "Ana Putri is in 101."

	first, second = sent[0]["body"], sent[1]["body"]
	assert first["model"] == "claude-opus-5-5"
	assert first["system"] == "You are the agent."
	assert first["fallbacks"] == "default"
	assert "server-side-fallback-2026-07-01" in sent[0]["beta"]
	assert first["output_config"] == {"effort": "medium"}
	assert first["cache_control"] == {"type": "ephemeral"}
	assert "temperature" not in first and "thinking" not in first
	assert first["tools"][0]["input_schema"]["properties"] == {"query": {"type": "string"}}
	# the assistant turn goes back exactly as it came, signature and all
	assert second["messages"][1] == {"role": "assistant", "content": [THINKING, TOOL_USE]}
	assert second["messages"][2] == {"role": "user", "content": [
		{"type": "tool_result", "tool_use_id": "toolu_1", "content": '{"rows": []}',
		 "is_error": False}]}
	# the system prompt and the tool list don't change within the question
	assert second["system"] == first["system"] and second["tools"] == first["tools"]


def test_claude_history_starts_and_ends_with_the_person():
	chat, sent = claude([(200, message([{"type": "text", "text": "ok"}]))], history=[
		{"role": "assistant", "content": "Hi! How can I help?"},
		{"role": "user", "content": "Who is in 101?"},
		{"role": "assistant", "content": ""},
	])
	chat.send()
	assert sent[0]["body"]["messages"] == [{"role": "user", "content": "Who is in 101?"}]


def test_claude_drops_effort_an_older_model_rejects():
	chat, sent = claude([
		(400, {"type": "error", "error": {"type": "invalid_request_error",
		                                  "message": "This model does not support the effort parameter."}}),
		(200, message([{"type": "text", "text": "ok"}])),
	], model="claude-haiku-4-5")
	assert chat.send().text == "ok"
	assert "output_config" in sent[0]["body"]
	assert "output_config" not in sent[1]["body"]
	# Haiku gets no fallback
	assert "fallbacks" not in sent[0]["body"]


def test_claude_other_400_is_reported():
	chat, _sent = claude([(400, {"type": "error", "error": {
		"type": "invalid_request_error", "message": "model: claude-nope not found"}})])
	try:
		chat.send()
	except ProviderError as e:
		assert str(e) == "AI provider error (400): model: claude-nope not found"
	else:
		raise AssertionError("expected ProviderError")


def test_claude_refusal_ends_the_turn():
	chat, _sent = claude([(200, message([], "refusal"))])
	reply = chat.send()
	assert reply == (llm_api.DECLINED, [])


def test_claude_truncated_tool_call_does_not_run():
	chat, _sent = claude([(200, message([THINKING, TOOL_USE], "max_tokens"))])
	assert chat.send().calls == []


def test_claude_stream_text_only():
	events = [
		("message_start", {"type": "message_start", "message": message([], None)}),
		("content_block_start", {"type": "content_block_start", "index": 0,
		                         "content_block": {"type": "text", "text": ""}}),
		("content_block_delta", {"type": "content_block_delta", "index": 0,
		                         "delta": {"type": "text_delta", "text": "Open "}}),
		("content_block_delta", {"type": "content_block_delta", "index": 0,
		                         "delta": {"type": "text_delta", "text": "Settings."}}),
		("content_block_stop", {"type": "content_block_stop", "index": 0}),
		("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn"},
		                   "usage": {"output_tokens": 4}}),
		("message_stop", {"type": "message_stop"}),
	]
	sse = "".join(f"event: {e}\ndata: {json.dumps(d)}\n\n" for e, d in events)
	chat, sent = claude([(200, sse)], tools=[], effort="low")
	assert "".join(chat.stream()) == "Open Settings."
	body = sent[0]["body"]
	assert body["stream"] is True
	assert body["output_config"] == {"effort": "low"}
	assert "tools" not in body and "tool_choice" not in body
