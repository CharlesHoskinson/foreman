/**
 * Production SessionStore backend boundary.
 *
 * Outside packages/session-store/src/, non-test TypeScript must not import
 * node:sqlite or name the concrete backend constructors/factories. Tests may
 * use an explicit allowlist when they construct states the port refuses.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const CONCRETE_BACKEND_PATTERN =
  /\b(SqliteSessionStore|FilesOnlySessionStore|openFilesOnlyStore|openMemoryStore)\b/;
/** Forbidden literal anywhere in source, including dynamic/multiline/re-export forms. */
const NODE_SQLITE_LITERAL = "node:sqlite";

/**
 * Test-only exceptions outside session-store, each with a standing reason.
 * Production sources must never appear here.
 */
const TEST_ALLOWLIST: Readonly<Record<string, string>> = {
  "packages/orchestration/src/fm-session-main.test.ts":
    "Constructs legacy, hybrid, corrupt-watermark, foreign-schema, lock, and injected-failure states the port refuses to create.",
  "scripts/backend-boundary.test.ts":
    "Owns the production/test boundary scan and its synthetic negative controls.",
};

type BoundaryHit = {
  readonly path: string;
  readonly kind: "node:sqlite" | "concrete-backend";
  readonly line: number;
  readonly text: string;
};

