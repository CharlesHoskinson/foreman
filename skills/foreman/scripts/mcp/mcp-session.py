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
import json
import os
import select
import shlex
import signal
import subprocess
import sys
import time

PROTOCOL_VERSION = "2025-06-18"


def eprint(*args):
    print("[mcp-session]", *args, file=sys.stderr, flush=True)


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
            text=True, bufsize=1, start_new_session=True,
        )
    except OSError as exc:
        eprint(f"cannot spawn server: {exc}")
        return 1

    def send(msg):
        proc.stdin.write(json.dumps(msg) + "\n")
        proc.stdin.flush()

    deadline = time.monotonic() + opts.timeout_sec
    result, rc = {}, 1
    events = open(opts.events_out, "a", buffering=1)
    try:
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": PROTOCOL_VERSION, "capabilities": {},
            "clientInfo": {"name": "foreman-mcp-session", "version": "1.0"}}})
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                eprint(f"timeout after {opts.timeout_sec}s")
                break
            ready, _, _ = select.select([proc.stdout], [], [], min(remaining, 5))
            if not ready:
                if proc.poll() is not None:
                    eprint(f"server exited early (code {proc.returncode})")
                    break
                continue
            line = proc.stdout.readline()
            if not line:
                eprint("server closed stdout")
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                events.write(json.dumps({"raw": line}) + "\n")
                continue
            if "method" in msg and "id" in msg:
                # Server->client request: refuse — foreman is non-interactive.
                events.write(line + "\n")
                send({"jsonrpc": "2.0", "id": msg["id"], "error": {
                    "code": -32601,
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
    except BrokenPipeError:
        eprint("server pipe broke")
    finally:
        events.close()
        with open(opts.result_out, "w") as fh:
            json.dump(result, fh)
        if proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    return rc


if __name__ == "__main__":
    sys.exit(main())
