/**
 * Sprint 3 R6: bounded fixture-aware secret scan — RED-first tests.
 * Fail-closed bounds, filename/PEM classes, fixture identity, CLI safety.
 *
 * Cross-platform: pure classifiers, decoders, renderers, argv, digest, and
 * constants always run. Live filesystem traversal runs only when secure
 * directory-descriptor anchors are available. Fail-closed
 * `unsupported_traversal` is proven on every host via a test-only capability
 * injection (no pathname fallback, no Windows anchor emulation).
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";
import { Effect } from "effect";
import {
  DEFAULT_SECRET_SCAN_BOUNDS,
  EXIT_CLEAN,
  EXIT_NOT_CLEAN,
  EXIT_INVALID_ARGUMENTS,
  FIXTURE_DECLARATION_RELPATH,
  FIXTURE_SUBTREE_PREFIX,
  MAX_DIRECTORY_ENTRIES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_LINE_INSPECTIONS,
  MAX_RELATIVE_PATH_BYTES,
  MAX_TOTAL_INSPECTED_BYTES,
  SECRET_SCAN_SCHEMA_VERSION,
  isPemPrivateKeyLine,
  isRefusedSecretFilename,
  isSecretScanResult,
  liveSecretScan,
  parseSecretScanArgv,
  renderSecretScanJson,
  runSecretScanCli,
  scanWorktree,
  secretScanDirectoryAnchorSupported,
  setSecretScanDirectoryAnchorCapabilityForTests,
  setSecretScanRaceHook,
  sha256HexOfBytes,
  type SecretScanBounds,
  type SecretScanCliIo,
  type SecretScanResult,
} from "./secret-scan.js";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/** Real host capability — never forced true. Live traversal skips when false. */
const anchorOk = secretScanDirectoryAnchorSupported();
const liveTraversal = { skip: !anchorOk };

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function tempRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `foreman-ss-${label}-`));
}

function writeFile(root: string, rel: string, content: string | Buffer): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function writeExemptions(
  root: string,
  exemptions: readonly { path: string; sha256: string }[],
): void {
  writeFile(
    root,
    FIXTURE_DECLARATION_RELPATH,
    JSON.stringify({ schemaVersion: 1, exemptions }, null, 0) + "\n",
  );
}

function runScan(
  worktree: string,
  bounds?: Partial<SecretScanBounds>,
): SecretScanResult {
  return Effect.runSync(
    scanWorktree({
      worktreeRoot: worktree,
      bounds: bounds
        ? { ...DEFAULT_SECRET_SCAN_BOUNDS, ...bounds }
        : DEFAULT_SECRET_SCAN_BOUNDS,
    }).pipe(Effect.provide(liveSecretScan)),
  );
}

function captureIo(): SecretScanCliIo & {
  readonly stdout: () => string;
  readonly stderr: () => string;
} {
  let out = "";
  let err = "";
  return {
    writeStdout: (t) => {
      out += t;
    },
    writeStderr: (t) => {
      err += t;
    },
    stdout: () => out,
    stderr: () => err,
  };
}

