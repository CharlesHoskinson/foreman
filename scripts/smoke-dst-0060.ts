import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { extractRegister } from "../packages/policy/src/register.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = join(
  root,
  "skills/foreman/runtime/dist/destruction-guard.js",
);
const registerPath = join(root, "docs/releases/v0.3.0-destruction-log.md");

function fail(msg: string): never {
  process.stderr.write(msg + "\n");
  process.exit(1);
}

// Pure worktree check: DST-0060 must remain blocked in the register document
const worktreeBytes = new Uint8Array(readFileSync(registerPath));
const extracted = extractRegister(worktreeBytes);
if ("_tag" in extracted) {
  fail("worktree register extract failed: " + extracted.reason);
}
const e60 = extracted.register.currentEntries.find((e) => e.id === "DST-0060");
if (!e60 || e60.state !== "blocked") {
  fail("worktree DST-0060 is not blocked");
}
if (e60.actionKind === "artifact_relocate") {
  if (e60.artifactRelocate?.byteLength !== 5359) {
    fail("DST-0060 byteLength drift");
  }
  if (
    e60.artifactRelocate?.sha256 !==
    "90b74c67fcafccb4c04b1402ba6b275e6809debd4aa096efdc7b23b7c97275db"
  ) {
    fail("DST-0060 sha256 drift");
  }
}

const request = '{"entryId":"DST-0060","schemaVersion":1}';
const run = spawnSync(
  process.execPath,
  [bundlePath, "check", "--repo-root", root],
  {
    cwd: root,
    encoding: "utf8",
    input: request,
  },
);

const line = (run.stdout || "").trim();
if (run.status === 0 || line.includes("Authorized") || line.includes("Completed")) {
  fail("smoke DST-0060: must never Authorized/Completed: " + line);
}

let parsed: { _tag?: string; reason?: string; entryId?: string };
try {
  parsed = JSON.parse(line) as typeof parsed;
} catch {
  fail("smoke DST-0060: non-JSON stdout: " + line);
}

// Clean committed authority → Denied state_blocked
// Dirty worktree/index vs HEAD → Failed authority_dirty (fail closed; still no auth)
if (parsed._tag === "Denied" && parsed.reason === "state_blocked") {
  if (parsed.entryId !== "DST-0060") fail("entryId mismatch");
  if (line.includes("/home") || line.includes("Error:")) {
    fail("output secrecy violation");
  }
  process.stdout.write("smoke:dst-0060 ok Denied state_blocked\n");
  process.exit(0);
}

if (parsed._tag === "Failed" && parsed.reason === "authority_dirty") {
  // Uncommitted register edits correctly refuse production authority.
  process.stdout.write(
    "smoke:dst-0060 ok Failed authority_dirty (worktree DST-0060 remains blocked)\n",
  );
  process.exit(0);
}

fail(
  "smoke DST-0060: expected Denied state_blocked or Failed authority_dirty, got " +
    line +
    " exit=" +
    String(run.status),
);
