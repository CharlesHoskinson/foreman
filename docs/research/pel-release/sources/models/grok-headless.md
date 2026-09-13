---
source_url: "https://docs.x.ai/build/cli/headless-scripting"
captured_at: "2026-09-13T03:03:04.841975+00:00"
contributor: "Foreman release research; Scrapling"
---

#### [CLI](#cli)

# [Headless & Scripting](#headless--scripting)

Copy for LLM[View as Markdown](/build/cli/headless-scripting.md)

[Create API key](https://console.x.ai/team/default/api-keys?utm_source=docs&utm_medium=referral&utm_campaign=build-cli-headless-scripting&utm_content=article-api-key)[Meet grok-4.6](https://x.ai/news/grok-4-6)

## [Headless mode](#headless-mode)

Use headless mode for scripts, bots, or other machine-friendly tasks.

Bash

```
grok -p "Your prompt here"
```

Common flags:

| Flag | What it does |
| --- | --- |
| `-p, --single <PROMPT>` | Send one prompt |
| `-m, --model <MODEL>` | Choose a model |
| `-s, --session-id <ID>` | Create or resume a named headless session |
| `-r, --resume <ID>` | Resume an existing session |
| `-c, --continue` | Continue the most recent session in the current directory |
| `--cwd <PATH>` | Set the working directory |
| `--output-format <FMT>` | Choose `plain`, `json`, or `streaming-json` |
| `--always-approve` | Auto-approve tool executions |
| `--no-alt-screen` | Run inline (no alternate screen / fullscreen TUI takeover) |

**Sessions:** Headless sessions (via `--session-id`, `--resume`, `--continue`) are stored in `~/.grok/sessions`.

**Suppressing updates in xai-grok-shell:** When using headless mode (`-p`) or ACP (`grok agent stdio`) in scripts, CI, or other automated environments, pass `--no-auto-update` (e.g. `grok --no-auto-update -p "..."`) to skip background update checks. You can also persistently disable them by setting `auto_update = false` under the `[cli]` section in `~/.grok/config.toml`.

## [Output formats](#output-formats)

* `plain`: human-readable text
* `json`: one JSON object at the end
* `streaming-json`: newline-delimited JSON events

Bash

```
grok -p "List TODO comments" --output-format json
grok -p "Explain the architecture" --output-format streaming-json
```

Streaming JSON emits incremental events as they arrive.

## [ACP](#acp)

Use ACP when you want IDE or tool integration rather than a terminal session.

Bash

```
grok agent stdio
```

This runs Grok as an ACP agent over JSON-RPC on stdin/stdout. The example below assumes `grok` is already authenticated locally, or `XAI_API_KEY` is set. `session/prompt` returns completion metadata; the assistant text itself arrives as `session/update` chunks.

JavaScript

```
import { spawn } from "node:child_process";
import readline from "node:readline";
import process from "node:process";

const proc = spawn("grok", ["agent", "stdio"], { stdio: ["pipe", "pipe", "pipe"] });
const rl = readline.createInterface({ input: proc.stdout });
const pending = new Map();
let nextId = 1;
let text = "";

proc.stderr.on("data", chunk => process.stderr.write(chunk));

rl.on("line", line => {
  const message = JSON.parse(line);

  if (message.method === "session/update") {
    const update = message.params?.update;
    if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
      text += update.content.text;
    }
    return;
  }

  const pendingRequest = pending.get(message.id);
  if (!pendingRequest) return;

  pending.delete(message.id);
  if (message.error) {
    pendingRequest.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
  } else {
    pendingRequest.resolve(message.result ?? {});
  }
});

function request(method, params, timeoutMs = 30000) {
  const id = nextId++;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);

    pending.set(id, {
      resolve(result) {
        clearTimeout(timer);
        resolve(result);
      },
      reject(error) {
        clearTimeout(timer);
        reject(error);
      },
    });

    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
  const init = await request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: true, writeTextFile: true },
      terminal: true,
    },
  });

  const authMethods = new Set((init.authMethods ?? []).map(method => method.id));
  const methodId =
    process.env.XAI_API_KEY && authMethods.has("xai.api_key")
      ? "xai.api_key"
      : authMethods.has("cached_token")
        ? "cached_token"
        : null;

  if (!methodId) {
    throw new Error("Run `grok login` first, or set XAI_API_KEY.");
  }

  await request("authenticate", { methodId, _meta: { headless: true } });

  const { sessionId } = await request("session/new", {
    cwd: process.cwd(),
    mcpServers: [],
  });

  const prompt = await request("session/prompt", {
    sessionId,
    prompt: [{ type: "text", text: "Say hello in one short sentence." }],
  });

  let lastLength = -1;
  let stableChecks = 0;
  while (stableChecks < 2) {
    await sleep(150);
    if (text.length === lastLength) {
      stableChecks += 1;
    } else {
      lastLength = text.length;
      stableChecks = 0;
    }
  }

  console.log(text.trim() || `No text returned (stopReason=${prompt.stopReason})`);
} finally {
  rl.close();
  proc.kill();
}
```

---

Last updated: June 10, 2026
