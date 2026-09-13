import { canonicalize, sha256Hex } from "@foreman/core";
import type { PelNode, SourceSpan } from "./ast.js";
import { diagnostic, type PelDiagnostic } from "./diagnostics.js";
import type { PelDataValue, PelValue, Result } from "./types.js";

const dataSpan: SourceSpan = {
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
};

const maximumDataDepth = 256;

function dataFailure(message: string): Result<never, PelDiagnostic> {
  return { ok: false, error: diagnostic("PEL_HOST_RESULT", dataSpan, message) };
}

function hasValidUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function ownDataRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Object.getOwnPropertySymbols(value).length !== 0) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const record: Record<string, unknown> = {};
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) return undefined;
    record[name] = descriptor.value;
  }
  return record;
}

function exactFields(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((name, index) => name === wanted[index])
  );
}

function denseDataArray(value: unknown): readonly unknown[] | undefined {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return undefined;
  if (
    Object.getOwnPropertySymbols(value).length !== 0 ||
    !Number.isSafeInteger(value.length)
  )
    return undefined;
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== value.length + 1 || !names.includes("length"))
    return undefined;
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    )
      return undefined;
  }
  return value;
}

function decodeData(
  input: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): Result<PelDataValue, PelDiagnostic> {
  if (depth > maximumDataDepth)
    return dataFailure("Pel data exceeds the maximum nesting depth");
  const record = ownDataRecord(input);
  if (record === undefined)
    return dataFailure("Pel data must be an exact tagged object");
  const identity = input as object;
  if (ancestors.has(identity))
    return dataFailure("Pel data must not contain cycles");
  ancestors.add(identity);

  try {
    const tag = record.tag;
    if (typeof tag !== "string")
      return dataFailure("Pel data requires a string tag");
    switch (tag) {
      case "number": {
        if (!exactFields(record, ["tag", "value"]))
          return dataFailure("Pel number has unknown or missing fields");
        const value = record.value;
        if (
          typeof value !== "number" ||
          !Number.isFinite(value) ||
          (Number.isInteger(value) && !Number.isSafeInteger(value))
        ) {
          return dataFailure(
            "Pel number must be finite and every integer must be safe",
          );
        }
        return {
          ok: true,
          value: { tag: "number", value: Object.is(value, -0) ? 0 : value },
        };
      }
      case "string": {
        if (!exactFields(record, ["tag", "value"]))
          return dataFailure("Pel string has unknown or missing fields");
        const value = record.value;
        if (typeof value !== "string" || !hasValidUnicode(value))
          return dataFailure(
            "Pel string must contain valid Unicode scalar values",
          );
        return { ok: true, value: { tag: "string", value } };
      }
      case "boolean": {
        if (
          !exactFields(record, ["tag", "value"]) ||
          typeof record.value !== "boolean"
        ) {
          return dataFailure(
            "Pel Boolean has unknown fields or an invalid value",
          );
        }
        return { ok: true, value: { tag: "boolean", value: record.value } };
      }
      case "nil":
        return exactFields(record, ["tag"])
          ? { ok: true, value: { tag: "nil" } }
          : dataFailure("Pel nil has unknown fields");
      case "key": {
        if (
          !exactFields(record, ["tag", "name"]) ||
          typeof record.name !== "string" ||
          !hasValidUnicode(record.name)
        ) {
          return dataFailure(
            "Pel key has unknown fields or an invalid Unicode name",
          );
        }
        return { ok: true, value: { tag: "key", name: record.name } };
      }
      case "pair": {
        if (
          !exactFields(record, ["tag", "key", "value"]) ||
          typeof record.key !== "string" ||
          !hasValidUnicode(record.key)
        ) {
          return dataFailure(
            "Pel pair has unknown fields or an invalid Unicode key",
          );
        }
        const nested = decodeData(record.value, ancestors, depth + 1);
        if (!nested.ok) return nested;
        return {
          ok: true,
          value: { tag: "pair", key: record.key, value: nested.value },
        };
      }
      case "list": {
        if (!exactFields(record, ["tag", "items"]))
          return dataFailure("Pel list has unknown or missing fields");
        const items = denseDataArray(record.items);
        if (items === undefined)
          return dataFailure("Pel list items must be a dense ordinary array");
        const decoded: PelDataValue[] = [];
        for (const item of items) {
          const nested = decodeData(item, ancestors, depth + 1);
          if (!nested.ok) return nested;
          decoded.push(nested.value);
        }
        return { ok: true, value: { tag: "list", items: decoded } };
      }
      default:
        return dataFailure(
          `Pel data tag ${JSON.stringify(tag)} is not host-safe`,
        );
    }
  } finally {
    ancestors.delete(identity);
  }
}

