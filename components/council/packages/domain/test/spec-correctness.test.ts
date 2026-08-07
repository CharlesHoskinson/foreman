import { createHash } from "node:crypto";
import type { Sha256Digest } from "@council/schema";
import { decodeStrictSync } from "@council/schema";
import type {
  InventedCompletionV1,
  SpecCorrectnessItemResultV1,
  SpecCorrectnessProviderResponseV1,
} from "@council/schema/spec-correctness";
import {
  SpecCorrectnessProviderResponseV1 as ResponseSchema,
  portableEncodeUtf8,
  portableSha256Hex,
} from "@council/schema/spec-correctness";
import { describe, expect, it } from "vitest";
import {
  evaluateSpecCorrectnessV1,
  parseCoverageMatrixBaselineIds,
} from "@council/domain/spec-correctness";
import * as DomainRoot from "@council/domain";
import * as SchemaRoot from "@council/schema";

const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const sha256Hex = (bytes: Uint8Array): Sha256Digest =>
  createHash("sha256").update(bytes).digest("hex") as Sha256Digest;

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

/** Type-safe fixture index access; fails the test if the entry is missing. */
const requireEntry = <T>(
  items: readonly T[],
  index: number,
  label: string,
): T => {
  const value = items[index];
  if (value === undefined) {
    throw new Error(`missing fixture ${label} at ${String(index)}`);
  }
  return value;
};

const BASELINE_IDS: readonly string[] = [
  ...Array.from(
    { length: 37 },
    (_, index) => `CW-${String(index + 1).padStart(3, "0")}`,
  ),
  ...Array.from(
    { length: 7 },
    (_, index) => `RT-${String(index + 1).padStart(3, "0")}`,
  ),
];

