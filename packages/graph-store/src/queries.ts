/**
 * Pure lineage query algorithms over an in-memory document map.
 */

import { MAX_QUERY_RESULTS, MAX_TRAVERSAL_STEPS } from "./bounds.js";
import type { JsonObject } from "./port.js";
import { asIdSet } from "./schema.js";

function asList(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function idOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const m = raw as JsonObject;
    if ("@id" in m) return String(m["@id"]);
  }
  return String(raw);
}

export type DocumentIndex = ReadonlyMap<string, JsonObject>;

function listByType(index: DocumentIndex, docType?: string): JsonObject[] {
  const out: JsonObject[] = [];
  for (const id of [...index.keys()].sort()) {
    const doc = index.get(id);
    if (!doc) continue;
    if (docType !== undefined && doc["@type"] !== docType) continue;
    out.push(doc);
  }
  return out;
}

/**
 * All Attempt documents transitively descending from a Round.
 * Traversal edges: has_attempt seeds, derived_from children.
 */
export function queryAttemptsFromRound(
  index: DocumentIndex,
  params: JsonObject,
): string[] {
  let roundId = params["round_id"] ?? params["round"];
  if (!roundId) {
    const taskKey = params["task_key"];
    const indexVal = params["index"];
    if (taskKey == null || indexVal == null) {
      throw new Error(
        "attempts_from_round requires round_id or task_key+index",
      );
    }
    roundId = `Round/${taskKey}+${indexVal}`;
  }
  const roundIdStr = String(roundId);

  const seeds = new Set<string>();
  const rnd = index.get(roundIdStr);
  if (rnd) {
    for (const a of asList(rnd["has_attempt"])) {
      seeds.add(idOf(a));
    }
  }
  for (const att of listByType(index, "Attempt")) {
    if (att["round"] === roundIdStr || att["parent_round"] === roundIdStr) {
      seeds.add(String(att["@id"]));
    }
  }

  // parent → children via derived_from
  const children = new Map<string, Set<string>>();
  for (const d of index.values()) {
    for (const parent of asList(d["derived_from"])) {
      const pid = idOf(parent);
      let set = children.get(pid);
      if (!set) {
        set = new Set();
        children.set(pid, set);
      }
      set.add(String(d["@id"]));
    }
  }

  const found = new Set<string>();
  const stack = [...seeds];
  let steps = 0;
  while (stack.length > 0) {
    const cur = stack.pop()!;
    steps += 1;
    if (steps > MAX_TRAVERSAL_STEPS) break;
    const doc = index.get(cur);
    if (doc && doc["@type"] === "Attempt") {
      found.add(cur);
    }
    for (const ch of children.get(cur) ?? []) {
      if (!found.has(ch)) stack.push(ch);
    }
  }
  for (const s of seeds) {
    const doc = index.get(s);
    if (doc && doc["@type"] === "Attempt") found.add(s);
  }

  const sorted = [...found].sort();
  if (sorted.length > MAX_QUERY_RESULTS) {
    return sorted.slice(0, MAX_QUERY_RESULTS);
  }
  return sorted;
}

/** Attempts with no derived_from-child and no Evaluation targeting them. */
export function queryUnevaluatedLeaves(
  index: DocumentIndex,
  _params: JsonObject,
): string[] {
  const attempts = listByType(index, "Attempt");
  const hasChild = new Set<string>();
  for (const d of index.values()) {
    for (const parent of asList(d["derived_from"])) {
      hasChild.add(idOf(parent));
    }
  }
  const evaluated = new Set<string>();
  for (const ev of index.values()) {
    if (ev["@type"] !== "Evaluation") continue;
    for (const field of [
      "evaluates_attempt",
      "evaluates",
      "evaluates_artifact",
      "evaluates_claim",
    ] as const) {
      for (const t of asList(ev[field])) {
        evaluated.add(idOf(t));
      }
    }
  }
  const leaves: string[] = [];
  for (const a of attempts) {
    const aid = String(a["@id"]);
    if (hasChild.has(aid)) continue;
    if (evaluated.has(aid)) continue;
    leaves.push(aid);
  }
  const sorted = leaves.sort();
  if (sorted.length > MAX_QUERY_RESULTS) {
    return sorted.slice(0, MAX_QUERY_RESULTS);
  }
  return sorted;
}

/** Claims that CONTRADICT the given claim, either direction. */
export function queryClaimsContradicting(
  index: DocumentIndex,
  params: JsonObject,
): string[] {
  let claimId = params["claim_id"] ?? params["claim"];
  if (!claimId) {
    const key = params["claim_key"];
    if (!key) {
      throw new Error("claims_contradicting requires claim_id or claim_key");
    }
    claimId = `Claim/${key}`;
  }
  const claimIdStr = String(claimId);
  const out = new Set<string>();
  for (const c of listByType(index, "Claim")) {
    const cid = String(c["@id"]);
    if (cid === claimIdStr) {
      for (const other of asList(c["contradicts"])) {
        out.add(idOf(other));
      }
      continue;
    }
    for (const other of asList(c["contradicts"])) {
      if (idOf(other) === claimIdStr) out.add(cid);
    }
  }
  const sorted = [...out].sort();
  if (sorted.length > MAX_QUERY_RESULTS) {
    return sorted.slice(0, MAX_QUERY_RESULTS);
  }
  return sorted;
}

export function runNamedQuery(
  index: DocumentIndex,
  name: string,
  params: JsonObject,
): readonly string[] {
  if (name === "attempts_from_round") {
    return queryAttemptsFromRound(index, params);
  }
  if (name === "unevaluated_leaves") {
    return queryUnevaluatedLeaves(index, params);
  }
  if (name === "claims_contradicting") {
    return queryClaimsContradicting(index, params);
  }
  throw new Error(`unhandled query ${JSON.stringify(name)}`);
}

/** Build an index map from a documents record. */
export function indexFromDocuments(
  docs: Readonly<Record<string, JsonObject>>,
): DocumentIndex {
  return new Map(Object.entries(docs));
}

export { asIdSet, asList, idOf };
