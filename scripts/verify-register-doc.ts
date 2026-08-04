/**
 * Read-only verifier: parse the canonical destruction log, ensure one sentinel
 * JSON block, round-trip extract, and reject parallel projections.
 * Does not embed or rewrite register facts.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRegister } from "../packages/policy/src/register.js";
import { CANONICAL_REGISTER_ID } from "../packages/policy/src/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const path = join(root, "docs/releases/v0.3.0-destruction-log.md");

const bytes = new Uint8Array(readFileSync(path));
const result = extractRegister(bytes);
if ("_tag" in result) {
  process.stderr.write(
    "verify-register-doc: extract failed " + result.reason + "\n",
  );
  process.exit(1);
}
if (result.register.registerId !== CANONICAL_REGISTER_ID) {
  process.stderr.write("verify-register-doc: register id mismatch\n");
  process.exit(1);
}
const dst60 = result.register.currentEntries.find((e) => e.id === "DST-0060");
if (!dst60 || dst60.state !== "blocked") {
  process.stderr.write("verify-register-doc: DST-0060 not blocked\n");
  process.exit(1);
}
const text = new TextDecoder().decode(bytes);
if (text.includes("| Target or action |") || text.includes("Human projection")) {
  process.stderr.write("verify-register-doc: projection table still present\n");
  process.exit(1);
}
process.stdout.write(
  "verify-register-doc: ok entries=" +
    result.register.currentEntries.length +
    " sha256=" +
    result.registerSha256 +
    "\n",
);