const buildMatrix = (ids: readonly string[]): string => {
  const header =
    "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|\n";
  const rows = ids
    .map(
      (id) =>
        `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
    )
    .join("\n");
  return `${header}${rows}\n`;
};

const makeMapped = (itemId: string): SpecCorrectnessItemResultV1 => ({
  schemaVersion: 1,
  itemId,
  disposition: "mapped",
  sprint: "0",
  requirement: `requirement for ${itemId}`,
  acceptanceEvidence: `evidence for ${itemId}`,
  status: "open",
});

const makeDefer = (itemId: string): SpecCorrectnessItemResultV1 => ({
  schemaVersion: 1,
  itemId,
  disposition: "evidenced_defer",
  reason: "blocked on dependency",
  owner: "release-owner",
  targetRelease: "v0.3.1",
  blockingDependency: "dep-a",
  acceptanceEvidence: "defer-evidence",
});

const makeDefect = (
  itemId: string,
  disposition: "omitted" | "contradiction" | "unevidenced_defer",
): SpecCorrectnessItemResultV1 => ({
  schemaVersion: 1,
  itemId,
  disposition,
  assessment: `assessment for ${itemId}`,
});

const decodeResponse = (value: unknown): SpecCorrectnessProviderResponseV1 =>
  decodeStrictSync(ResponseSchema, value);

const allMappedItems = (): SpecCorrectnessItemResultV1[] =>
  BASELINE_IDS.map((id) => makeMapped(id));

const acceptBody = (
  itemResults: readonly SpecCorrectnessItemResultV1[],
  inventedCompletions: readonly InventedCompletionV1[] = [],
) =>
  decodeResponse({
    schemaVersion: 1,
    outcome: "accept",
    itemResults,
    inventedCompletions,
    findings: [],
    summary: "coverage complete",
  });

const changesBody = (
  itemResults: readonly SpecCorrectnessItemResultV1[],
  inventedCompletions: readonly InventedCompletionV1[] = [],
) =>
  decodeResponse({
    schemaVersion: 1,
    outcome: "changes_requested",
    itemResults,
    inventedCompletions,
    findings: [
      {
        location: "candidate",
        summary: "defect found",
        nextAction: "repair",
      },
    ],
    summary: "coverage incomplete",
  });

const changesBodyNoFindings = (
  itemResults: readonly SpecCorrectnessItemResultV1[],
  inventedCompletions: readonly InventedCompletionV1[] = [],
) =>
  decodeResponse({
    schemaVersion: 1,
    outcome: "changes_requested",
    itemResults,
    inventedCompletions,
    findings: [],
    summary: "coverage incomplete",
  });

const evaluate = (
  matrixText: string,
  response: unknown,
  artifacts: readonly {
    readonly alias: string;
    readonly sha256: Sha256Digest;
    readonly bytes: Uint8Array;
  }[] = [],
  primitives: {
    readonly sha256: (bytes: Uint8Array) => Sha256Digest;
    readonly decodeUtf8: (bytes: Uint8Array) => string | null;
  } = { sha256: sha256Hex, decodeUtf8 },
) =>
  evaluateSpecCorrectnessV1({
    coverageMatrixBytes: encodeUtf8(matrixText),
    response,
    evidenceArtifacts: artifacts,
    sha256: primitives.sha256,
    decodeUtf8: primitives.decodeUtf8,
  });

const recordDigest = (
  artifactSha256: string,
  startByte: number,
  endByte: number,
  slice: Uint8Array,
): Sha256Digest => {
  const prefix = encodeUtf8(
    `${artifactSha256}\u0000${String(startByte)}\u0000${String(endByte)}\u0000`,
  );
  const payload = new Uint8Array(prefix.length + slice.length);
  payload.set(prefix, 0);
  payload.set(slice, prefix.length);
  return sha256Hex(payload);
};

const wholeLineInvention = (
  alias: string,
  artifactBytes: Uint8Array,
  lineText: string,
  options: {
    readonly startByte?: number;
    readonly endByte?: number;
  } = {},
): InventedCompletionV1 => {
  const artifactSha256 = sha256Hex(artifactBytes);
  // Encode and compare the supplied lineText exactly. Do not add a line-feed.
  const lineBytes = portableEncodeUtf8(lineText);
  const startByte = options.startByte ?? 0;
  let endByte = options.endByte;
  if (endByte === undefined) {
    // Default range is the whole line at startByte through LF or EOF.
    let cursor = startByte;
    while (cursor < artifactBytes.length && artifactBytes[cursor] !== 0x0a) {
      cursor += 1;
    }
    if (cursor < artifactBytes.length) {
      cursor += 1;
    }
    endByte = cursor;
  }
  const slice = artifactBytes.slice(startByte, endByte);
  // Compare selected artifact slice with portable UTF-8 bytes of claimed text.
  // Do not compare a slice with another copy of itself.
  expect(Array.from(slice)).toEqual(Array.from(lineBytes));
  return {
    schemaVersion: 1,
    artifactAlias: alias,
    artifactSha256,
    startByte,
    endByte,
    claimSha256: sha256Hex(slice),
    recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
    summary: "invented completion on selected whole-line range",
    correctiveAction: "delete the invented line",
  };
};

describe("evaluateSpecCorrectnessV1 known-good paths", () => {
  it("accepts when every baseline item is mapped", () => {
    const matrix = buildMatrix(BASELINE_IDS);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
      expect(result.metrics.mappedItemCount).toBe(44);
      expect(result.metrics.evidencedDeferCount).toBe(0);
      expect(result.metrics.omittedItemCount).toBe(0);
      expect(result.metrics.contradictionCount).toBe(0);
      expect(result.metrics.unevidencedDeferCount).toBe(0);
      expect(result.metrics.inventedCompletionCount).toBe(0);
      expect(result.metrics.coverageRatio).toEqual({
        numerator: 44,
        denominator: 44,
      });
    }
  });

  it("accepts mapped items plus one complete evidenced defer", () => {
    const items = allMappedItems();
    items[0] = makeDefer("CW-001");
    const result = evaluate(buildMatrix(BASELINE_IDS), acceptBody(items));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
      expect(result.metrics.mappedItemCount).toBe(43);
      expect(result.metrics.evidencedDeferCount).toBe(1);
      expect(result.metrics.coverageRatio).toEqual({
        numerator: 44,
        denominator: 44,
      });
    }
  });

  it("requests changes for one contradiction", () => {
    const items = allMappedItems();
    items[1] = makeDefect("CW-002", "contradiction");
    const result = evaluate(buildMatrix(BASELINE_IDS), changesBody(items));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("changes_requested");
      expect(result.metrics.contradictionCount).toBe(1);
      expect(result.metrics.mappedItemCount).toBe(43);
    }
  });

  it("preserves a named abstention", () => {
    const response = decodeResponse({
      schemaVersion: 1,
      outcome: "abstain",
      itemResults: allMappedItems(),
      inventedCompletions: [],
      findings: [],
      summary: "evidence gap blocks review",
      evidenceGaps: [
        {
          evidenceRef: "coverage-matrix.md",
          unmetCondition: "matrix digest does not match bound identity",
        },
      ],
      nextAction: "rebind the matrix and re-run",
    });
    const result = evaluate(buildMatrix(BASELINE_IDS), response);
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("abstain");
    }
  });

  it("evaluator abstention result preserves the exact named gaps and next action", () => {
    const gaps = [
      {
        evidenceRef: "coverage-matrix.md",
        unmetCondition: "matrix digest does not match bound identity",
      },
      {
        evidenceRef: "ledger",
        unmetCondition: "ledger artifact is absent",
      },
    ] as const;
    const nextAction = "rebind the matrix and re-run";
    const response = {
      schemaVersion: 1,
      outcome: "abstain",
      itemResults: allMappedItems(),
      inventedCompletions: [],
      findings: [],
      summary: "evidence gap blocks review",
      evidenceGaps: gaps,
      nextAction,
    };
    const result = evaluate(buildMatrix(BASELINE_IDS), response);
    expect(result).toMatchObject({
      _tag: "Valid",
      outcome: "abstain",
      evidenceGaps: gaps,
      nextAction,
    });
  });

  it("requests changes for one valid whole-line invention", () => {
    const artifactText = "invented completion line\nsecond line\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "candidate-spec";
    const invention = wholeLineInvention(
      alias,
      artifactBytes,
      "invented completion line\n",
    );
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [
        {
          alias,
          sha256: sha256Hex(artifactBytes),
          bytes: artifactBytes,
        },
      ],
    );
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("changes_requested");
      expect(result.metrics.inventedCompletionCount).toBe(1);
      expect(result.metrics.mappedItemCount).toBe(44);
    }
  });

  it("changes with findings and otherwise complete coverage yields changes", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems()),
    );
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid" && result.outcome === "changes_requested") {
      expect(result.metrics.mappedItemCount).toBe(44);
      expect(result.metrics.omittedItemCount).toBe(0);
      expect(result.metrics.inventedCompletionCount).toBe(0);
      expect(result.findings).toHaveLength(1);
      expect(result.findings[0]?.summary).toBe("defect found");
    }
  });
});

describe("evaluateSpecCorrectnessV1 known-bad paths", () => {
  it("rejects a matrix with 43 baseline IDs", () => {
    const ids = BASELINE_IDS.slice(0, 43);
    const result = evaluate(buildMatrix(ids), acceptBody(ids.map(makeMapped)));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects a duplicate matrix ID", () => {
    const ids = [...BASELINE_IDS.slice(0, 43), "CW-001"];
    const result = evaluate(buildMatrix(ids), acceptBody(allMappedItems()));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "duplicate_matrix_id",
    });
  });

  it("rejects a duplicate result ID", () => {
    const items = allMappedItems();
    items[1] = makeMapped("CW-001");
    const result = evaluate(buildMatrix(BASELINE_IDS), acceptBody(items));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "duplicate_item_result_id",
    });
  });

  it("rejects wrong result order", () => {
    const items = allMappedItems();
    const first = requireEntry(items, 0, "item result");
    const second = requireEntry(items, 1, "item result");
    items[0] = second;
    items[1] = first;
    const result = evaluate(buildMatrix(BASELINE_IDS), acceptBody(items));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "item_result_order_mismatch",
    });
  });

  it("rejects an unknown result ID", () => {
    const items = allMappedItems();
    items[0] = makeMapped("CW-999");
    const result = evaluate(buildMatrix(BASELINE_IDS), acceptBody(items));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "unknown_item_result_id",
    });
  });

  it("rejects duplicate artifact aliases", () => {
    const bytes = encodeUtf8("alpha\n");
    const digest = sha256Hex(bytes);
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      acceptBody(allMappedItems()),
      [
        { alias: "a", sha256: digest, bytes },
        { alias: "a", sha256: digest, bytes },
      ],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "duplicate_artifact_alias",
    });
  });

  it("rejects a wrong artifact digest", () => {
    const bytes = encodeUtf8("alpha\n");
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      acceptBody(allMappedItems()),
      [
        {
          alias: "a",
          sha256: "0".repeat(64) as Sha256Digest,
          bytes,
        },
      ],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "artifact_digest_mismatch",
    });
  });

  it("rejects an unknown invention artifact", () => {
    const artifactText = "line one\n";
    const artifactBytes = encodeUtf8(artifactText);
    const invention = wholeLineInvention(
      "missing-alias",
      artifactBytes,
      "line one\n",
    );
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "unknown_invention_artifact",
    });
  });

  it("rejects a misaligned invention start", () => {
    const artifactText = "abc\ndef\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 1;
    const endByte = 4;
    const slice = artifactBytes.slice(startByte, endByte);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "misaligned start",
      correctiveAction: "fix range",
    } as InventedCompletionV1;
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "invention_start_misaligned",
    });
  });

  it("rejects a misaligned invention end", () => {
    const artifactText = "abc\ndef\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 0;
    const endByte = 2;
    const slice = artifactBytes.slice(startByte, endByte);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "misaligned end",
      correctiveAction: "fix range",
    } as InventedCompletionV1;
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "invention_end_misaligned",
    });
  });

  it("rejects an invalid UTF-8 invention slice", () => {
    const artifactBytes = new Uint8Array([0x61, 0xff, 0x0a]);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 0;
    const endByte = 3;
    const slice = artifactBytes.slice(startByte, endByte);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "invalid utf8",
      correctiveAction: "fix bytes",
    } as InventedCompletionV1;
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "invention_slice_invalid_utf8",
    });
  });

  it("rejects a wrong claim digest", () => {
    const artifactText = "line one\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 0;
    const endByte = artifactBytes.length;
    const slice = artifactBytes.slice(startByte, endByte);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: "1".repeat(64) as Sha256Digest,
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "wrong claim",
      correctiveAction: "fix claim digest",
    } as InventedCompletionV1;
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "invention_claim_digest_mismatch",
    });
  });

  it("rejects a wrong record digest", () => {
    const artifactText = "line one\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 0;
    const endByte = artifactBytes.length;
    const slice = artifactBytes.slice(startByte, endByte);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: "2".repeat(64) as Sha256Digest,
      summary: "wrong record",
      correctiveAction: "fix record digest",
    } as InventedCompletionV1;
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [invention]),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "invention_record_digest_mismatch",
    });
  });

  it("rejects duplicate invention digests", () => {
    const artifactText = "line one\nline two\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const first = wholeLineInvention(alias, artifactBytes, "line one\n");
    const duplicate = { ...first };
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [first, duplicate]),
      [{ alias, sha256: sha256Hex(artifactBytes), bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "duplicate_invention_digest",
    });
  });

  it("rejects unsorted invention records", () => {
    const artifactText = "aaaa\nbbbb\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const makeAt = (start: number, end: number): InventedCompletionV1 => {
      const slice = artifactBytes.slice(start, end);
      return {
        schemaVersion: 1,
        artifactAlias: alias,
        artifactSha256,
        startByte: start,
        endByte: end,
        claimSha256: sha256Hex(slice),
        recordSha256: recordDigest(artifactSha256, start, end, slice),
        summary: `range ${String(start)}-${String(end)}`,
        correctiveAction: "repair",
      };
    };
    const firstLine = makeAt(0, 5);
    const secondLine = makeAt(5, 10);
    const ordered = [firstLine, secondLine].sort((left, right) =>
      left.recordSha256 < right.recordSha256
        ? -1
        : left.recordSha256 > right.recordSha256
          ? 1
          : 0,
    );
    const lower = requireEntry(ordered, 0, "ordered invention");
    const higher = requireEntry(ordered, 1, "ordered invention");
    const unsorted = [higher, lower];
    expect(higher.recordSha256).not.toBe(lower.recordSha256);
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), unsorted),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "invention_records_unsorted",
    });
  });

  it("rejects declared accept when a defect is present", () => {
    const items = allMappedItems();
    items[0] = makeDefect("CW-001", "omitted");
    const result = evaluate(buildMatrix(BASELINE_IDS), acceptBody(items));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "declared_accept_with_defect",
    });
  });

  it("rejects declared changes when no defect is present", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBodyNoFindings(allMappedItems()),
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "declared_changes_without_defect",
    });
  });

  it("rejects accept with nonempty actionable findings", () => {
    const response = {
      schemaVersion: 1,
      outcome: "accept",
      itemResults: allMappedItems(),
      inventedCompletions: [],
      findings: [
        {
          location: "candidate",
          summary: "actionable dissent remains",
          nextAction: "resolve the finding",
        },
      ],
      summary: "should not accept with findings",
    };
    const result = evaluate(buildMatrix(BASELINE_IDS), response);
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "declared_accept_with_findings",
    });
  });

  it("rejects replacement CW-038 for CW-037 even with 44 unique rows", () => {
    const ids = [
      ...BASELINE_IDS.slice(0, 36),
      "CW-038",
      ...BASELINE_IDS.slice(37),
    ];
    expect(ids).toHaveLength(44);
    expect(new Set(ids).size).toBe(44);
    expect(ids.includes("CW-037")).toBe(false);
    expect(ids.includes("CW-038")).toBe(true);
    const items = ids
      .slice()
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
      .map(makeMapped);
    const result = evaluate(buildMatrix(ids), acceptBody(items));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_set_mismatch",
    });
  });

  it("rejects unknown provider input with whitespace mapped field", () => {
    const items = allMappedItems().map((item) =>
      item.itemId === "CW-001" ? { ...item, sprint: "   " } : item,
    );
    const response = {
      schemaVersion: 1,
      outcome: "accept",
      itemResults: items,
      inventedCompletions: [],
      findings: [],
      summary: "whitespace sprint",
    };
    const result = evaluate(buildMatrix(BASELINE_IDS), response);
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "provider_response_invalid",
    });
  });

  it("rejects unknown provider input with extra field, invalid outcome, and unexplained abstention", () => {
    const base = {
      schemaVersion: 1,
      itemResults: allMappedItems(),
      inventedCompletions: [],
      findings: [],
      summary: "bad provider payloads",
    };
    expect(
      evaluate(buildMatrix(BASELINE_IDS), {
        ...base,
        outcome: "accept",
        mappedItemCount: 44,
      }),
    ).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "provider_response_invalid",
    });
    expect(
      evaluate(buildMatrix(BASELINE_IDS), {
        ...base,
        outcome: "approved",
      }),
    ).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "provider_response_invalid",
    });
    expect(
      evaluate(buildMatrix(BASELINE_IDS), {
        ...base,
        outcome: "abstain",
      }),
    ).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "provider_response_invalid",
    });
  });

  it("rejects valid artifact bytes paired with wrong invention artifactSha256", () => {
    const artifactText = "line one\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const realDigest = sha256Hex(artifactBytes);
    const invention = wholeLineInvention(alias, artifactBytes, "line one\n");
    const tampered = {
      ...invention,
      artifactSha256: "a".repeat(64) as Sha256Digest,
    };
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBody(allMappedItems(), [tampered]),
      [{ alias, sha256: realDigest, bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "artifact_digest_mismatch",
    });
  });

  it("rejects inverted range, out-of-bounds range, and unsafe-integer range", () => {
    const artifactText = "line one\nline two\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const cases: Array<{ startByte: number; endByte: number }> = [
      { startByte: 5, endByte: 5 },
      { startByte: 8, endByte: 3 },
      { startByte: 0, endByte: artifactBytes.length + 1 },
      {
        startByte: Number.MAX_SAFE_INTEGER + 1,
        endByte: Number.MAX_SAFE_INTEGER + 2,
      },
    ];
    for (const range of cases) {
      const invention = {
        schemaVersion: 1 as const,
        artifactAlias: alias,
        artifactSha256,
        startByte: range.startByte,
        endByte: range.endByte,
        claimSha256: "b".repeat(64) as Sha256Digest,
        recordSha256: "c".repeat(64) as Sha256Digest,
        summary: "bad range",
        correctiveAction: "fix",
      };
      const result = evaluate(
        buildMatrix(BASELINE_IDS),
        {
          schemaVersion: 1,
          outcome: "changes_requested",
          itemResults: allMappedItems(),
          inventedCompletions: [invention],
          findings: [
            {
              location: "candidate",
              summary: "defect found",
              nextAction: "repair",
            },
          ],
          summary: "bad range case",
        },
        [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
      );
      // Unsafe integers fail provider schema decode; other ranges fail evaluation.
      expect(result._tag).toBe("Invalid");
      if (result._tag === "Invalid") {
        expect([
          "invention_range_invalid",
          "provider_response_invalid",
        ]).toContain(result.reason);
      }
    }
  });

  it("rejects invalid coverage-matrix UTF-8 through the public evaluator API", () => {
    const badMatrix = new Uint8Array([0xff, 0xfe, 0x00]);
    const result = evaluateSpecCorrectnessV1({
      coverageMatrixBytes: badMatrix,
      response: acceptBody(allMappedItems()),
      evidenceArtifacts: [],
      sha256: sha256Hex,
      decodeUtf8,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "coverage_matrix_invalid_utf8",
    });
  });
});

describe("evaluateSpecCorrectnessV1 baseline parsing", () => {
  it("parses plain and backticked IDs and sorts by UTF-8 byte order", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|\n";
    const rows = [
      ...Array.from({ length: 7 }, (_, index) => {
        const id = `RT-${String(index + 1).padStart(3, "0")}`;
        return `| ${id} | released_truth | 0 | requirement | evidence | open |`;
      }),
      ...Array.from({ length: 37 }, (_, index) => {
        const id = `CW-${String(index + 1).padStart(3, "0")}`;
        return `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
      }),
    ].join("\n");
    const matrix = `${header}${rows}\n`;
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
      expect(result.metrics.baselineItemCount).toBe(44);
    }
  });

  it("ignores a fenced fake row", () => {
    const fake =
      "```\n| `CW-038` | fake | 0 | requirement | evidence | open |\n```\n";
    const matrix = `${fake}${buildMatrix(BASELINE_IDS)}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).not.toContain("CW-038");
    expect(parsed).toHaveLength(44);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
  });

  it("ignores standalone pipe-prefixed prose without a closing cell delimiter", () => {
    const matrix = `| CW-001\n${buildMatrix(BASELINE_IDS)}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed.filter((id) => id === "CW-001")).toHaveLength(1);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
  });

  it("ignores a row with no closing cell delimiter", () => {
    const matrix = `| \`CW-038\` | no close\n${buildMatrix(BASELINE_IDS)}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).not.toContain("CW-038");
    expect(parsed).toHaveLength(44);
  });

  it("terminates the table at each unmatched-backtick first-cell form", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    const unmatchedForms = [
      "| `CW-038 | open only | 0 | requirement | evidence | open |",
      "| CW-039` | close only | 0 | requirement | evidence | open |",
      "| ``CW-040` | mismatched | 0 | requirement | evidence | open |",
    ] as const;
    for (const badRow of unmatchedForms) {
      const matrix = [
        header,
        delimiter,
        ...BASELINE_IDS.slice(0, 10).map(bodyRow),
        badRow,
        ...BASELINE_IDS.slice(10).map(bodyRow),
        "",
      ].join("\n");
      const parsed = parseCoverageMatrixBaselineIds(matrix);
      expect(parsed).toEqual(BASELINE_IDS.slice(0, 10));
      expect(parsed).toHaveLength(10);
      expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "baseline_id_count_invalid",
      });
    }
  });

  it("terminates when a plain not-an-id first cell appears before the baseline completes", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    const matrix = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      "| not-an-id | carried_work | 0 | requirement | evidence | open |",
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsed).toHaveLength(20);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("terminates when a code-inline not-an-id first cell appears before the baseline completes", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    const matrix = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      "| `not-an-id` | carried_work | 0 | requirement | evidence | open |",
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsed).toHaveLength(20);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("terminates a five-source-cell body row even when markdown-it pads to six cells", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    // Five cells: six unescaped pipes. markdown-it pads an empty sixth cell.
    const fiveCell = "| `CW-021` | carried_work | 0 | requirement | evidence |";
    const matrix = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      fiveCell,
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsed).toHaveLength(20);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("terminates a seven-source-cell body row even when markdown-it drops the extra cell", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    // Seven cells: eight unescaped pipes. markdown-it keeps only six cells.
    const sevenCell =
      "| `CW-021` | carried_work | 0 | requirement | evidence | open | extra |";
    const matrix = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      sevenCell,
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsed).toHaveLength(20);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("parses a valid canonical row that contains an escaped pipe in a non-ID cell", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const rows = BASELINE_IDS.map((id, index) => {
      if (index === 0) {
        // Six physical cells; backslash-escaped pipe is not a cell delimiter.
        return `| \`${id}\` | carried_work | 0 | has \\| pipe | evidence | open |`;
      }
      return `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    });
    const matrix = [header, delimiter, ...rows, ""].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS);
    expect(parsed).toHaveLength(44);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
  });

  it("terminates a five-cell row whose content contains \\\\ so r10 pipe counting would false-accept", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    // Five physical cells under markdown-it escapedSplit: the pipe after two
    // backslashes is content, not a delimiter. markdown-it pads to six cells.
    // A naive "backslash skips next char" counter counts seven unescaped pipes
    // and would false-accept this row.
    const fiveCellWithDoubleBackslash =
      "| `CW-021` | carried_work | 0 | req \\\\| x | evidence |";
    const matrix = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      fiveCellWithDoubleBackslash,
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsed).toHaveLength(20);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("keeps six-cell rows valid when one through four backslashes precede an escaped pipe", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    // One, two, three, and four backslashes immediately before | — all keep
    // the pipe as content under markdown-it 15 escapedSplit (pipe preceded by
    // backslash is content regardless of backslash run length).
    // Fourth fixture: eight source backslashes → four runtime backslashes.
    const escapedContent = [
      "has \\| pipe",
      "has \\\\| pipe",
      "has \\\\\\| pipe",
      "has \\\\\\\\| pipe",
    ] as const;
    const runtimeRunLengths = escapedContent.map((content) => {
      const match = /\\+\|/.exec(content);
      if (match === null) {
        throw new Error(`expected backslash run before pipe in ${content}`);
      }
      // Match includes the pipe; runtime run length is the backslash count.
      return match[0].length - 1;
    });
    expect(runtimeRunLengths).toEqual([1, 2, 3, 4]);
    const rows = BASELINE_IDS.map((id, index) => {
      const content = escapedContent[index];
      if (content !== undefined) {
        return `| \`${id}\` | carried_work | 0 | ${content} | evidence | open |`;
      }
      return `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    });
    const matrix = [header, delimiter, ...rows, ""].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS);
    expect(parsed).toHaveLength(44);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
    }
  });

  it("rejects a header whose ID label is entity-encoded even when body IDs are canonical", () => {
    // Oracle isolates the raw-header guard: body rows use canonical backticked
    // IDs so body rejection cannot mask deletion of the I&#68; header check.
    const header =
      "| I&#68; | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const rows = BASELINE_IDS.map(
      (id) =>
        `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
    );
    const matrix = [header, delimiter, ...rows, ""].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects entity-encoded body IDs even when the raw header is canonical", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const rows = BASELINE_IDS.map((id) => {
      const entityId = `${id.slice(0, -1)}&#${String(id.charCodeAt(id.length - 1))};`;
      return `| ${entityId} | carried_work | 0 | requirement | evidence | open |`;
    });
    const matrix = [header, delimiter, ...rows, ""].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("returns the exact 44 IDs for a canonical entity-free LF matrix and its CRLF twin", () => {
    const lfMatrix = buildMatrix(BASELINE_IDS);
    const crlfMatrix = lfMatrix.replaceAll("\n", "\r\n");
    const parsedLf = parseCoverageMatrixBaselineIds(lfMatrix);
    const parsedCrlf = parseCoverageMatrixBaselineIds(crlfMatrix);
    expect(parsedLf).toEqual(BASELINE_IDS);
    expect(parsedCrlf).toEqual(BASELINE_IDS);
    expect(parsedLf).toHaveLength(44);
    expect(parsedCrlf).toHaveLength(44);
    expect(evaluate(lfMatrix, acceptBody(allMappedItems()))._tag).toBe("Valid");
    expect(evaluate(crlfMatrix, acceptBody(allMappedItems()))._tag).toBe(
      "Valid",
    );
  });

  it("parses the same canonical matrix with CRLF line endings as with LF", () => {
    const lfMatrix = buildMatrix(BASELINE_IDS);
    const crlfMatrix = lfMatrix.replaceAll("\n", "\r\n");
    const parsedLf = parseCoverageMatrixBaselineIds(lfMatrix);
    const parsedCrlf = parseCoverageMatrixBaselineIds(crlfMatrix);
    expect(parsedLf).toEqual(BASELINE_IDS);
    expect(parsedCrlf).toEqual(parsedLf);
    expect(parsedCrlf).toHaveLength(44);
    const result = evaluate(crlfMatrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
      expect(result.metrics.baselineItemCount).toBe(44);
    }
  });

  it("treats bare CR as ordinary source content that fails the physical row form", () => {
    // CR not followed by LF is not a line break. Glue the next body row onto the
    // same physical line after a bare CR so outer-pipe form fails closed.
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;
    const prefix = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
    ].join("\n");
    const bareCrGlue =
      "\n" +
      bodyRow(BASELINE_IDS[20] ?? "CW-021") +
      "\r" +
      bodyRow(BASELINE_IDS[21] ?? "CW-022");
    const suffix = "\n" + BASELINE_IDS.slice(22).map(bodyRow).join("\n") + "\n";
    const matrix = `${prefix}${bareCrGlue}${suffix}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsed).toHaveLength(20);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("exposes evaluator symbols only on the domain subpath, not the root barrel", () => {
    expect(typeof parseCoverageMatrixBaselineIds).toBe("function");
    expect(typeof evaluateSpecCorrectnessV1).toBe("function");
    expect(
      Object.prototype.hasOwnProperty.call(
        DomainRoot,
        "parseCoverageMatrixBaselineIds",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        DomainRoot,
        "evaluateSpecCorrectnessV1",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        SchemaRoot,
        "SpecCorrectnessProviderResponseV1",
      ),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(SchemaRoot, "portableSha256Hex"),
    ).toBe(false);
  });

  it("supports permitted leading indentation on a valid table", () => {
    const header =
      "  | ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n  |---|---|---|---|---|---|\n";
    const rows = BASELINE_IDS.map(
      (id) =>
        `  | \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
    ).join("\n");
    const matrix = `${header}${rows}\n`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(44);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
  });

  it("ignores a complete canonical table indented four spaces", () => {
    const indented = buildMatrix(BASELINE_IDS)
      .split("\n")
      .map((line) => (line.length === 0 ? line : `    ${line}`))
      .join("\n");
    const parsed = parseCoverageMatrixBaselineIds(indented);
    expect(parsed).toHaveLength(0);
    const result = evaluate(indented, acceptBody(allMappedItems()));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("does not close a fence with a shorter run, opposite character, or trailing text", () => {
    const spoofRows = BASELINE_IDS.map(
      (id) =>
        `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
    ).join("\n");
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const cases = [
      // shorter run does not close ```
      "```\n" +
        "``\n" +
        `${header}\n${spoofRows}\n` +
        "```\n" +
        buildMatrix(BASELINE_IDS.slice(0, 43)),
      // opposite fence character does not close
      "```\n" +
        "~~~\n" +
        `${header}\n${spoofRows}\n` +
        "```\n" +
        buildMatrix(BASELINE_IDS.slice(0, 43)),
      // fence with trailing text does not close
      "```\n" +
        "``` info\n" +
        `${header}\n${spoofRows}\n` +
        "```\n" +
        buildMatrix(BASELINE_IDS.slice(0, 43)),
    ];
    for (const matrix of cases) {
      const parsed = parseCoverageMatrixBaselineIds(matrix);
      // Spoofed rows stay inside the open fence; incomplete outer table cannot accept.
      expect(parsed.length).toBeLessThan(44);
      const result = evaluate(matrix, acceptBody(allMappedItems()));
      expect(result._tag).toBe("Invalid");
    }
  });

  it("ignores fake tables inside script, pre, style, comment, PI, CDATA, declaration, and block-tag HTML", () => {
    const spoofTable = buildMatrix(BASELINE_IDS);
    const incompleteReal = buildMatrix(BASELINE_IDS.slice(0, 43));
    const blocks = [
      `<script>\n${spoofTable}</script>\n`,
      `<pre>\n${spoofTable}</pre>\n`,
      `<style>\n${spoofTable}</style>\n`,
      `<!--\n${spoofTable}-->\n`,
      `<?php\n${spoofTable}?>\n`,
      `<![CDATA[\n${spoofTable}]]>\n`,
      `<!DOCTYPE html\n${spoofTable}>\n`,
      `<div>\n${spoofTable}\n\n`,
    ];
    for (const block of blocks) {
      const matrix = `${block}${incompleteReal}`;
      const parsed = parseCoverageMatrixBaselineIds(matrix);
      // Strict boundary: any markdown-it html_block makes the document non-canonical.
      expect(parsed).toHaveLength(0);
      const result = evaluate(matrix, acceptBody(allMappedItems()));
      expect(result).toEqual({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "baseline_id_count_invalid",
      });
    }
  });

  it("rejects a blank-line-closed HTML opener that leaves a one-row table contributing an ID", () => {
    // markdown-it ends type-7 html_block at the blank line after <div>, so the
    // one-row table between opener and </div> becomes real table tokens. Before
    // the r14 fail-closed html_block rule, that row plus a 43-ID table accepted.
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const oneRow = "| RT-007 | x | 0 | r | e | o |";
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `<div>\n\n${header}\n${oneRow}\n</div>\n\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(parsed).not.toContain("RT-007");
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects a prefixed inline <div> composition that yields no top-level html_block", () => {
    // markdown-it emits "prefix <div>" as paragraph inline tokens with
    // html_inline for <div>, not html_block. The one-row table plus the
    // remaining 43-ID table would otherwise accept (r15 fail-open).
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const oneRow = "| RT-007 | x | 0 | r | e | o |";
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `prefix <div>\n\n${header}\n${oneRow}\n\nsuffix </div>\n\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(parsed).not.toContain("RT-007");
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects mixed-case block-level html_inline tags before a spoof composition", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const oneRow = "| RT-007 | x | 0 | r | e | o |";
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `prefix <DIV class="x">\n\n${header}\n${oneRow}\n\nsuffix </DIV>\n\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects block-level html_inline tags that carry quoted attributes", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const oneRow = "| RT-007 | x | 0 | r | e | o |";
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `prefix <div id="a" class="b">\n\n${header}\n${oneRow}\n\nsuffix </div>\n\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects a closing block-level html_inline tag without a matching opener", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const oneRow = "| RT-007 | x | 0 | r | e | o |";
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `prefix text\n\n${header}\n${oneRow}\n\nsuffix </div>\n\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("still accepts a canonical table after ordinary non-block inline HTML", () => {
    // Ordinary span markup must not suppress a later legitimate coverage table.
    const matrix = `prefix <span>metadata</span>\n\n${buildMatrix(BASELINE_IDS)}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toEqual(BASELINE_IDS);
    expect(parsed).toHaveLength(44);
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
      expect(result.metrics.baselineItemCount).toBe(44);
    }
  });

  it("does not let an unrelated valid table replace a missing canonical row", () => {
    const unrelated = [
      "| Name | Value |",
      "|---|---|",
      "| RT-007 | not-a-coverage-row |",
      "| foo | bar |",
      "",
    ].join("\n");
    // Missing RT-007 from the real coverage table only.
    // Blank line required so markdown-it emits two tables; without it the
    // coverage header is truncated into the two-column table body.
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `${unrelated}\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(43);
    expect(parsed).not.toContain("RT-007");
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("rejects mismatched header and delimiter cell counts", () => {
    const badDelimiter = [
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |",
      "|---|---|---|",
      ...BASELINE_IDS.map(
        (id) =>
          `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
      ),
      "",
    ].join("\n");
    const badHeader = [
      "| ID | Class | Target sprint |",
      "|---|---|---|---|---|---|",
      ...BASELINE_IDS.map(
        (id) =>
          `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
      ),
      "",
    ].join("\n");
    for (const matrix of [badDelimiter, badHeader]) {
      const parsed = parseCoverageMatrixBaselineIds(matrix);
      expect(parsed).toHaveLength(0);
      const result = evaluate(matrix, acceptBody(allMappedItems()));
      expect(result).toEqual({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "baseline_id_count_invalid",
      });
    }
  });

  it("collects CW-999 deterministically in document order and rejects baseline count", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;

    const withCw999 = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      bodyRow("CW-999"),
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const expectedSequence = [
      ...BASELINE_IDS.slice(0, 20),
      "CW-999",
      ...BASELINE_IDS.slice(20),
    ];
    expect(expectedSequence).toHaveLength(45);
    const parsedCw999 = parseCoverageMatrixBaselineIds(withCw999);
    expect(parsedCw999).toEqual(expectedSequence);
    expect(parsedCw999).toHaveLength(45);
    expect(evaluate(withCw999, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("stops a canonical table at a malformed body row so later rows cannot complete the baseline", () => {
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |";
    const delimiter = "|---|---|---|---|---|---|";
    const bodyRow = (id: string): string =>
      `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`;

    const withMalformed = [
      header,
      delimiter,
      ...BASELINE_IDS.slice(0, 20).map(bodyRow),
      "| **not-an-id** | carried_work | 0 | requirement | evidence | open |",
      ...BASELINE_IDS.slice(20).map(bodyRow),
      "",
    ].join("\n");
    const parsedMalformed = parseCoverageMatrixBaselineIds(withMalformed);
    // Malformed first-cell tokens end the candidate table; later rows do not fill.
    expect(parsedMalformed).toEqual(BASELINE_IDS.slice(0, 20));
    expect(parsedMalformed).toHaveLength(20);
    expect(evaluate(withMalformed, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("ignores a fake canonical table inside HTML with a quoted greater-than attribute", () => {
    const spoof = buildMatrix(BASELINE_IDS);
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    // Type-7 HTML block continues until a blank line; trailing newline on the
    // spoof plus an extra newline ends the block before the incomplete table.
    const matrix = `<x data=">">\n${spoof}\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    // Strict boundary: any markdown-it html_block makes the document non-canonical.
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("ignores a complete canonical table indented with one leading tab", () => {
    const tabbed = buildMatrix(BASELINE_IDS)
      .split("\n")
      .map((line) => (line.length === 0 ? line : `\t${line}`))
      .join("\n");
    const parsed = parseCoverageMatrixBaselineIds(tabbed);
    expect(parsed).toHaveLength(0);
    expect(evaluate(tabbed, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("ignores a fake canonical table inside a textarea block with an internal blank line", () => {
    const spoofRows = BASELINE_IDS.map(
      (id) =>
        `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
    ).join("\n");
    const header =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const incomplete = buildMatrix(BASELINE_IDS.slice(0, 43));
    const matrix = `<textarea>\n${header}\n${spoofRows}\n\nextra spoof line\n</textarea>\n${incomplete}`;
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    // Strict boundary: any markdown-it html_block makes the document non-canonical.
    expect(parsed).toHaveLength(0);
    expect(evaluate(matrix, acceptBody(allMappedItems()))).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "baseline_id_count_invalid",
    });
  });

  it("parses a dual-table coverage-matrix fixture into exactly 44 canonical IDs", () => {
    // Structure mirrors openspec/changes/v030-release-program/coverage-matrix.md:
    // prose, RT table, CW table, metric notes. Canonical sequence is CW then RT.
    const rtHeader =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---|---|---|---|";
    const cwHeader =
      "| ID | Class | Target sprint | Mapped requirement or boundary | Acceptance evidence | Baseline status |\n|---|---|---:|---|---|---|";
    const rtIds = BASELINE_IDS.slice(37);
    const cwIds = BASELINE_IDS.slice(0, 37);
    const rtRows = rtIds
      .map(
        (id) =>
          `| ${id} | released_truth | released | requirement | evidence | shipped |`,
      )
      .join("\n");
    const cwRows = cwIds
      .map(
        (id) =>
          `| \`${id}\` | carried_work | 0 | requirement | evidence | open |`,
      )
      .join("\n");
    const matrix = [
      "# v0.3.0 specification coverage matrix",
      "",
      "Prose before tables is ignored.",
      "",
      "## Released truth anchors",
      "",
      rtHeader,
      rtRows,
      "",
      "## Release boundaries and carried work",
      "",
      cwHeader,
      cwRows,
      "",
      "## Metric rules",
      "",
      "- baseline_item_count is 44.",
      "",
    ].join("\n");
    const parsed = parseCoverageMatrixBaselineIds(matrix);
    expect(parsed).toHaveLength(44);
    // Document order is RT then CW; evaluator still requires the canonical set.
    expect(parsed).toEqual([...rtIds, ...cwIds]);
    expect(new Set(parsed)).toEqual(new Set(BASELINE_IDS));
    const result = evaluate(matrix, acceptBody(allMappedItems()));
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("accept");
      expect(result.metrics.baselineItemCount).toBe(44);
    }
  });
});

describe("evaluateSpecCorrectnessV1 whole-line invention ranges", () => {
  it("accepts a non-first LF-delimited line", () => {
    const artifactText = "first line\nsecond line\nthird line\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const second = "second line\n";
    const startByte = encodeUtf8("first line\n").length;
    const endByte = startByte + encodeUtf8(second).length;
    const invention = wholeLineInvention(alias, artifactBytes, second, {
      startByte,
      endByte,
    });
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBodyNoFindings(allMappedItems(), [invention]),
      [{ alias, sha256: sha256Hex(artifactBytes), bytes: artifactBytes }],
    );
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("changes_requested");
    }
  });

  it("accepts an EOF final line without trailing LF", () => {
    const artifactText = "first line\nfinal without lf";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const startByte = encodeUtf8("first line\n").length;
    const endByte = artifactBytes.length;
    const slice = artifactBytes.slice(startByte, endByte);
    const artifactSha256 = sha256Hex(artifactBytes);
    expect(new TextDecoder().decode(slice)).toBe("final without lf");
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "eof line",
      correctiveAction: "remove",
    } as InventedCompletionV1;
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBodyNoFindings(allMappedItems(), [invention]),
      [{ alias, sha256: artifactSha256, bytes: artifactBytes }],
    );
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("changes_requested");
    }
  });

  it("accepts a multi-line whole-line range", () => {
    const artifactText = "one\ntwo\nthree\n";
    const artifactBytes = encodeUtf8(artifactText);
    const alias = "spec";
    const startByte = 0;
    const endByte = encodeUtf8("one\ntwo\n").length;
    const invention = wholeLineInvention(alias, artifactBytes, "one\ntwo\n", {
      startByte,
      endByte,
    });
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      changesBodyNoFindings(allMappedItems(), [invention]),
      [{ alias, sha256: sha256Hex(artifactBytes), bytes: artifactBytes }],
    );
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("changes_requested");
    }
  });
});