export function decodePelData(
  value: unknown,
): Result<PelDataValue, PelDiagnostic> {
  try {
    return decodeData(value, new WeakSet<object>(), 0);
  } catch {
    return dataFailure("Pel data could not be inspected safely");
  }
}

export function encodePelData(
  value: PelValue,
): Result<PelDataValue, PelDiagnostic> {
  return decodePelData(value);
}

export function isPelDataValue(value: unknown): value is PelDataValue {
  return decodePelData(value).ok;
}

export function canonicalPelData(
  value: PelValue,
): Result<string, PelDiagnostic> {
  const encoded = encodePelData(value);
  if (!encoded.ok) return encoded;
  return { ok: true, value: canonicalize(encoded.value) };
}

export function hashPelData(value: PelValue): Result<string, PelDiagnostic> {
  const encoded = canonicalPelData(value);
  if (!encoded.ok) return encoded;
  return { ok: true, value: sha256Hex(encoded.value) };
}

function decimalWithoutExponent(value: number): string {
  if (Object.is(value, -0)) return "0";
  const shortest = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(shortest);
  if (match === null) return shortest;
  const sign = match[1] ?? "";
  const integer = match[2] ?? "";
  const fraction = match[3] ?? "";
  const exponent = Number(match[4]);
  const digits = integer + fraction;
  const decimalPosition = integer.length + exponent;
  if (decimalPosition <= 0)
    return `${sign}0.${"0".repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length)
    return `${sign}${digits}${"0".repeat(decimalPosition - digits.length)}`;
  return `${sign}${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function formatNode(node: PelNode): string {
  switch (node.kind) {
    case "number":
      return decimalWithoutExponent(node.value);
    case "string":
      return JSON.stringify(node.value);
    case "boolean":
      return node.value ? "#t" : "#f";
    case "nil":
      return "#nil";
    case "key":
      return `:${node.name}`;
    case "symbol":
      return node.name;
    case "caret":
      return "^";
    case "pair":
      return node.valuePresent
        ? `:${node.key} ${formatNode(node.value)}`
        : `:${node.key}`;
    case "list":
      return `[${node.items.map(formatNode).join(" ")}]`;
    case "call":
      return `(${node.items.map(formatNode).join(" ")})`;
    case "quote":
      return `'${formatNode(node.expression)}`;
    case "pipe":
      return `${formatNode(node.left)} |> ${formatNode(node.right)}`;
  }
}

export function formatPel(value: PelValue): string {
  switch (value.tag) {
    case "number":
      return decimalWithoutExponent(value.value);
    case "string":
      return JSON.stringify(value.value);
    case "boolean":
      return value.value ? "#t" : "#f";
    case "nil":
      return "#nil";
    case "key":
      return `:${value.name}`;
    case "pair":
      return `:${value.key} ${formatPel(value.value)}`;
    case "list":
      return `[${value.items.map(formatPel).join(" ")}]`;
    case "symbol":
      return `'${value.name}`;
    case "syntax":
      return `'${formatNode(value.node)}`;
    case "closure": {
      const remaining =
        value.argSpec.kind === "sequence"
          ? ""
          : value.argSpec.parameters
              .filter(
                (parameter) =>
                  !Object.hasOwn(value.boundArguments, parameter.name),
              )
              .map((parameter) => parameter.name)
              .join(",");
      return `#<closure:${value.nodeId} remaining=${remaining}>`;
    }
  }
}