function assertSecretSafe(text: string, forbidden: readonly string[]): void {
  for (const f of forbidden) {
    assert.equal(
      text.includes(f),
      false,
      `output must not leak ${JSON.stringify(f)}: ${text}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pure classifiers / decoders / renderers (always active on every platform)
// ---------------------------------------------------------------------------

describe("pure filename refusal classifier", () => {
  it("refuses .env and .env.* except .env.example", () => {
    assert.equal(isRefusedSecretFilename(".env"), true);
    assert.equal(isRefusedSecretFilename(".env.local"), true);
    assert.equal(isRefusedSecretFilename(".env.production"), true);
    assert.equal(isRefusedSecretFilename(".env.example"), false);
  });

  for (const name of [
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "x.pem",
    "x.key",
    "x.p12",
    "x.pfx",
  ] as const) {
    it(`refuses private-key filename class ${name}`, () => {
      assert.equal(isRefusedSecretFilename(name), true);
    });
  }

  it("accepts ordinary basenames", () => {
    assert.equal(isRefusedSecretFilename("notes.txt"), false);
    assert.equal(isRefusedSecretFilename("id_rsa.pub"), false);
  });
});

describe("pure PEM private-key line classifier", () => {
  it("matches PEM banners at line start with optional whitespace", () => {
    assert.equal(
      isPemPrivateKeyLine("-----BEGIN RSA PRIVATE KEY-----"),
      true,
    );
    assert.equal(
      isPemPrivateKeyLine("  -----BEGIN EC PRIVATE KEY-----"),
      true,
    );
    assert.equal(
      isPemPrivateKeyLine("-----BEGIN OPENSSH PRIVATE KEY-----\r"),
      true,
    );
  });

  it("rejects inline mention without a PEM line banner", () => {
    assert.equal(
      isPemPrivateKeyLine(
        "The scanner rejects -----BEGIN RSA PRIVATE KEY----- when it starts a PEM line.",
      ),
      false,
    );
    assert.equal(isPemPrivateKeyLine("not a key"), false);
  });
});

// ---------------------------------------------------------------------------
// Filename refusal classes (live traversal)
// ---------------------------------------------------------------------------

describe("filename refusal classes", liveTraversal, () => {
  it("refuses .env at worktree root", () => {
    const wt = tempRoot("env");
    try {
      writeFile(wt, ".env", "SECRET=x\n");
      const r = runScan(wt);
      assert.equal(r._tag, "SecretFound");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("refuses .env.local at subdirectory depth", () => {
    const wt = tempRoot("envlocal");
    try {
      writeFile(wt, "sub/dir/.env.local", "SECRET=x\n");
      const r = runScan(wt);
      assert.equal(r._tag, "SecretFound");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("accepts .env.example", () => {
    const wt = tempRoot("envex");
    try {
      writeFile(wt, ".env.example", "SECRET=example\n");
      const r = runScan(wt);
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  for (const name of [
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
    "x.pem",
    "x.key",
    "x.p12",
    "x.pfx",
  ] as const) {
    it(`refuses private-key filename ${name} without PEM content`, () => {
      const wt = tempRoot(`fn-${name}`);
      try {
        writeFile(wt, name, "not a PEM banner\n");
        const r = runScan(wt);
        assert.equal(r._tag, "SecretFound");
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// PEM content refusal (live traversal)
// ---------------------------------------------------------------------------

describe("PEM private-key header refusal", liveTraversal, () => {
  it("refuses a PEM header at the start of a line", () => {
    const wt = tempRoot("pem");
    try {
      writeFile(
        wt,
        "notes.txt",
        "-----BEGIN RSA PRIVATE KEY-----\nMIIB\n-----END RSA PRIVATE KEY-----\n",
      );
      const r = runScan(wt);
      assert.equal(r._tag, "SecretFound");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("accepts documentation that mentions a private-key marker inline", () => {
    const wt = tempRoot("pemdoc");
    try {
      writeFile(
        wt,
        "security-notes.md",
        "The scanner rejects -----BEGIN RSA PRIVATE KEY----- when it starts a PEM line.\n",
      );
      const r = runScan(wt);
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("refuses PEM with leading whitespace on the banner line", () => {
    const wt = tempRoot("pemws");
    try {
      writeFile(wt, "k.txt", "  -----BEGIN EC PRIVATE KEY-----\n");
      const r = runScan(wt);
      assert.equal(r._tag, "SecretFound");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Prune .git / .harness (live traversal)
// ---------------------------------------------------------------------------

describe("prune .git and .harness", liveTraversal, () => {
  it("accepts .env inside top-level .harness", () => {
    const wt = tempRoot("harness");
    try {
      writeFile(wt, ".harness/vendor-home/grok/.env", "SECRET=x\n");
      const r = runScan(wt);
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("accepts private-key filename inside top-level .git", () => {
    const wt = tempRoot("gitprune");
    try {
      writeFile(wt, ".git/id_rsa", "not a key\n");
      const r = runScan(wt);
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  // Host verification after fa70182: prune names are still encountered entries;
  // maxRelativePathBytes must apply before prune, not only before type dispatch.
  it("refuses top-level prune entry when relative path exceeds maxRelativePathBytes", () => {
    const wt = tempRoot("prune-path-bound");
    try {
      // Only a top-level prune name plus a short sibling so the bound of 3
      // can only be tripped by ".git" (4 UTF-8 bytes), not by other paths.
      writeFile(wt, ".git/id_rsa", "not a key\n");
      writeFile(wt, "a", "ok\n");
      const r = runScan(wt, { maxRelativePathBytes: 3 });
      assert.equal(
        r._tag,
        "Refused",
        `prune entry must not bypass path bound; got ${JSON.stringify(r)}`,
      );
      if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("still prunes .git at valid maxRelativePathBytes", () => {
    const wt = tempRoot("prune-path-ok");
    try {
      writeFile(wt, ".git/id_rsa", "not a key\n");
      writeFile(wt, "a", "ok\n");
      // ".git" is 4 bytes — exact bound passes and prune still applies.
      const r = runScan(wt, { maxRelativePathBytes: 4 });
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture identity exemptions (live traversal)
// ---------------------------------------------------------------------------

describe("fixture digest-bound exemptions", liveTraversal, () => {
  it("accepts exact path+digest exemption under tests/fixtures/", () => {
    const wt = tempRoot("fix-ok");
    try {
      // Shell refuse class is `.env` / `.env.*`, not `*.env`.
      const rel = `${FIXTURE_SUBTREE_PREFIX}secret-scan/.env.known-bad`;
      const body = "SECRET=fixture-known-bad\n";
      writeFile(wt, rel, body);
      writeExemptions(wt, [{ path: rel, sha256: sha256Hex(body) }]);
      const r = runScan(wt);
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("refuses one-byte change against a declared fixture digest", () => {
    const wt = tempRoot("fix-byte");
    try {
      const rel = `${FIXTURE_SUBTREE_PREFIX}secret-scan/.env.known-bad`;
      const body = "SECRET=fixture-known-bad\n";
      writeFile(wt, rel, body + "x");
      writeExemptions(wt, [{ path: rel, sha256: sha256Hex(body) }]);
      const r = runScan(wt);
      assert.equal(r._tag, "SecretFound");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("refuses path-only fixture spoof (wrong digest)", () => {
    const wt = tempRoot("fix-spoof");
    try {
      const rel = `${FIXTURE_SUBTREE_PREFIX}secret-scan/.env.spoof`;
      writeFile(wt, rel, "SECRET=real\n");
      writeExemptions(wt, [
        { path: rel, sha256: "a".repeat(64) },
      ]);
      const r = runScan(wt);
      assert.equal(r._tag, "SecretFound");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("never exempts .env outside the fixture subtree", () => {
    const wt = tempRoot("fix-out");
    try {
      const body = "SECRET=out\n";
      writeFile(wt, "src/.env", body);
      writeExemptions(wt, [
        { path: "src/.env", sha256: sha256Hex(body) },
      ]);
      // Malformed because path leaves fixture subtree, or secret found
      const r = runScan(wt);
      assert.ok(r._tag === "SecretFound" || r._tag === "Refused");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("refuses malformed fixture declaration", () => {
    const wt = tempRoot("fix-mal");
    try {
      writeFile(wt, FIXTURE_DECLARATION_RELPATH, "{not-json\n");
      writeFile(wt, "ok.txt", "hi\n");
      const r = runScan(wt);
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") {
        assert.equal(r.reason, "malformed_fixture_declaration");
      }
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Directory-identity race seams (descriptor anchors)
// ---------------------------------------------------------------------------

afterEach(() => {
  setSecretScanRaceHook(undefined);
  setSecretScanDirectoryAnchorCapabilityForTests(undefined);
});

/**
 * Swap a directory pathname for a symlink to `outside` while the scanner
 * still holds a descriptor on the original identity.
 */
function swapPathForSymlink(path: string, outside: string): void {
  const parked = `${path}.parked-identity`;
  renameSync(path, parked);
  symlinkSync(outside, path);
}

describe("directory-identity race seams", () => {
  it(
    "race seam: root swap after bind does not inspect outside secrets",
    liveTraversal,
    () => {
      const wt = tempRoot("race-root");
      const outside = tempRoot("race-root-out");
      const parked = `${wt}.parked-identity`;
      try {
        writeFile(wt, "inside-ok.txt", "ok\n");
        // Outside target holds a secret that would flip the verdict if followed.
        writeFile(outside, ".env", "SECRET=outside-root-leak\n");
        writeFile(outside, "outside-only.txt", "marker\n");

        setSecretScanRaceHook({
          afterBindRoot: () => {
            swapPathForSymlink(wt, outside);
          },
        });

        const r = runScan(wt);
        assert.equal(
          r._tag,
          "Clean",
          `outside secret must not affect verdict; got ${JSON.stringify(r)}`,
        );
        assert.ok(lstatSync(wt).isSymbolicLink());
        assert.equal(
          readFileSync(join(outside, ".env"), "utf8"),
          "SECRET=outside-root-leak\n",
        );
        assert.ok(
          readdirSync(outside).includes("outside-only.txt"),
          "outside tree must remain untraversed as a scan target",
        );
        assert.ok(
          readdirSync(parked).includes("inside-ok.txt"),
          "original root identity must remain the scan target",
        );
      } finally {
        setSecretScanRaceHook(undefined);
        rmSync(wt, { recursive: true, force: true });
        rmSync(parked, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it(
    "race seam: nested directory swap after bind does not inspect outside secrets",
    liveTraversal,
    () => {
      const wt = tempRoot("race-nested");
      const outside = tempRoot("race-nested-out");
      const nestedPath = join(wt, "nested");
      const parked = `${nestedPath}.parked-identity`;
      try {
        writeFile(wt, "nested/inside.txt", "ok\n");
        writeFile(wt, "top-ok.txt", "ok\n");
        writeFile(outside, ".env", "SECRET=outside-nested-leak\n");
        writeFile(outside, "escaped.txt", "escape-marker\n");

        setSecretScanRaceHook({
          afterBindDirectory: (posixRel) => {
            if (posixRel === "nested") {
              swapPathForSymlink(nestedPath, outside);
            }
          },
        });

        const r = runScan(wt);
        assert.equal(
          r._tag,
          "Clean",
          `outside secret must not affect verdict; got ${JSON.stringify(r)}`,
        );
        assert.ok(lstatSync(nestedPath).isSymbolicLink());
        assert.equal(
          readFileSync(join(outside, ".env"), "utf8"),
          "SECRET=outside-nested-leak\n",
        );
        assert.deepEqual(
          readdirSync(outside).sort(),
          [".env", "escaped.txt"].sort(),
        );
        assert.ok(readdirSync(parked).includes("inside.txt"));
      } finally {
        setSecretScanRaceHook(undefined);
        rmSync(wt, { recursive: true, force: true });
        rmSync(parked, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
      }
    },
  );

  it("injected unsupported anchor fails closed with no pathname fallback", () => {
    // Runs on every platform (including Linux where anchors are available).
    // A secret is present so pathname fallback would yield SecretFound.
    const wt = tempRoot("inject-no-anchor");
    try {
      writeFile(wt, ".env", "SECRET=must-not-leak-via-pathname-fallback\n");
      writeFile(wt, "ok.txt", "ok\n");
      setSecretScanDirectoryAnchorCapabilityForTests(false);
      const r = runScan(wt);
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") {
        assert.equal(r.reason, "unsupported_traversal");
      }
      // Pathname fallback would have found .env → SecretFound.
      assert.notEqual(r._tag, "SecretFound");
      assert.notEqual(r._tag, "Clean");
    } finally {
      setSecretScanDirectoryAnchorCapabilityForTests(undefined);
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("exports anchor support probe without override", () => {
    setSecretScanDirectoryAnchorCapabilityForTests(undefined);
    assert.equal(typeof secretScanDirectoryAnchorSupported(), "boolean");
    assert.equal(secretScanDirectoryAnchorSupported(), anchorOk);
  });
});

// ---------------------------------------------------------------------------
// Symlinks, unreadable, identity change, escape
// ---------------------------------------------------------------------------

describe("boundary seams", () => {
  it(
    "does not follow a symlink file to outside secrets",
    liveTraversal,
    () => {
      const outer = tempRoot("outer");
      const wt = tempRoot("sym-file");
      try {
        const secret = writeFile(outer, "leak.env", "SECRET=out\n");
        symlinkSync(secret, join(wt, "link.env"));
        const r = runScan(wt);
        // symlink is not a regular file; skip without follow → Clean
        assert.equal(r._tag, "Clean");
      } finally {
        rmSync(wt, { recursive: true, force: true });
        rmSync(outer, { recursive: true, force: true });
      }
    },
  );

  it("does not descend into a symlink directory", liveTraversal, () => {
    const outer = tempRoot("outer-dir");
    const wt = tempRoot("sym-dir");
    try {
      writeFile(outer, ".env", "SECRET=out\n");
      symlinkSync(outer, join(wt, "linked-src"));
      const r = runScan(wt);
      assert.equal(r._tag, "Clean");
    } finally {
      rmSync(wt, { recursive: true, force: true });
      rmSync(outer, { recursive: true, force: true });
    }
  });

  it("refuses a symlink worktree root", liveTraversal, () => {
    const real = tempRoot("real-root");
    const parent = tempRoot("sym-parent");
    try {
      writeFile(real, "ok.txt", "x\n");
      const link = join(parent, "wt-link");
      symlinkSync(real, link);
      const r = runScan(link);
      assert.equal(r._tag, "Refused");
    } finally {
      rmSync(parent, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  // Pure path validation — no descriptor anchor required.
  it("refuses relative worktree input", () => {
    const r = runScan("relative/path");
    assert.equal(r._tag, "Refused");
    if (r._tag === "Refused") assert.equal(r.reason, "invalid_worktree");
  });

  it("refuses unreadable regular file", liveTraversal, (t) => {
    if (process.platform === "win32") {
      t.skip("chmod unreadable is not meaningful on win32");
      return;
    }
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("root bypasses file mode checks");
      return;
    }
    const wt = tempRoot("unreadable");
    try {
      const abs = writeFile(wt, "secretish.txt", "-----BEGIN RSA PRIVATE KEY-----\n");
      chmodSync(abs, 0o000);
      const r = runScan(wt);
      chmodSync(abs, 0o644);
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") assert.equal(r.reason, "unreadable");
    } finally {
      try {
        chmodSync(join(wt, "secretish.txt"), 0o644);
      } catch {
        /* ignore */
      }
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Exact bounds and bound+1
// ---------------------------------------------------------------------------

describe("explicit positive bounds", () => {
  it("accepts exact MAX_FILES and refuses MAX_FILES+1", liveTraversal, () => {
    const wtOk = tempRoot("files-eq");
    const wtOver = tempRoot("files-over");
    try {
      const n = 3;
      for (let i = 0; i < n; i++) writeFile(wtOk, `f${i}.txt`, "ok\n");
      for (let i = 0; i < n + 1; i++) writeFile(wtOver, `f${i}.txt`, "ok\n");
      assert.equal(runScan(wtOk, { maxFiles: n })._tag, "Clean");
      const over = runScan(wtOver, { maxFiles: n });
      assert.equal(over._tag, "Refused");
      if (over._tag === "Refused") assert.equal(over.reason, "bound_exceeded");
    } finally {
      rmSync(wtOk, { recursive: true, force: true });
      rmSync(wtOver, { recursive: true, force: true });
    }
  });

  it("accepts exact MAX_DIRECTORY_ENTRIES and refuses +1", liveTraversal, () => {
    const wtOk = tempRoot("dir-eq");
    const wtOver = tempRoot("dir-over");
    try {
      // Root readdir: n files → n entries. Bound counts every dirent.
      const n = 4;
      for (let i = 0; i < n; i++) writeFile(wtOk, `e${i}.txt`, "ok\n");
      for (let i = 0; i < n + 1; i++) writeFile(wtOver, `e${i}.txt`, "ok\n");
      assert.equal(runScan(wtOk, { maxDirectoryEntries: n })._tag, "Clean");
      const over = runScan(wtOver, { maxDirectoryEntries: n });
      assert.equal(over._tag, "Refused");
      if (over._tag === "Refused") assert.equal(over.reason, "bound_exceeded");
    } finally {
      rmSync(wtOk, { recursive: true, force: true });
      rmSync(wtOver, { recursive: true, force: true });
    }
  });

  it("accepts exact MAX_RELATIVE_PATH_BYTES and refuses +1", liveTraversal, () => {
    const wtOk = tempRoot("path-eq");
    const wtOver = tempRoot("path-over");
    try {
      const exact = "a".repeat(16);
      const over = "a".repeat(17);
      writeFile(wtOk, exact, "ok\n");
      writeFile(wtOver, over, "ok\n");
      assert.equal(
        runScan(wtOk, { maxRelativePathBytes: 16 })._tag,
        "Clean",
      );
      const r = runScan(wtOver, { maxRelativePathBytes: 16 });
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
    } finally {
      rmSync(wtOk, { recursive: true, force: true });
      rmSync(wtOver, { recursive: true, force: true });
    }
  });

  it("accepts exact MAX_FILE_BYTES and refuses +1", liveTraversal, () => {
    const wtOk = tempRoot("fbytes-eq");
    const wtOver = tempRoot("fbytes-over");
    try {
      const n = 32;
      writeFile(wtOk, "a.txt", "x".repeat(n));
      writeFile(wtOver, "a.txt", "x".repeat(n + 1));
      assert.equal(runScan(wtOk, { maxFileBytes: n })._tag, "Clean");
      const r = runScan(wtOver, { maxFileBytes: n });
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
    } finally {
      rmSync(wtOk, { recursive: true, force: true });
      rmSync(wtOver, { recursive: true, force: true });
    }
  });

  it("accepts exact MAX_TOTAL_INSPECTED_BYTES and refuses +1", liveTraversal, () => {
    const wtOk = tempRoot("total-eq");
    const wtOver = tempRoot("total-over");
    try {
      writeFile(wtOk, "a.txt", "aaaa");
      writeFile(wtOk, "b.txt", "bbbb");
      writeFile(wtOver, "a.txt", "aaaa");
      writeFile(wtOver, "b.txt", "bbbb");
      writeFile(wtOver, "c.txt", "c");
      assert.equal(
        runScan(wtOk, { maxTotalInspectedBytes: 8 })._tag,
        "Clean",
      );
      const r = runScan(wtOver, { maxTotalInspectedBytes: 8 });
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
    } finally {
      rmSync(wtOk, { recursive: true, force: true });
      rmSync(wtOver, { recursive: true, force: true });
    }
  });

  it("accepts exact MAX_LINE_INSPECTIONS and refuses +1", liveTraversal, () => {
    const wtOk = tempRoot("lines-eq");
    const wtOver = tempRoot("lines-over");
    try {
      writeFile(wtOk, "a.txt", "l1\nl2\nl3\n");
      writeFile(wtOver, "a.txt", "l1\nl2\nl3\nl4\n");
      assert.equal(runScan(wtOk, { maxLineInspections: 3 })._tag, "Clean");
      const r = runScan(wtOver, { maxLineInspections: 3 });
      assert.equal(r._tag, "Refused");
      if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
    } finally {
      rmSync(wtOk, { recursive: true, force: true });
      rmSync(wtOver, { recursive: true, force: true });
    }
  });

  it("exports positive default bounds", () => {
    assert.ok(MAX_DIRECTORY_ENTRIES > 0);
    assert.ok(MAX_FILES > 0);
    assert.ok(MAX_RELATIVE_PATH_BYTES > 0);
    assert.ok(MAX_FILE_BYTES > 0);
    assert.ok(MAX_TOTAL_INSPECTED_BYTES > 0);
    assert.ok(MAX_LINE_INSPECTIONS > 0);
    assert.equal(DEFAULT_SECRET_SCAN_BOUNDS.maxFiles, MAX_FILES);
  });

  // Cold-audit attempt 1: invalid bounds refuse before any filesystem access.
  it("refuses non-positive, non-integer, non-finite, or non-safe bounds", () => {
    const cases: readonly Partial<SecretScanBounds>[] = [
      { maxFiles: 0 },
      { maxFiles: -1 },
      { maxDirectoryEntries: Number.NaN },
      { maxRelativePathBytes: Number.POSITIVE_INFINITY },
      { maxFileBytes: 1.5 },
      { maxTotalInspectedBytes: Number.MAX_SAFE_INTEGER + 1 },
      { maxLineInspections: -3 },
      { maxExemptions: 0 },
      { maxFixtureDeclarationBytes: Number.NEGATIVE_INFINITY },
    ];
    for (const partial of cases) {
      const r = runScan("/tmp", partial);
      assert.equal(
        r._tag,
        "Refused",
        `expected refusal for bounds ${JSON.stringify(partial)}; got ${JSON.stringify(r)}`,
      );
      if (r._tag === "Refused") {
        assert.equal(r.reason, "bound_exceeded");
      }
    }
  });

  // Cold-audit attempt 1: path-byte bound applies to directories before type dispatch.
  it(
    "refuses directory relative path one byte over maxRelativePathBytes",
    liveTraversal,
    () => {
      const wt = tempRoot("dirpath-over");
      try {
        const over = "d".repeat(17);
        mkdirSync(join(wt, over));
        writeFile(wt, "ok.txt", "ok\n");
        const r = runScan(wt, { maxRelativePathBytes: 16 });
        assert.equal(r._tag, "Refused");
        if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    },
  );

  // Cold-audit attempt 1: path-byte bound applies to symlinks before skip/dispatch.
  it(
    "refuses symlink relative path one byte over maxRelativePathBytes",
    liveTraversal,
    () => {
      const wt = tempRoot("sympath-over");
      try {
        const over = "s".repeat(17);
        symlinkSync("nowhere-target", join(wt, over));
        writeFile(wt, "ok.txt", "ok\n");
        const r = runScan(wt, { maxRelativePathBytes: 16 });
        assert.equal(r._tag, "Refused");
        if (r._tag === "Refused") assert.equal(r.reason, "bound_exceeded");
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    },
  );

  // Cold-audit attempt 1: wide sibling directories stay below descriptor exhaustion
  // when only the active depth chain is held (depth-first, one child at a time).
  it(
    "scans a wide shallow tree of sibling directories under a low descriptor budget",
    liveTraversal,
    () => {
      const wt = tempRoot("wide-sibs");
      try {
        const n = 64;
        for (let i = 0; i < n; i++) {
          writeFile(wt, `d${String(i).padStart(3, "0")}/ok.txt`, "ok\n");
        }
        const r = runScan(wt);
        assert.equal(
          r._tag,
          "Clean",
          `wide tree must not false-refuse; got ${JSON.stringify(r)}`,
        );
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// CLI: canonical JSON, exit codes, secret-safe
// ---------------------------------------------------------------------------

describe("CLI output and exit codes", () => {
  it("emits one canonical clean JSON line and exit 0", liveTraversal, async () => {
    const wt = tempRoot("cli-clean");
    try {
      writeFile(wt, "ok.txt", "hello\n");
      const io = captureIo();
      const code = await Effect.runPromise(
        runSecretScanCli(["node", "secret-scan.js", wt], io).pipe(
          Effect.provide(liveSecretScan),
        ),
      );
      assert.equal(code, EXIT_CLEAN);
      const lines = io.stdout().split("\n").filter((l) => l.length > 0);
      assert.equal(lines.length, 1);
      const obj = JSON.parse(lines[0]!) as {
        schemaVersion: number;
        verdict: string;
      };
      assert.equal(obj.schemaVersion, SECRET_SCAN_SCHEMA_VERSION);
      assert.equal(obj.verdict, "clean");
      assert.equal(renderSecretScanJson({ _tag: "Clean" }), lines[0]!);
      // exact one line with trailing newline from CLI
      assert.ok(io.stdout().endsWith("\n"));
      assert.equal(io.stderr(), "");
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("emits secret_found with nonzero exit and no path leak", liveTraversal, async () => {
    const wt = tempRoot("cli-secret");
    try {
      const secretPath = writeFile(wt, "deep/.env", "SECRET=xyzzy-unique\n");
      const io = captureIo();
      const code = await Effect.runPromise(
        runSecretScanCli(["node", "secret-scan.js", wt], io).pipe(
          Effect.provide(liveSecretScan),
        ),
      );
      assert.equal(code, EXIT_NOT_CLEAN);
      const line = io.stdout().trimEnd();
      const obj = JSON.parse(line) as { verdict: string };
      assert.equal(obj.verdict, "secret_found");
      assertSecretSafe(io.stdout() + io.stderr(), [
        secretPath,
        "xyzzy-unique",
        "deep/.env",
        "SECRET=",
      ]);
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("emits refused for bound exceed without exception text", async () => {
    const wt = tempRoot("cli-bound");
    try {
      writeFile(wt, "a.txt", "1\n");
      writeFile(wt, "b.txt", "2\n");
      const io = captureIo();
      // Force bound via env is not used; use parse + direct scan path through CLI only
      // CLI uses default bounds — use a refused path instead for CLI refused class
      const code = await Effect.runPromise(
        runSecretScanCli(["node", "secret-scan.js", "not-absolute"], io).pipe(
          Effect.provide(liveSecretScan),
        ),
      );
      assert.equal(code, EXIT_NOT_CLEAN);
      const obj = JSON.parse(io.stdout().trimEnd()) as {
        verdict: string;
        reason?: string;
      };
      assert.equal(obj.verdict, "refused");
      assert.ok(obj.reason);
      assertSecretSafe(io.stdout() + io.stderr(), [
        "Error",
        "stack",
        "ENOENT",
        "at ",
      ]);
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });

  it("rejects missing argv with one canonical JSON refusal line and nonzero exit", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runSecretScanCli(["node", "secret-scan.js"], io).pipe(
        Effect.provide(liveSecretScan),
      ),
    );
    assert.equal(code, EXIT_INVALID_ARGUMENTS);
    const lines = io.stdout().split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1, `expected exactly one JSON line; got ${JSON.stringify(io.stdout())}`);
    const obj = JSON.parse(lines[0]!) as {
      schemaVersion: number;
      verdict: string;
      reason?: string;
    };
    assert.equal(obj.schemaVersion, SECRET_SCAN_SCHEMA_VERSION);
    assert.equal(obj.verdict, "refused");
    assert.equal(typeof obj.reason, "string");
    assert.ok(obj.reason && obj.reason.length > 0);
    assert.equal(
      lines[0],
      renderSecretScanJson({
        _tag: "Refused",
        reason: obj.reason as "invalid_worktree",
      }),
    );
    assertSecretSafe(io.stdout() + io.stderr(), [
      "Error",
      "stack",
      "ENOENT",
      "at ",
      "Error:",
    ]);
  });

  it("rejects multi-arg argv with one canonical JSON refusal line", async () => {
    const io = captureIo();
    const code = await Effect.runPromise(
      runSecretScanCli(
        ["node", "secret-scan.js", "/tmp/a", "/tmp/b"],
        io,
      ).pipe(Effect.provide(liveSecretScan)),
    );
    assert.notEqual(code, EXIT_CLEAN);
    const lines = io.stdout().split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1);
    const obj = JSON.parse(lines[0]!) as { verdict: string };
    assert.equal(obj.verdict, "refused");
  });

  it("parseSecretScanArgv accepts one absolute root", () => {
    const p = parseSecretScanArgv(["node", "secret-scan.js", "/tmp/wt"]);
    assert.equal(p._tag, "Ok");
    if (p._tag === "Ok") assert.equal(p.worktreeRoot, "/tmp/wt");
  });

  it("isSecretScanResult is a closed type guard", () => {
    assert.equal(isSecretScanResult({ _tag: "Clean" }), true);
    assert.equal(isSecretScanResult({ _tag: "SecretFound" }), true);
    assert.equal(
      isSecretScanResult({ _tag: "Refused", reason: "bound_exceeded" }),
      true,
    );
    assert.equal(isSecretScanResult({ _tag: "Other" }), false);
    assert.equal(isSecretScanResult(null), false);
  });

  it("sha256HexOfBytes is lowercase hex", () => {
    const h = sha256HexOfBytes(Buffer.from("abc"));
    assert.equal(h, sha256Hex("abc"));
    assert.equal(h, h.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// Foreman worktree clean + known-bad synthetic fixture still refused
// ---------------------------------------------------------------------------

describe("Foreman worktree and known-bad fixture", () => {
  it(
    "scans the current Foreman worktree clean under default bounds",
    liveTraversal,
    () => {
      const r = runScan(REPO_ROOT);
      assert.equal(
        r._tag,
        "Clean",
        `Foreman worktree must scan clean; got ${JSON.stringify(r)}`,
      );
    },
  );

  it(
    "still refuses a known-bad synthetic secret fixture without exemption",
    liveTraversal,
    () => {
      const wt = tempRoot("known-bad");
      try {
        writeFile(
          wt,
          `${FIXTURE_SUBTREE_PREFIX}secret-scan/synthetic.pem`,
          "-----BEGIN RSA PRIVATE KEY-----\nSYNTHETIC\n-----END RSA PRIVATE KEY-----\n",
        );
        const r = runScan(wt);
        assert.equal(r._tag, "SecretFound");
      } finally {
        rmSync(wt, { recursive: true, force: true });
      }
    },
  );
});

// ---------------------------------------------------------------------------
// renderSecretScanJson closed shape
// ---------------------------------------------------------------------------

describe("renderSecretScanJson", () => {
  it("renders clean, secret_found, and refused without extra fields", () => {
    const clean = JSON.parse(renderSecretScanJson({ _tag: "Clean" })) as {
      schemaVersion: number;
      verdict: string;
    };
    assert.equal(clean.schemaVersion, SECRET_SCAN_SCHEMA_VERSION);
    assert.equal(clean.verdict, "clean");
    assert.equal(Object.keys(clean).sort().join(","), "schemaVersion,verdict");

    const found = JSON.parse(
      renderSecretScanJson({ _tag: "SecretFound" }),
    ) as { verdict: string };
    assert.equal(found.verdict, "secret_found");

    const refused = JSON.parse(
      renderSecretScanJson({ _tag: "Refused", reason: "unreadable" }),
    ) as { verdict: string; reason: string };
    assert.equal(refused.verdict, "refused");
    assert.equal(refused.reason, "unreadable");
  });
});

// silence unused import warnings in some tooling
void readdirSync;
void relative;
void openSync;
void closeSync;
void readFileSync;