describe("evaluateSpecCorrectnessV1 untrusted primitives", () => {
  it("fails closed on a throwing hash callback", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      acceptBody(allMappedItems()),
      [
        {
          alias: "a",
          sha256: sha256Hex(encodeUtf8("x\n")),
          bytes: encodeUtf8("x\n"),
        },
      ],
      {
        sha256: () => {
          throw new Error("hash boom");
        },
        decodeUtf8,
      },
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "primitive_throw",
    });
  });

  it("fails closed on a throwing decoder", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      acceptBody(allMappedItems()),
      [],
      {
        sha256: sha256Hex,
        decodeUtf8: () => {
          throw new Error("decode boom");
        },
      },
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "primitive_throw",
    });
  });

  it("fails closed on a dishonest hash result", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      acceptBody(allMappedItems()),
      [
        {
          alias: "a",
          sha256: sha256Hex(encodeUtf8("x\n")),
          bytes: encodeUtf8("x\n"),
        },
      ],
      {
        sha256: () => "0".repeat(64) as Sha256Digest,
        decodeUtf8,
      },
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "digest_disagreement",
    });
  });

  it("fails closed on substituted decoder text", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      acceptBody(allMappedItems()),
      [],
      {
        sha256: sha256Hex,
        decodeUtf8: () => buildMatrix(BASELINE_IDS.slice(0, 43)),
      },
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "decoder_byte_substitution",
    });
  });

  it("returns primitive_input_mutation when decoder overwrites disposable bytes with a canonical matrix", () => {
    const goodText = buildMatrix(BASELINE_IDS);
    const goodBytes = encodeUtf8(goodText);
    // Same length, different content so a dishonest decoder can overwrite.
    const badText = goodText.replace("CW-001", "CW-099");
    const badBytes = encodeUtf8(badText);
    expect(badBytes.length).toBe(goodBytes.length);
    expect(badText).not.toBe(goodText);

    const result = evaluateSpecCorrectnessV1({
      coverageMatrixBytes: badBytes,
      response: acceptBody(allMappedItems()),
      evidenceArtifacts: [],
      sha256: sha256Hex,
      decodeUtf8: (bytes) => {
        bytes.set(goodBytes);
        return goodText;
      },
    });
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "primitive_input_mutation",
    });
  });

  it("returns primitive_input_mutation when hash callback mutates disposable bytes after computing the original digest", () => {
    const artifactBytes = encodeUtf8("artifact line\n");
    const alias = "spec";
    const result = evaluateSpecCorrectnessV1({
      coverageMatrixBytes: encodeUtf8(buildMatrix(BASELINE_IDS)),
      response: acceptBody(allMappedItems()),
      evidenceArtifacts: [
        {
          alias,
          sha256: sha256Hex(artifactBytes),
          bytes: artifactBytes,
        },
      ],
      sha256: (bytes) => {
        const digest = portableSha256Hex(Uint8Array.from(bytes));
        bytes.fill(0);
        return digest;
      },
      decodeUtf8,
    });
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "primitive_input_mutation",
    });
  });

  it("returns primitive_return_invalid for undefined, number, object, and promise decoder returns", () => {
    const matrixText = buildMatrix(BASELINE_IDS);
    const escapes: unknown[] = [
      undefined,
      42,
      { text: matrixText },
      Promise.resolve(matrixText),
    ];
    for (const value of escapes) {
      const result = evaluateSpecCorrectnessV1({
        coverageMatrixBytes: encodeUtf8(matrixText),
        response: acceptBody(allMappedItems()),
        evidenceArtifacts: [],
        sha256: sha256Hex,
        decodeUtf8: (() => value) as (bytes: Uint8Array) => string | null,
      });
      expect(result).toEqual({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "primitive_return_invalid",
      });
    }
  });

  it("rejects a dishonest unpaired-surrogate decoder return for real U+FFFD bytes", () => {
    // Real U+FFFD is EF BF BD. Portable re-encoding maps an unpaired high or
    // low surrogate to the same three bytes, so byte equality alone is not a
    // well-formedness proof.
    const artifactBytes = new Uint8Array([0xef, 0xbf, 0xbd, 0x0a]);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 0;
    const endByte = artifactBytes.length;
    const slice = artifactBytes.slice(startByte, endByte);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "fffd invention",
      correctiveAction: "delete",
    } as InventedCompletionV1;
    const matrixText = buildMatrix(BASELINE_IDS);
    for (const dishonest of [
      String.fromCharCode(0xd800) + "\n",
      String.fromCharCode(0xdc00) + "\n",
    ]) {
      const result = evaluateSpecCorrectnessV1({
        coverageMatrixBytes: encodeUtf8(matrixText),
        response: changesBody(allMappedItems(), [invention]),
        evidenceArtifacts: [
          { alias, sha256: artifactSha256, bytes: artifactBytes },
        ],
        sha256: sha256Hex,
        decodeUtf8: (bytes) => {
          if (
            bytes.length === 4 &&
            bytes[0] === 0xef &&
            bytes[1] === 0xbf &&
            bytes[2] === 0xbd &&
            bytes[3] === 0x0a
          ) {
            return dishonest;
          }
          return decodeUtf8(bytes);
        },
      });
      expect(result._tag).toBe("Invalid");
      if (result._tag === "Invalid") {
        expect(result.reason).toBe("primitive_return_invalid");
      }
    }
  });

  it("accepts a nonempty BOM-prefixed invention slice decoded by fatal TextDecoder", () => {
    // Standard fatal TextDecoder strips one leading UTF-8 BOM (EF BB BF).
    // The boundary must accept that handling when the remaining re-encoded
    // bytes equal the canonical slice after removing that one BOM.
    const lineText = "bom invention line\n";
    const lineBytes = encodeUtf8(lineText);
    const artifactBytes = new Uint8Array(3 + lineBytes.length);
    artifactBytes.set([0xef, 0xbb, 0xbf], 0);
    artifactBytes.set(lineBytes, 3);
    const alias = "spec";
    const artifactSha256 = sha256Hex(artifactBytes);
    const startByte = 0;
    const endByte = artifactBytes.length;
    const slice = artifactBytes.slice(startByte, endByte);
    expect(slice[0]).toBe(0xef);
    expect(slice[1]).toBe(0xbb);
    expect(slice[2]).toBe(0xbf);
    expect(slice.length).toBeGreaterThan(3);
    const decoded = decodeUtf8(slice);
    expect(decoded).toBe(lineText);
    const invention = {
      schemaVersion: 1 as const,
      artifactAlias: alias,
      artifactSha256,
      startByte,
      endByte,
      claimSha256: sha256Hex(slice),
      recordSha256: recordDigest(artifactSha256, startByte, endByte, slice),
      summary: "bom-prefixed invention",
      correctiveAction: "delete",
    } as InventedCompletionV1;
    const result = evaluateSpecCorrectnessV1({
      coverageMatrixBytes: encodeUtf8(buildMatrix(BASELINE_IDS)),
      response: changesBody(allMappedItems(), [invention]),
      evidenceArtifacts: [
        { alias, sha256: artifactSha256, bytes: artifactBytes },
      ],
      sha256: sha256Hex,
      decodeUtf8,
    });
    expect(result._tag).toBe("Valid");
    if (result._tag === "Valid") {
      expect(result.outcome).toBe("changes_requested");
      expect(result.metrics.inventedCompletionCount).toBe(1);
    }
  });
});

