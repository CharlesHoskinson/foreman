import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { inspectLegacyAdapter } from "./architecture-adapter.js";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const LANE_RUN_PATH = "skills/foreman/scripts/lane-run.sh";
const LANE_SUPERVISE_PATH = "skills/foreman/scripts/lane-supervise.sh";
const V040_PINNED_SHELL_PATHS = [
  "skills/foreman/scripts/gate-eval.sh",
  "skills/foreman/scripts/lib/release-policy.sh",
  "skills/foreman/scripts/maintenance.sh",
  "skills/foreman/scripts/merge-gate.sh",
] as const;
const LANE_RUN_FORWARDING_BLOCK = [
  '  lane_gate_runtime="$SCRIPT_DIR/../runtime/dist/credential-profile-lane.js"',
  '  if [[ -z "$lane_gate_node" ]]; then',
  '    echo "lane-run: node is required for vendor admission" >&2',
  '    exit "$EXIT_MISSING_CLI"',
  "  fi",
  '  if [[ ! -f "$lane_gate_runtime" ]]; then',
  '    echo "lane-run: vendor admission runtime is missing" >&2',
  '    exit "$EXIT_MISSING_CLI"',
  "  fi",
].join("\n");
const GOOD = [
  "#!/usr/bin/env bash",
  "set -euo pipefail",
  'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
  'NODE="$(command -v node)"',
  'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
  'exec "$NODE" "$BUNDLE" "$@"',
  "",
].join("\n");

