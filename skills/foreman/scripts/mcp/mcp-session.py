#!/usr/bin/env python3
"""Deterministic MCP stdio client for the foreman session transport.

Spawns an MCP server (e.g. `codex mcp-server`), performs the initialize
handshake, calls exactly one tool, streams every server notification to an
events file (JSONL), writes the tool result to a result file, then kills the
server. Non-interactive by design: any server->client request (approval
elicitation etc.) is refused with a JSON-RPC error.

Exit codes (foreman contract): 0 ok, 1 session/tool failure, 2 usage error.
Python 3.11+ stdlib only.
"""
import argparse
import errno
import json
import os
import select
import shlex
import signal
import subprocess
import sys
import time

PROTOCOL_VERSION = "2025-06-18"

READ_CHUNK = 65536


def eprint(*args):
    print("[mcp-session]", *args, file=sys.stderr, flush=True)


class _Timeout(Exception):
    """Deadline elapsed before a full line was available."""


class _ServerDone(Exception):
    """Server closed stdout (EOF) or exited before yielding a full line."""


class LineReader:
    """Non-blocking line reader over a raw pipe fd.

    select() only tells us bytes are available, not that a full line is
    available — a server that writes a partial line and then goes silent
    must not be able to hang us in a blocking readline(). We do our own
    buffering: os.read() the fd non-blockingly, accumulate raw bytes, and
    only yield complete '\n'-terminated lines, decoding leniently.
    """

    def __init__(self, fd):
        self._fd = fd
        os.set_blocking(fd, False)
        self._buf = bytearray()

    def readline(self, deadline, proc):
        """Return the next decoded line, blocking (with the given deadline)
        until one is available.

        Raises _Timeout if the deadline elapses first, or _ServerDone if the
        server exits / closes stdout before a full line arrives.
        """
        while True:
            nl = self._buf.find(b"\n")
            if nl != -1:
                raw = bytes(self._buf[:nl])
                del self._buf[: nl + 1]
                return raw.decode("utf-8", errors="replace").strip()

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise _Timeout()
            ready, _, _ = select.select([self._fd], [], [], min(remaining, 5))
            if not ready:
                if proc.poll() is not None:
                    raise _ServerDone(f"server exited early (code {proc.returncode})")
                continue
            try:
                chunk = os.read(self._fd, READ_CHUNK)
            except OSError as exc:
                if exc.errno == errno.EAGAIN:
                    continue
                raise _ServerDone(f"read error: {exc}")
            if not chunk:
                raise _ServerDone("server closed stdout")
            self._buf.extend(chunk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--server-cmd", required=True)
    ap.add_argument("--tool", required=True)
    ap.add_argument("--args-json", required=True)
    ap.add_argument("--events-out", required=True)
    ap.add_argument("--result-out", required=True)
    ap.add_argument("--timeout-sec", type=int, default=1800)
    opts = ap.parse_args()

    try:
        tool_args = json.loads(opts.args_json)
    except json.JSONDecodeError as exc:
        eprint(f"invalid --args-json: {exc}")
        return 2

    try:
        proc = subprocess.Popen(
            shlex.split(opts.server_cmd),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=sys.stderr,
            bufsize=0, start_new_session=True,
        )
    except OSError as exc:
        eprint(f"cannot spawn server: {exc}")
        return 1

    def send(msg):
        proc.stdin.write((json.dumps(msg) + "\n").encode("utf-8"))
        proc.stdin.flush()

    reader = LineReader(proc.stdout.fileno())
    deadline = time.monotonic() + opts.timeout_sec
    result, rc = {}, 1
    events = open(opts.events_out, "a", buffering=1)
    try:
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "foreman-mcp-session", "version": "1.0"}}})
        while True:
            try:
                line = reader.readline(deadline, proc)
            except _Timeout:
                eprint(f"timeout after {opts.timeout_sec}s")
                break
            except _ServerDone as exc:
                eprint(str(exc))
                break
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                events.write(json.dumps({"raw": line}) + "\n")
                continue
            if not isinstance(msg, dict):
                # Valid JSON, but not a JSON-RPC object (null, number, array, ...).
                events.write(json.dumps({"raw": line}) + "\n")
                continue
            if "method" in msg and "id" in msg:
                # Server->client request: refuse — foreman is non-interactive.
                events.write(line + "\n")
                send({"jsonrpc": "2.0", "id": msg["id"], "error": {
                    "code": -32000,
                    "message": "foreman session is non-interactive; request denied"}})
            elif "method" in msg:
                events.write(line + "\n")  # notification: the live stream
            elif msg.get("id") == 1:
                if "error" in msg:
                    eprint(f"initialize failed: {msg['error']}")
                    break
                send({"jsonrpc": "2.0", "method": "notifications/initialized"})
                send({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                      "params": {"name": opts.tool, "arguments": tool_args}})
            elif msg.get("id") == 2:
                if "error" in msg:
                    eprint(f"tool call failed: {msg['error']}")
                else:
                    result = msg.get("result", {})
                    rc = 1 if result.get("isError") else 0
                break
            else:
                # Response to an id we didn't originate — keep it in the
                # audit trail rather than silently dropping it.
                events.write(line + "\n")
    except BrokenPipeError:
        eprint("server pipe broke")
    finally:
        events.close()
        with open(opts.result_out, "w") as fh:
            json.dump(result, fh)
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    return rc


if __name__ == "__main__":
    sys.exit(main())