describe("evaluateSpecCorrectnessV1 abstention cannot suppress dissent", () => {
  const namedAbstain = (
    itemResults: readonly SpecCorrectnessItemResultV1[],
    extras: {
      readonly findings?: SpecCorrectnessProviderResponseV1["findings"];
      readonly inventedCompletions?: readonly InventedCompletionV1[];
    } = {},
  ) =>
    decodeResponse({
      schemaVersion: 1,
      outcome: "abstain",
      itemResults,
      inventedCompletions: extras.inventedCompletions ?? [],
      findings: extras.findings ?? [],
      summary: "named gap",
      evidenceGaps: [
        {
          evidenceRef: "ledger",
          unmetCondition: "ledger missing",
        },
      ],
      nextAction: "attach ledger",
    });

  it("returns declared_abstain_with_defect for abstain plus a nonempty finding", () => {
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      namedAbstain(allMappedItems(), {
        findings: [
          {
            location: "candidate",
            summary: "actionable dissent",
            nextAction: "repair",
          },
        ],
      }),
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "declared_abstain_with_defect",
    });
  });

  it("returns declared_abstain_with_defect for each defect disposition under abstain", () => {
    for (const disposition of [
      "omitted",
      "contradiction",
      "unevidenced_defer",
    ] as const) {
      const items = allMappedItems();
      items[0] = makeDefect("CW-001", disposition);
      const result = evaluate(buildMatrix(BASELINE_IDS), namedAbstain(items));
      expect(result).toEqual({
        schemaVersion: 1,
        _tag: "Invalid",
        reason: "declared_abstain_with_defect",
      });
    }
  });

  it("returns declared_abstain_with_defect for abstain plus an invention", () => {
    const artifactBytes = encodeUtf8("invented line\n");
    const alias = "spec";
    const invention = wholeLineInvention(
      alias,
      artifactBytes,
      "invented line\n",
    );
    const result = evaluate(
      buildMatrix(BASELINE_IDS),
      namedAbstain(allMappedItems(), { inventedCompletions: [invention] }),
      [{ alias, sha256: sha256Hex(artifactBytes), bytes: artifactBytes }],
    );
    expect(result).toEqual({
      schemaVersion: 1,
      _tag: "Invalid",
      reason: "declared_abstain_with_defect",
    });
  });
});

describe("wholeLineInvention fixture helper", () => {
  it("rejects claimed text that differs from selected artifact bytes", () => {
    const artifactBytes = encodeUtf8("actual line\n");
    expect(() =>
      wholeLineInvention("spec", artifactBytes, "different claim\n"),
    ).toThrow();
  });

  it("encodes supplied lineText exactly without inventing a trailing line-feed", () => {
    const artifactBytes = encodeUtf8("actual\n");
    expect(() => wholeLineInvention("spec", artifactBytes, "actual")).toThrow();
    const exact = wholeLineInvention("spec", artifactBytes, "actual\n");
    expect(exact.startByte).toBe(0);
    expect(exact.endByte).toBe(artifactBytes.length);
    expect(exact.claimSha256).toBe(sha256Hex(artifactBytes));
  });
});