function gitLsFiles(patterns: readonly string[]): string[] {
  const result = spawnSync("git", ["ls-files", "--", ...patterns], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `git ls-files failed (status ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isDistPath(path: string): boolean {
  const parts = path.split(/[\\/]/);
  return parts.includes("dist");
}

function isTestPath(path: string): boolean {
  return (
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx") ||
    path.includes(`${sep}__tests__${sep}`) ||
    path.includes("/__tests__/")
  );
}

function isSessionStoreSrc(path: string): boolean {
  return (
    path === "packages/session-store/src" ||
    path.startsWith(`packages/session-store/src/`)
  );
}

function scanSource(path: string, source: string): BoundaryHit[] {
  const hits: BoundaryHit[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    // Full-source literal scan: dynamic import, re-export, and multiline
    // static import all carry node:sqlite somewhere even when not on a
    // single-line from/require pattern.
    if (text.includes(NODE_SQLITE_LITERAL)) {
      hits.push({ path, kind: "node:sqlite", line: i + 1, text: text.trim() });
    }
    if (CONCRETE_BACKEND_PATTERN.test(text)) {
      hits.push({
        path,
        kind: "concrete-backend",
        line: i + 1,
        text: text.trim(),
      });
    }
  }
  return hits;
}

function productionOffenders(trackedTs: readonly string[]): BoundaryHit[] {
  const offenders: BoundaryHit[] = [];
  for (const path of trackedTs) {
    if (isDistPath(path)) continue;
    if (isSessionStoreSrc(path)) continue;
    if (isTestPath(path)) continue;
    const abs = join(REPO_ROOT, path);
    if (!existsSync(abs)) continue;
    offenders.push(...scanSource(path, readFileSync(abs, "utf8")));
  }
  return offenders;
}

function testOffendersOutsideAllowlist(trackedTs: readonly string[]): BoundaryHit[] {
  const offenders: BoundaryHit[] = [];
  for (const path of trackedTs) {
    if (isDistPath(path)) continue;
    if (isSessionStoreSrc(path)) continue;
    if (!isTestPath(path)) continue;
    if (Object.prototype.hasOwnProperty.call(TEST_ALLOWLIST, path)) continue;
    const abs = join(REPO_ROOT, path);
    if (!existsSync(abs)) continue;
    offenders.push(...scanSource(path, readFileSync(abs, "utf8")));
  }
  return offenders;
}

function formatHits(hits: readonly BoundaryHit[]): string {
  return hits
    .map((h) => `${h.path}:${h.line}: ${h.kind}: ${h.text}`)
    .join("\n");
}

describe("SessionStore backend boundary", () => {
  it("forbids production node:sqlite and concrete backend imports outside session-store", () => {
    const tracked = gitLsFiles(["*.ts", "*.tsx"]);
    assert.ok(tracked.length > 0, "git ls-files returned no TypeScript paths");
    const offenders = productionOffenders(tracked);
    assert.equal(
      offenders.length,
      0,
      `production boundary offenders:\n${formatHits(offenders)}`,
    );
  });

  it("allows only the reasoned test allowlist outside session-store", () => {
    const tracked = gitLsFiles(["*.ts", "*.tsx"]);
    const offenders = testOffendersOutsideAllowlist(tracked);
    assert.equal(
      offenders.length,
      0,
      `test boundary offenders outside allowlist:\n${formatHits(offenders)}`,
    );

    for (const [path, reason] of Object.entries(TEST_ALLOWLIST)) {
      assert.ok(reason.trim().length > 0, `${path} allowlist reason must be non-empty`);
      assert.ok(
        tracked.includes(path) || existsSync(join(REPO_ROOT, path)),
        `allowlisted path missing: ${path}`,
      );
      const hits = scanSource(path, readFileSync(join(REPO_ROOT, path), "utf8"));
      assert.ok(
        hits.length > 0,
        `${path} is allowlisted but no longer hits the boundary predicates`,
      );
    }
  });

  it("negative control: reports a synthetic raw node:sqlite import", () => {
    const dir = mkdtempSync(join(tmpdir(), "boundary-neg-sqlite-"));
    try {
      const rel = join("packages", "orchestration", "src", "synthetic-boundary.ts");
      const abs = join(dir, rel);
      // Build the forbidden import without leaving a scannable literal on this line.
      const mod = ["node", "sqlite"].join(":");
      const source = `import { DatabaseSync } from "${mod}";\nexport const x = DatabaseSync;\n`;
      writeFileSync(join(dir, "probe.ts"), source);
      const hits = scanSource(rel, source);
      assert.ok(
        hits.some((h) => h.kind === "node:sqlite"),
        `expected node:sqlite hit, got: ${formatHits(hits)}`,
      );
      assert.equal(existsSync(abs), false, "synthetic probe must not land in the repo");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("negative control: reports dynamic, re-export, and multiline node:sqlite forms", () => {
    const mod = ["node", "sqlite"].join(":");
    const cases: ReadonlyArray<{ label: string; source: string }> = [
      {
        label: "dynamic import",
        source: `export async function load() {\n  return await import("${mod}");\n}\n`,
      },
      {
        label: "re-export",
        source: `export { DatabaseSync } from "${mod}";\n`,
      },
      {
        label: "multiline static import",
        source: `import {\n  DatabaseSync,\n} from "${mod}";\nexport const x = DatabaseSync;\n`,
      },
    ];
    for (const c of cases) {
      const hits = scanSource(
        `packages/orchestration/src/synthetic-${c.label.replace(/\s+/g, "-")}.ts`,
        c.source,
      );
      assert.ok(
        hits.some((h) => h.kind === "node:sqlite"),
        `${c.label}: expected node:sqlite hit, got: ${formatHits(hits)}`,
      );
    }
  });

  it("negative control: reports a synthetic concrete-backend import", () => {
    const concrete = ["Sqlite", "Session", "Store"].join("");
    const source =
      `import { ${concrete} } from "@foreman/session-store";\n` +
      `export const open = ${concrete}.open;\n`;
    const hits = scanSource(
      "packages/orchestration/src/synthetic-concrete.ts",
      source,
    );
    assert.ok(
      hits.some((h) => h.kind === "concrete-backend"),
      `expected concrete-backend hit, got: ${formatHits(hits)}`,
    );
  });

  it("accepts a source that imports only openSessionStore", () => {
    const source =
      'import { openSessionStore } from "@foreman/session-store";\n' +
      "export const open = openSessionStore;\n";
    const hits = scanSource(
      "packages/orchestration/src/synthetic-factory-only.ts",
      source,
    );
    assert.deepEqual(hits, []);
  });
});
