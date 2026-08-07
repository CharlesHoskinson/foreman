import {
  MAX_EVENT_JSON_NODES,
  MAX_EVENT_NESTING_DEPTH,
} from "./bounds.js";

export type StructureLimitResult = "ok" | "event_structure_limit";

/**
 * Pre-parse nesting guard over JSON text (or UTF-8-decoded text).
 *
 * Scans without recursion. Counts `{` / `[` depth (root open is depth 1).
 * Braces and brackets inside JSON strings are ignored, including after
 * escaped quotes and backslashes. Does not parse values, validate syntax,
 * or replace `@foreman/core` JSON authority — it only refuses input that
 * would exceed the version-1 nesting bound before the recursive core
 * parser runs.
 */
export function checkJsonNestingText(text: string): StructureLimitResult {
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === 0x5c /* \ */) {
        escape = true;
        continue;
      }
      if (c === 0x22 /* " */) {
        inString = false;
      }
      continue;
    }

    if (c === 0x22 /* " */) {
      inString = true;
      continue;
    }
    if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
      depth += 1;
      if (depth > MAX_EVENT_NESTING_DEPTH) {
        return "event_structure_limit";
      }
      continue;
    }
    if (c === 0x7d /* } */ || c === 0x5d /* ] */) {
      if (depth > 0) {
        depth -= 1;
      }
    }
  }

  return "ok";
}

/**
 * Iterative structural limits over a JSON value.
 * Counts each object key and each array element as one node.
 * Root depth is 1. Does not use user `_tag` for control flow.
 */
export function checkEventStructure(root: unknown): StructureLimitResult {
  type Frame = { readonly value: unknown; readonly depth: number };
  const stack: Frame[] = [{ value: root, depth: 1 }];
  let nodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.depth > MAX_EVENT_NESTING_DEPTH) {
      return "event_structure_limit";
    }
    const v = frame.value;
    if (v === null || typeof v !== "object") {
      continue;
    }
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i -= 1) {
        nodes += 1;
        if (nodes > MAX_EVENT_JSON_NODES) {
          return "event_structure_limit";
        }
        stack.push({ value: v[i], depth: frame.depth + 1 });
      }
      continue;
    }
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      nodes += 1;
      if (nodes > MAX_EVENT_JSON_NODES) {
        return "event_structure_limit";
      }
      const key = keys[i]!;
      stack.push({ value: obj[key], depth: frame.depth + 1 });
    }
  }
  return "ok";
}
