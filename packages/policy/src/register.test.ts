import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canonicalize, sha256Hex } from "@foreman/core";
import {
  BEGIN_SENTINEL,
  END_SENTINEL,
  extractRegister,
  isExtractFailure,
} from "./register.js";
import { CANONICAL_REGISTER_ID, type Register } from "./schema.js";

function wrapRegister(reg: Register, extraLines: string[] = []): Uint8Array {
  const json = canonicalize(reg);
  const md = [
    "# title",
    BEGIN_SENTINEL,
    json,
    END_SENTINEL,
    ...extraLines,
    "",
  ].join("\n");
  return new TextEncoder().encode(md);
}

function minimalRegister(overrides?: Partial<Register>): Register {
  return {
    schemaVersion: 1,
    registerId: CANONICAL_REGISTER_ID,
    currentEntries: [
      {
        id: "DST-0060",
        targetOrAction: "spec file",
        state: "blocked",
        requiredCondition: "guard",
        owner: "Sprint 0 architect",
        evidence: "bytes",
        recordedAt: "2026-08-04T00:00:41-06:00",
        recoveryStatus: "external_path_pending_guard",
        actionKind: "artifact_relocate",
        artifactRelocate: {
          byteLength: 5359,
          recoveryPath: "/recovery/path",
          sha256:
            "90b74c67fcafccb4c04b1402ba6b275e6809debd4aa096efdc7b23b7c97275db",
          sourcePath: "/source/path",
        },
      },
    ],
    historicalIncidents: [],
    ...overrides,
  };
}

function assertFailed(
  result: ReturnType<typeof extractRegister>,
  reason?: string,
): void {
  assert.ok(isExtractFailure(result));
  if (reason !== undefined) assert.equal(result.reason, reason);
}

describe("extractRegister", () => {
  it("extracts canonical register", () => {
    const reg = minimalRegister();
    const result = extractRegister(wrapRegister(reg));
    assert.ok(!isExtractFailure(result));
    assert.equal(result.register.registerId, CANONICAL_REGISTER_ID);
    assert.equal(result.registerSha256, sha256Hex(result.canonicalJson));
  });

  it("rejects wrong register id", () => {
    const reg = minimalRegister({ registerId: "wrong" });
    assertFailed(extractRegister(wrapRegister(reg)), "register_id_mismatch");
  });

  it("rejects parallel projection table, fences, JSON, YAML", () => {
    const reg = minimalRegister();
    assertFailed(
      extractRegister(
        wrapRegister(reg, [
          "| ID | Target or action | State |",
          "|---|---|---|",
          "| `DST-0060` | x | blocked |",
        ]),
      ),
      "duplicate_register_projection",
    );
    assertFailed(
      extractRegister(
        wrapRegister(reg, ["```json", '{"schemaVersion":1}', "```"]),
      ),
      "duplicate_register_projection",
    );
    assertFailed(
      extractRegister(wrapRegister(reg, ['{"schemaVersion":1,"x":true}'])),
      "duplicate_register_projection",
    );
    assertFailed(
      extractRegister(
        wrapRegister(reg, [
          "{",
          '  "schemaVersion": 1,',
          '  "currentEntries": []',
          "}",
        ]),
      ),
      "duplicate_register_projection",
    );
    assertFailed(
      extractRegister(
        wrapRegister(reg, ["schemaVersion: 1", "registerId: other"]),
      ),
      "duplicate_register_projection",
    );
    // Ordinary prose remains accepted
    const ok = extractRegister(
      wrapRegister(reg, [
        "This paragraph explains recovery rules without structured keys.",
      ]),
    );
    assert.ok(!isExtractFailure(ok));
  });

  it("rejects missing/duplicate sentinels, empty, duplicate keys, non-canonical", () => {
    const json = canonicalize(minimalRegister());
    assertFailed(
      extractRegister(new TextEncoder().encode(json + "\n" + END_SENTINEL)),
      "missing_begin_sentinel",
    );
    assertFailed(
      extractRegister(new TextEncoder().encode(BEGIN_SENTINEL + "\n" + json)),
      "missing_end_sentinel",
    );
    assertFailed(
      extractRegister(
        new TextEncoder().encode(
          [BEGIN_SENTINEL, BEGIN_SENTINEL, json, END_SENTINEL].join("\n"),
        ),
      ),
      "duplicate_begin_sentinel",
    );
    assertFailed(
      extractRegister(
        new TextEncoder().encode([BEGIN_SENTINEL, END_SENTINEL].join("\n")),
      ),
      "empty_register",
    );
    assertFailed(
      extractRegister(
        new TextEncoder().encode(
          [
            BEGIN_SENTINEL,
            '{"schemaVersion":1,"schemaVersion":1,"registerId":"foreman-v0.3.0-destruction-register","currentEntries":[],"historicalIncidents":[]}',
            END_SENTINEL,
          ].join("\n"),
        ),
      ),
      "duplicate_json_key",
    );
  });

  it("rejects malformed UTF-8 and oversize", () => {
    assertFailed(extractRegister(new Uint8Array([0xc3, 0x28])), "malformed_utf8");
    const big = new Uint8Array(1_048_576 + 1);
    big.fill(0x41);
    assertFailed(extractRegister(big), "oversize_input");
  });

  it("rejects unknown fields and duplicate ids", () => {
    const json =
      '{"currentEntries":[],"extra":true,"historicalIncidents":[],"registerId":"foreman-v0.3.0-destruction-register","schemaVersion":1}';
    assertFailed(
      extractRegister(
        new TextEncoder().encode([BEGIN_SENTINEL, json, END_SENTINEL].join("\n")),
      ),
      "unknown_field",
    );

    const reg = minimalRegister({
      historicalIncidents: [
        {
          id: "DST-0060",
          targetOrAction: "same",
          state: "late_register_replaced_recoverable",
          requiredCondition: "n/a",
          owner: "architect",
          evidence: "hist",
          recordedAt: "2026-01-01T00:00:00Z",
        },
      ],
    });
    assertFailed(extractRegister(wrapRegister(reg)), "duplicate_id");
  });
});