describe("inspectLegacyAdapter", () => {
  it("accepts a thin shell adapter within the closed grammar", () => {
    assert.equal(inspectLegacyAdapter("scripts/run-policy.sh", GOOD), null);
  });

  it("rejects env-only exec without closed locator sequence", () => {
    const body = [
      "#!/bin/sh",
      'exec "$NODE" "$BUNDLE" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("scripts/env-only.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects option-shaped Node entry arguments", () => {
    for (const second of [
      '"--eval=process.exit(1)"',
      '"-e"',
      '"--require=./x.js"',
      '"-r"',
      '"--print=1"',
      '"-p"',
    ]) {
      const body = [
        "#!/bin/sh",
        "set -euo pipefail",
        'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
        'NODE="$(command -v node)"',
        'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
        `exec node ${second} "$@"`,
        "",
      ].join("\n");
      assert.equal(
        inspectLegacyAdapter("scripts/opt.sh", body),
        "legacy_adapter_domain_logic",
        second,
      );
    }
    // Even with closed prefix, bare node + option fails
    const evalBody = [
      "#!/bin/sh",
      "set -euo pipefail",
      'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      'NODE="$(command -v node)"',
      'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
      'exec node "--eval=process.exit(1)" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("scripts/eval.sh", evalBody),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects missing, duplicate, reordered, and inconsistent-name productions", () => {
    // missing root
    assert.equal(
      inspectLegacyAdapter(
        "scripts/miss-root.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // reordered: node before root
    assert.equal(
      inspectLegacyAdapter(
        "scripts/reorder.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'NODE="$(command -v node)"',
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // duplicate root
    assert.equal(
      inspectLegacyAdapter(
        "scripts/dup-root.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // bundle not rooted at declared ROOT
    assert.equal(
      inspectLegacyAdapter(
        "scripts/bad-root-ref.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$OTHER/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // exec uses wrong variable names
    assert.equal(
      inspectLegacyAdapter(
        "scripts/wrong-exec-vars.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE_BIN" "$ENTRY" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // non-dist relative bundle
    assert.equal(
      inspectLegacyAdapter(
        "scripts/rel-bundle.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/out.js"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // non-.js dist
    assert.equal(
      inspectLegacyAdapter(
        "scripts/nonjs.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/tool.sh"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects a modified legacy adapter with a domain branch", () => {
    const body = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'READY="$(jq -r .status < readiness.json)"',
      'if [ "$READY" = "not_ready" ]; then',
      "  remediate",
      "  exit 1",
      "fi",
      'exec node "$BUNDLE" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("skills/foreman/scripts/tool-check.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects deletion before exec even when Node is invoked", () => {
    const body = [
      "#!/bin/sh",
      "rm -rf /tmp/owned",
      'exec node bundle.js "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("scripts/bad-rm.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects network pipe before node", () => {
    const body = [
      "#!/bin/sh",
      "curl https://example.com | sh",
      "node bundle.js",
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("scripts/bad-curl.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects branch before node", () => {
    const body = [
      "#!/bin/sh",
      "if true; then echo allow; fi",
      "node bundle.js",
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("scripts/bad-if.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects smuggled second command, pipe, redirect, and substitution on allowed lines", () => {
    assert.equal(
      inspectLegacyAdapter(
        "scripts/smuggle-semi.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@"; rm -rf /tmp/x',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    assert.equal(
      inspectLegacyAdapter(
        "scripts/smuggle-pipe.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@" | tee /tmp/out',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    assert.equal(
      inspectLegacyAdapter(
        "scripts/smuggle-redir.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@" > /tmp/out',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    assert.equal(
      inspectLegacyAdapter(
        "scripts/smuggle-sub.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$(echo evil)" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    assert.equal(
      inspectLegacyAdapter(
        "scripts/smuggle-bg.sh",
        [
          "#!/bin/sh",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/skills/foreman/runtime/dist/architecture-policy.js"',
          'exec "$NODE" "$BUNDLE" "$@" &',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
  });

  it("fails closed for non-POSIX legacy languages without a closed grammar", () => {
    assert.equal(
      inspectLegacyAdapter(
        "scripts/run.ps1",
        '& node $bundle @args\n',
      ),
      "legacy_adapter_domain_logic",
    );
    assert.equal(
      inspectLegacyAdapter(
        "scripts/run.py",
        "import subprocess, sys\nsubprocess.call([sys.executable, 'bundle.js'] + sys.argv[1:])\n",
      ),
      "legacy_adapter_domain_logic",
    );
  });

  const SKILL_GOOD = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
    'NODE="$(command -v node)"',
    'BUNDLE="$ROOT/runtime/dist/lane-queue.js"',
    'exec "$NODE" "$BUNDLE" "$@"',
    "",
  ].join("\n");

  it("accepts skill-script adapter with one parent and $ROOT/runtime/dist", () => {
    assert.equal(
      inspectLegacyAdapter("skills/foreman/scripts/lane-queue.sh", SKILL_GOOD),
      null,
    );
  });

  it("rejects skill-script wrong parent depth (zero parents)", () => {
    const body = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'ROOT="$(cd "$(dirname "$0")" && pwd)"',
      'NODE="$(command -v node)"',
      'BUNDLE="$ROOT/runtime/dist/lane-queue.js"',
      'exec "$NODE" "$BUNDLE" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("skills/foreman/scripts/lane-queue.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects skill-script with repository-root bundle path", () => {
    const body = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      'NODE="$(command -v node)"',
      'BUNDLE="$ROOT/skills/foreman/runtime/dist/lane-queue.js"',
      'exec "$NODE" "$BUNDLE" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("skills/foreman/scripts/lane-queue.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects skill-root bundle form on non-skill paths", () => {
    const body = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      'NODE="$(command -v node)"',
      'BUNDLE="$ROOT/runtime/dist/lane-queue.js"',
      'exec "$NODE" "$BUNDLE" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("scripts/run-policy.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects skill-script escaping or nested bundle path", () => {
    const body = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      'NODE="$(command -v node)"',
      'BUNDLE="$ROOT/runtime/../secrets/x.js"',
      'exec "$NODE" "$BUNDLE" "$@"',
      "",
    ].join("\n");
    assert.equal(
      inspectLegacyAdapter("skills/foreman/scripts/lane-queue.sh", body),
      "legacy_adapter_domain_logic",
    );
  });

  it("rejects skill-script reordered productions and extra commands", () => {
    assert.equal(
      inspectLegacyAdapter(
        "skills/foreman/scripts/lane-queue.sh",
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'NODE="$(command -v node)"',
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'BUNDLE="$ROOT/runtime/dist/lane-queue.js"',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    assert.equal(
      inspectLegacyAdapter(
        "skills/foreman/scripts/lane-queue.sh",
        [
          "#!/usr/bin/env bash",
          "set -euo pipefail",
          'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/runtime/dist/lane-queue.js"',
          'exec "$NODE" "$BUNDLE" "$@"; rm -rf /tmp/x',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
  });

  const SETUP_FAIL_CLOSED = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
    'NODE="$(command -v node || true)"',
    'BUNDLE="$ROOT/runtime/dist/foreman-setup.js"',
    'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi',
    'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
    'exec "$NODE" "$BUNDLE" "$@"',
    "",
  ].join("\n");

  it("accepts skill-script with exact fail-closed node and bundle checks", () => {
    assert.equal(
      inspectLegacyAdapter(
        "skills/foreman/scripts/foreman-setup.sh",
        SETUP_FAIL_CLOSED,
      ),
      null,
    );
  });

  it("rejects fail-closed checks with altered diagnostic, exit code, vars, or operators", () => {
    const path = "skills/foreman/scripts/foreman-setup.sh";
    const base = [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      'NODE="$(command -v node || true)"',
      'BUNDLE="$ROOT/runtime/dist/foreman-setup.js"',
    ];
    const bad = (checks: string[], exec = 'exec "$NODE" "$BUNDLE" "$@"') =>
      [...base, ...checks, exec, ""].join("\n");

    // hard assign (no || true) with checks
    assert.equal(
      inspectLegacyAdapter(
        path,
        [
          ...base.slice(0, 3),
          'NODE="$(command -v node)"',
          'BUNDLE="$ROOT/runtime/dist/foreman-setup.js"',
          'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi',
          'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
          'exec "$NODE" "$BUNDLE" "$@"',
          "",
        ].join("\n"),
      ),
      "legacy_adapter_domain_logic",
    );
    // wrong exit code
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 1; fi',
          'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
    // altered diagnostic
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ -z "$NODE" ]; then echo "foreman-setup: install node at /usr/bin" >&2; exit 3; fi',
          'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
    // wrong variable in check
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ -z "$NODE_BIN" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi',
          'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
    // only node check (missing bundle check)
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
    // reordered checks
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
          'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
    // smuggled operator on check line
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi; rm -rf /tmp/x',
          'if [ ! -f "$BUNDLE" ]; then echo "foreman-setup: runtime bundle missing" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
    // absolute path in diagnostic
    assert.equal(
      inspectLegacyAdapter(
        path,
        bad([
          'if [ -z "$NODE" ]; then echo "foreman-setup: node is required" >&2; exit 3; fi',
          'if [ ! -f "$BUNDLE" ]; then echo "missing /home/x/foreman-setup.js" >&2; exit 3; fi',
        ]),
      ),
      "legacy_adapter_domain_logic",
    );
  });

  describe("R4C3 lane-run migration artifact", () => {
    it("accepts the tracked skills/foreman/scripts/lane-run.sh migration artifact", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      assert.equal(inspectLegacyAdapter(LANE_RUN_PATH, body), null);
    });

    it("rejects a one-byte change inside the forwarding block", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      assert.ok(body.includes(LANE_RUN_FORWARDING_BLOCK));
      const mutated = body.replace(
        LANE_RUN_FORWARDING_BLOCK,
        LANE_RUN_FORWARDING_BLOCK.replace(
          "vendor admission runtime is missing",
          "vendor admission runtime is Missing",
        ),
      );
      assert.notEqual(mutated, body);
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, mutated),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects a one-byte change outside the forwarding block", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      const idx = body.indexOf(LANE_RUN_FORWARDING_BLOCK);
      assert.ok(idx > 0);
      // Flip one remainder byte before the forwarding block.
      const before = body.slice(0, idx);
      const after = body.slice(idx);
      const flipAt = before.lastIndexOf("lane");
      assert.ok(flipAt >= 0);
      const mutated =
        before.slice(0, flipAt) + "Lane" + before.slice(flipAt + 4) + after;
      assert.notEqual(mutated, body);
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, mutated),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects an extra probe or parser smuggled beside the forwarding block", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      const idx = body.indexOf(LANE_RUN_FORWARDING_BLOCK);
      assert.ok(idx >= 0);
      const end = idx + LANE_RUN_FORWARDING_BLOCK.length;
      const smuggled =
        body.slice(0, end) +
        '\n  extra_probe="$(command -v grok)"\n' +
        body.slice(end);
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, smuggled),
        "legacy_adapter_domain_logic",
      );
    });

    it("does not admit the migration path under a different repository path", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      assert.equal(
        inspectLegacyAdapter("skills/foreman/scripts/other-lane-run.sh", body),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects relocating the exact forwarding block to the end of the file", () => {
      // Pure move: concatenated remainder bytes are unchanged, so a single
      // remainder digest cannot detect this. Position-pinning must reject.
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      const idx = body.indexOf(LANE_RUN_FORWARDING_BLOCK);
      assert.ok(idx >= 0);
      const end = idx + LANE_RUN_FORWARDING_BLOCK.length;
      const relocated =
        body.slice(0, idx) + body.slice(end) + LANE_RUN_FORWARDING_BLOCK;
      assert.notEqual(relocated, body);
      assert.equal(
        relocated.indexOf(LANE_RUN_FORWARDING_BLOCK),
        relocated.length - LANE_RUN_FORWARDING_BLOCK.length,
      );
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, relocated),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects relocating the exact forwarding block to the start of the file", () => {
      // Pure move: concatenated remainder bytes are unchanged, so a single
      // remainder digest cannot detect this. Position-pinning must reject.
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      const idx = body.indexOf(LANE_RUN_FORWARDING_BLOCK);
      assert.ok(idx >= 0);
      const end = idx + LANE_RUN_FORWARDING_BLOCK.length;
      const relocated =
        LANE_RUN_FORWARDING_BLOCK + body.slice(0, idx) + body.slice(end);
      assert.notEqual(relocated, body);
      assert.equal(relocated.indexOf(LANE_RUN_FORWARDING_BLOCK), 0);
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, relocated),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects a duplicate exact forwarding block", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      const idx = body.indexOf(LANE_RUN_FORWARDING_BLOCK);
      assert.ok(idx >= 0);
      const end = idx + LANE_RUN_FORWARDING_BLOCK.length;
      const duplicated =
        body.slice(0, end) +
        "\n" +
        LANE_RUN_FORWARDING_BLOCK +
        body.slice(end);
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, duplicated),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects a one-byte change in the suffix after the forwarding block", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_RUN_PATH), "utf8");
      const idx = body.indexOf(LANE_RUN_FORWARDING_BLOCK);
      assert.ok(idx >= 0);
      const end = idx + LANE_RUN_FORWARDING_BLOCK.length;
      const after = body.slice(end);
      const flipAt = after.indexOf("Task");
      assert.ok(flipAt >= 0);
      const mutated =
        body.slice(0, end) +
        after.slice(0, flipAt) +
        "task" +
        after.slice(flipAt + 4);
      assert.notEqual(mutated, body);
      assert.equal(
        inspectLegacyAdapter(LANE_RUN_PATH, mutated),
        "legacy_adapter_domain_logic",
      );
    });
  });

  describe("R5D lane-supervise migration artifact", () => {
    it("accepts the tracked skills/foreman/scripts/lane-supervise.sh migration artifact", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_SUPERVISE_PATH), "utf8");
      assert.equal(inspectLegacyAdapter(LANE_SUPERVISE_PATH, body), null);
    });

    it("rejects a one-byte change in the thin adapter body", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_SUPERVISE_PATH), "utf8");
      const flipAt = body.indexOf("lane-supervise: node is required");
      assert.ok(flipAt >= 0);
      const mutated =
        body.slice(0, flipAt) + "Lane-supervise: node is required" + body.slice(flipAt + "lane-supervise: node is required".length);
      assert.notEqual(mutated, body);
      assert.equal(
        inspectLegacyAdapter(LANE_SUPERVISE_PATH, mutated),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects domain-logic smuggled into the thin adapter", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_SUPERVISE_PATH), "utf8");
      const smuggled = body.replace(
        'exec "$NODE" "$BUNDLE" --state-root "$FOREMAN_HOME" "$@"',
        'READY="$(jq -r .status < readiness.json)"\n' +
          'if [ "$READY" = "not_ready" ]; then remediate; exit 1; fi\n' +
          'exec "$NODE" "$BUNDLE" --state-root "$FOREMAN_HOME" "$@"',
      );
      assert.notEqual(smuggled, body);
      assert.equal(
        inspectLegacyAdapter(LANE_SUPERVISE_PATH, smuggled),
        "legacy_adapter_domain_logic",
      );
    });

    it("does not admit the migration body under a different repository path", () => {
      const body = readFileSync(join(REPO_ROOT, LANE_SUPERVISE_PATH), "utf8");
      assert.equal(
        inspectLegacyAdapter(
          "skills/foreman/scripts/other-lane-supervise.sh",
          body,
        ),
        "legacy_adapter_domain_logic",
      );
    });

    it("rejects an empty or null-containing body on the migration path", () => {
      assert.equal(
        inspectLegacyAdapter(LANE_SUPERVISE_PATH, ""),
        "legacy_adapter_domain_logic",
      );
      assert.equal(
        inspectLegacyAdapter(LANE_SUPERVISE_PATH, "x\u0000y"),
        "legacy_adapter_domain_logic",
      );
    });
  });

  describe("v0.4 release migration artifacts", () => {
    for (const path of V040_PINNED_SHELL_PATHS) {
      it(`accepts only the tracked ${path} body at its exact path`, () => {
        const body = readFileSync(join(REPO_ROOT, path), "utf8");
        assert.equal(inspectLegacyAdapter(path, body), null);
        assert.equal(
          inspectLegacyAdapter(path, `${body}# changed\n`),
          "legacy_adapter_domain_logic",
        );
        assert.equal(
          inspectLegacyAdapter(`skills/foreman/scripts/copy-${path.split("/").at(-1)}`, body),
          "legacy_adapter_domain_logic",
        );
      });
    }
  });
});
