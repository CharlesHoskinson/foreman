import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import { evaluateArchitecturePolicy } from "./architecture-evaluate.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const MB = "c".repeat(40);

function key(oid: string, path: string): string {
  return `${oid}:${path}`;
}

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function manifestV2(
  artifacts: readonly {
    id: string;
    relativePath: string;
    bytes: Uint8Array;
  }[],
): string {
  return (
    canonicalize({
      artifacts: artifacts.map((a) => ({
        byteLength: a.bytes.byteLength,
        id: a.id,
        relativePath: a.relativePath,
        sha256: sha256Hex(a.bytes),
      })),
      nodeRange: ">=24 <25",
      schemaVersion: 2,
    }) + "\n"
  );
}

describe("evaluateArchitecturePolicy known-bad branches", () => {
  it("1. rejects new .py", () => {
    const path = "tools/helper.py";
    const blobs = new Map([[key(HEAD, path), enc("print(1)\n")]]);
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs,
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_python");
    assert.equal(r.findings[0]!.path, path);
  });

  it("2. rejects new .sh", () => {
    const path = "scripts/x.sh";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc("#!/bin/sh\n")]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_posix_shell");
  });

  it("3. rejects new .ps1", () => {
    const path = "scripts/x.ps1";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc("Write-Host hi\n")]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_powershell");
  });

  it("4. rejects new .cmd and .bat", () => {
    for (const path of ["x.cmd", "y.bat"] as const) {
      const r = evaluateArchitecturePolicy({
        base: BASE,
        mergeBase: MB,
        head: HEAD,
        records: [{ kind: "added", path, status: "A" }],
        mergeBasePaths: [],
        headPaths: [path],
        blobs: new Map([[key(HEAD, path), enc("@echo off\n")]]),
        identities: new Map(),
      linkPaths: new Set(),
      });
      assert.equal(r._tag, "Fail");
      if (r._tag !== "Fail") return;
      assert.equal(r.findings[0]!.reason, "prohibited_cmd");
    }
  });

  it("5. rejects new .js and .jsx outside manifest", () => {
    for (const [path, reason] of [
      ["lib/x.js", "prohibited_javascript"],
      ["lib/x.jsx", "prohibited_jsx"],
    ] as const) {
      const r = evaluateArchitecturePolicy({
        base: BASE,
        mergeBase: MB,
        head: HEAD,
        records: [{ kind: "added", path, status: "A" }],
        mergeBasePaths: [],
        headPaths: [path],
        blobs: new Map([[key(HEAD, path), enc("export default 1\n")]]),
        identities: new Map(),
      linkPaths: new Set(),
      });
      assert.equal(r._tag, "Fail");
      if (r._tag !== "Fail") return;
      assert.equal(r.findings[0]!.reason, reason);
    }
  });

  it("6. rejects new .mjs", () => {
    const path = "lib/x.mjs";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc("export default 1\n")]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_mjs");
  });

  it("7. rejects new .cjs", () => {
    const path = "lib/x.cjs";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc("module.exports = 1\n")]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_cjs");
  });

  it("8. rejects TypeScript with Bun-only import/API", () => {
    const path = "packages/x/src/a.ts";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([
        [key(HEAD, path), enc(`import x from "bun";\nexport const y = x;\n`)],
      ]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_bun_only");
  });

  it("9. rejects TypeScript with Deno-only API", () => {
    const path = "packages/x/src/b.ts";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "modified", path, status: "M" }],
      mergeBasePaths: [path],
      headPaths: [path],
      blobs: new Map([
        [key(HEAD, path), enc(`export const e = Deno.env.get("A");\n`)],
      ]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_deno_only");
  });

  it("10. rejects modified legacy adapter with domain branch", () => {
    const path = "skills/foreman/scripts/tool-check.sh";
    const body = [
      "#!/usr/bin/env bash",
      'READY="$(jq -r .status < readiness.json)"',
      'if [ "$READY" = "not_ready" ]; then remediate; fi',
      'exec node "$BUNDLE" "$@"',
      "",
    ].join("\n");
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "modified", path, status: "M" }],
      mergeBasePaths: [path],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc(body)]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "legacy_adapter_domain_logic");
  });

  it("11. reports unchanged legacy debt without failing", () => {
    const legacy = "skills/foreman/scripts/fm-session.py";
    const good = "packages/policy/src/ok.ts";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path: good, status: "A" }],
      mergeBasePaths: [legacy],
      headPaths: [legacy, good],
      blobs: new Map([
        [
          key(HEAD, good),
          enc(`import { readFileSync } from "node:fs";\nexport const n = 1;\n`),
        ],
      ]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Pass");
    if (r._tag !== "Pass") return;
    assert.equal(r.findings.length, 0);
    assert.ok(r.legacyDebt.some((d) => d.path === legacy));
    assert.equal(
      r.legacyDebt.find((d) => d.path === legacy)!.reason,
      "prohibited_python",
    );
  });

  it("12. accepts exact manifest-bound generated runtime bundle", () => {
    const bundlePath =
      "skills/foreman/runtime/dist/architecture-policy.js";
    const bundleBytes = enc("export const bundle = 1;\n");
    const mf = enc(
      manifestV2([
        {
          id: "architecture-policy",
          relativePath: "dist/architecture-policy.js",
          bytes: bundleBytes,
        },
      ]),
    );
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [
        { kind: "added", path: bundlePath, status: "A" },
        {
          kind: "added",
          path: "skills/foreman/runtime/manifest.json",
          status: "A",
        },
      ],
      mergeBasePaths: [],
      headPaths: [bundlePath, "skills/foreman/runtime/manifest.json"],
      blobs: new Map([
        [key(HEAD, bundlePath), bundleBytes],
        [key(HEAD, "skills/foreman/runtime/manifest.json"), mf],
      ]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Pass", JSON.stringify(r));
  });

  it("13. rejects missing mismatched linked duplicate undeclared bundles", () => {
    const bundlePath = "skills/foreman/runtime/dist/architecture-policy.js";
    const bundleBytes = enc("export const bundle = 1;\n");
    const other = enc("export const other = 2;\n");
    const mf = enc(
      manifestV2([
        {
          id: "architecture-policy",
          relativePath: "dist/architecture-policy.js",
          bytes: bundleBytes,
        },
      ]),
    );

    // mismatched
    {
      const r = evaluateArchitecturePolicy({
        base: BASE,
        mergeBase: MB,
        head: HEAD,
        records: [{ kind: "added", path: bundlePath, status: "A" }],
        mergeBasePaths: [],
        headPaths: [bundlePath],
        blobs: new Map([
          [key(HEAD, bundlePath), other],
          [key(HEAD, "skills/foreman/runtime/manifest.json"), mf],
        ]),
        identities: new Map(),
      linkPaths: new Set(),
      });
      assert.equal(r._tag, "Fail");
      if (r._tag === "Fail") {
        assert.equal(r.findings[0]!.reason, "manifest_bundle_mismatch");
      }
    }

    // undeclared path
    {
      const path = "skills/foreman/runtime/dist/extra.js";
      const r = evaluateArchitecturePolicy({
        base: BASE,
        mergeBase: MB,
        head: HEAD,
        records: [{ kind: "added", path, status: "A" }],
        mergeBasePaths: [],
        headPaths: [path],
        blobs: new Map([
          [key(HEAD, path), other],
          [key(HEAD, "skills/foreman/runtime/manifest.json"), mf],
        ]),
        identities: new Map(),
      linkPaths: new Set(),
      });
      assert.equal(r._tag, "Fail");
      if (r._tag === "Fail") {
        assert.equal(r.findings[0]!.reason, "undeclared_generated_bundle");
      }
    }

    // linked
    {
      const r = evaluateArchitecturePolicy({
        base: BASE,
        mergeBase: MB,
        head: HEAD,
        records: [{ kind: "added", path: bundlePath, status: "A" }],
        mergeBasePaths: [],
        headPaths: [bundlePath],
        blobs: new Map([
          [key(HEAD, bundlePath), bundleBytes],
          [key(HEAD, "skills/foreman/runtime/manifest.json"), mf],
        ]),
        identities: new Map(),
      linkPaths: new Set([key(HEAD, bundlePath)]),
      });
      assert.equal(r._tag, "Fail");
      if (r._tag === "Fail") {
        assert.equal(r.findings[0]!.reason, "manifest_bundle_linked");
      }
    }

    // missing manifest for declared path
    {
      const r = evaluateArchitecturePolicy({
        base: BASE,
        mergeBase: MB,
        head: HEAD,
        records: [{ kind: "added", path: bundlePath, status: "A" }],
        mergeBasePaths: [],
        headPaths: [bundlePath],
        blobs: new Map([[key(HEAD, bundlePath), bundleBytes]]),
        identities: new Map(),
      linkPaths: new Set(),
      });
      assert.equal(r._tag, "Fail");
      if (r._tag === "Fail") {
        assert.equal(r.findings[0]!.reason, "manifest_bundle_missing");
      }
    }

    // digest helper used
    assert.equal(
      createHash("sha256").update(bundleBytes).digest("hex"),
      sha256Hex(bundleBytes),
    );
  });

  it("14. keeps hostile paths as one path and reports safely", () => {
    const path = "dir with spaces/\t-leading.py";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc("x=1\n")]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings.length, 1);
    assert.equal(r.findings[0]!.path, path);
    // Canonical JSON must escape without splitting
    const line = canonicalize(r);
    assert.ok(line.includes("prohibited_python"));
    assert.ok(!line.includes("\nprint"));
  });

  it("17. accepts ordinary strict Node TypeScript", () => {
    const path = "packages/core/src/new-util.ts";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([
        [
          key(HEAD, path),
          enc(
            [
              `import { createHash } from "node:crypto";`,
              `export function dig(s: string): string {`,
              `  return createHash("sha256").update(s).digest("hex");`,
              `}`,
              ``,
            ].join("\n"),
          ),
        ],
      ]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Pass");
  });

  it("rejects malformed manifest-only authority change", () => {
    const mf = "skills/foreman/runtime/manifest.json";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path: mf, status: "A" }],
      mergeBasePaths: [],
      headPaths: [mf],
      blobs: new Map([[key(HEAD, mf), enc("{not-json}\n")]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.ok(
      r.findings.some(
        (f) => f.path === mf && f.reason === "schema_mismatch",
      ),
    );
  });

  it("rejects closed-schema-invalid manifest-only change", () => {
    const mf = "skills/foreman/runtime/manifest.json";
    // Valid JSON but wrong schema / unknown field
    const body =
      canonicalize({
        artifacts: [],
        extra: true,
        nodeRange: ">=24 <25",
        schemaVersion: 2,
      }) + "\n";
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "modified", path: mf, status: "M" }],
      mergeBasePaths: [mf],
      headPaths: [mf],
      blobs: new Map([[key(HEAD, mf), enc(body)]]),
      identities: new Map(),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.ok(r.findings.some((f) => f.path === mf));
  });
});

