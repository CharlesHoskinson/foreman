import {
  CORE_FAILURE_BRAND,
  duplicateJsonKey,
  invalidJson,
  isCoreFailure,
  type CoreFailure,
} from "./failures.js";

/**
 * Internal unforgeable parse-failure carrier. Distinct from any user JSON
 * value; never inspects user `_tag` keys for control flow.
 */
const PARSE_FAIL = Symbol("@foreman/core/parseFail");

type ParseFail = {
  readonly [PARSE_FAIL]: true;
  readonly failure: CoreFailure;
};

function parseFail(failure: CoreFailure): ParseFail {
  return { [PARSE_FAIL]: true, failure };
}

function isParseFail(v: unknown): v is ParseFail {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { [PARSE_FAIL]?: unknown })[PARSE_FAIL] === true
  );
}

/**
 * Parse JSON and reject duplicate keys at any object level.
 * Uses a lightweight scanner that tracks keys per object scope.
 */
export function parseJsonRejectDuplicateKeys(
  text: string,
): unknown | CoreFailure {
  let i = 0;
  const s = text;
  let depth = 0;

  function skipWs(): void {
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) {
        i += 1;
      } else {
        break;
      }
    }
  }

  function peek(): string {
    return i < s.length ? s[i]! : "";
  }

  function fail(): ParseFail {
    return parseFail(invalidJson());
  }

  function parseString(): string | ParseFail {
    if (peek() !== '"') return fail();
    i += 1;
    let out = "";
    while (i < s.length) {
      const c = s[i]!;
      if (c === '"') {
        i += 1;
        return out;
      }
      if (c === "\\") {
        i += 1;
        if (i >= s.length) return fail();
        const e = s[i]!;
        i += 1;
        switch (e) {
          case '"':
          case "\\":
          case "/":
            out += e;
            break;
          case "b":
            out += "\b";
            break;
          case "f":
            out += "\f";
            break;
          case "n":
            out += "\n";
            break;
          case "r":
            out += "\r";
            break;
          case "t":
            out += "\t";
            break;
          case "u": {
            if (i + 4 > s.length) return fail();
            const hex = s.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) return fail();
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
            break;
          }
          default:
            return fail();
        }
      } else if (c.charCodeAt(0) < 0x20) {
        return fail();
      } else {
        out += c;
        i += 1;
      }
    }
    return fail();
  }

  function parseNumber(): number | ParseFail {
    const start = i;
    if (peek() === "-") i += 1;
    if (peek() < "0" || peek() > "9") return fail();
    if (peek() === "0") {
      i += 1;
      if (peek() >= "0" && peek() <= "9") return fail();
    } else {
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (peek() === ".") {
      i += 1;
      if (peek() < "0" || peek() > "9") return fail();
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    if (peek() === "e" || peek() === "E") {
      i += 1;
      if (peek() === "+" || peek() === "-") i += 1;
      if (peek() < "0" || peek() > "9") return fail();
      while (peek() >= "0" && peek() <= "9") i += 1;
    }
    const num = Number(s.slice(start, i));
    if (!Number.isFinite(num)) return fail();
    return num;
  }

  function parseValue(): unknown | ParseFail {
    skipWs();
    const c = peek();
    if (c === '"') return parseString();
    if (c === "{") return parseObject();
    if (c === "[") return parseArray();
    if (c === "t") {
      if (s.slice(i, i + 4) !== "true") return fail();
      i += 4;
      return true;
    }
    if (c === "f") {
      if (s.slice(i, i + 5) !== "false") return fail();
      i += 5;
      return false;
    }
    if (c === "n") {
      if (s.slice(i, i + 4) !== "null") return fail();
      i += 4;
      return null;
    }
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    return fail();
  }

  function parseObject(): Record<string, unknown> | ParseFail {
    if (depth >= 64) return fail();
    depth += 1;
    if (peek() !== "{") return fail();
    i += 1;
    skipWs();
    const obj = Object.create(null) as Record<string, unknown>;
    const seen = new Set<string>();
    if (peek() === "}") {
      i += 1;
      depth -= 1;
      return obj;
    }
    while (true) {
      skipWs();
      const key = parseString();
      if (isParseFail(key)) return key;
      if (seen.has(key)) return parseFail(duplicateJsonKey());
      seen.add(key);
      skipWs();
      if (peek() !== ":") return fail();
      i += 1;
      const val = parseValue();
      if (isParseFail(val)) return val;
      Object.defineProperty(obj, key, {
        value: val,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      skipWs();
      if (peek() === ",") {
        i += 1;
        continue;
      }
      if (peek() === "}") {
        i += 1;
        depth -= 1;
        return obj;
      }
      return fail();
    }
  }

  function parseArray(): unknown[] | ParseFail {
    if (depth >= 64) return fail();
    depth += 1;
    if (peek() !== "[") return fail();
    i += 1;
    skipWs();
    const arr: unknown[] = [];
    if (peek() === "]") {
      i += 1;
      depth -= 1;
      return arr;
    }
    while (true) {
      const val = parseValue();
      if (isParseFail(val)) return val;
      arr.push(val);
      skipWs();
      if (peek() === ",") {
        i += 1;
        continue;
      }
      if (peek() === "]") {
        i += 1;
        depth -= 1;
        return arr;
      }
      return fail();
    }
  }

  const value = parseValue();
  if (isParseFail(value)) {
    return value.failure;
  }
  skipWs();
  if (i !== s.length) {
    return invalidJson();
  }
  return value;
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("non_finite_number");
    }
    if (Object.is(value, -0)) return "0";
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(JSON.stringify(k) + ":" + canonicalize(obj[k]));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new Error("unsupported_json_value");
}

export function isCanonicalJsonText(text: string): boolean {
  const parsed = parseJsonRejectDuplicateKeys(text);
  if (isCoreFailure(parsed)) {
    return false;
  }
  try {
    const canon = canonicalize(parsed);
    return canon === text;
  } catch {
    return false;
  }
}

// Re-export brand for tests that assert branded failures
export { CORE_FAILURE_BRAND };