const BATS_TEST_DATA_HEADER =
  "# bats test data (run via `bats`, not as a product executable)";

const EXEC_IDENTITY = {
  present: true as const,
  mode: "100755",
  isExecutable: true,
  isSymlink: false,
  isSpecial: false,
};

describe("modified Bats test-data exception", () => {
  it("accepts modified tests/*.bats with exact header and mode 100755", () => {
    const path = "tests/x.bats";
    const body = `${BATS_TEST_DATA_HEADER}\n@test "ok" { true; }\n`;
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "modified", path, status: "M" }],
      mergeBasePaths: [path],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc(body)]]),
      identities: new Map([[key(HEAD, path), EXEC_IDENTITY]]),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Pass", JSON.stringify(r));
    assert.equal(r.findings.length, 0);
  });

  it("does not exempt added Bats with the exact header", () => {
    const path = "tests/new.bats";
    const body = `${BATS_TEST_DATA_HEADER}\n@test "ok" { true; }\n`;
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "added", path, status: "A" }],
      mergeBasePaths: [],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc(body)]]),
      identities: new Map([[key(HEAD, path), EXEC_IDENTITY]]),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_extensionless_executable");
    assert.equal(r.findings[0]!.path, path);
  });

  it("does not exempt renamed Bats with the exact header", () => {
    const path = "tests/renamed.bats";
    const body = `${BATS_TEST_DATA_HEADER}\n@test "ok" { true; }\n`;
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [
        {
          kind: "renamed",
          path,
          oldPath: "tests/old.bats",
          status: "R",
        },
      ],
      mergeBasePaths: ["tests/old.bats"],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc(body)]]),
      identities: new Map([[key(HEAD, path), EXEC_IDENTITY]]),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_extensionless_executable");
    assert.equal(r.findings[0]!.path, path);
  });

  it("does not exempt modified Bats outside tests/", () => {
    const path = "tools/x.bats";
    const body = `${BATS_TEST_DATA_HEADER}\n@test "ok" { true; }\n`;
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "modified", path, status: "M" }],
      mergeBasePaths: [path],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc(body)]]),
      identities: new Map([[key(HEAD, path), EXEC_IDENTITY]]),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_extensionless_executable");
    assert.equal(r.findings[0]!.path, path);
  });

  it("does not exempt modified tests/*.bats when first line differs by one byte", () => {
    const path = "tests/x.bats";
    // One-byte drift: trailing space on the header line
    const body =
      "# bats test data (run via `bats`, not as a product executable) \n" +
      '@test "ok" { true; }\n';
    const r = evaluateArchitecturePolicy({
      base: BASE,
      mergeBase: MB,
      head: HEAD,
      records: [{ kind: "modified", path, status: "M" }],
      mergeBasePaths: [path],
      headPaths: [path],
      blobs: new Map([[key(HEAD, path), enc(body)]]),
      identities: new Map([[key(HEAD, path), EXEC_IDENTITY]]),
      linkPaths: new Set(),
    });
    assert.equal(r._tag, "Fail");
    if (r._tag !== "Fail") return;
    assert.equal(r.findings[0]!.reason, "prohibited_extensionless_executable");
    assert.equal(r.findings[0]!.path, path);
  });
});
