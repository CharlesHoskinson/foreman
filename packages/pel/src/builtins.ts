import type { PelNode, SourceSpan } from "./ast.js";
import {
  diagnostic,
  type PelDiagnostic,
  type PelDiagnosticCode,
} from "./diagnostics.js";
import type { ArgParameterV1, ArgSpecV1, PelValue, Result } from "./types.js";

const syntheticSpan: SourceSpan = Object.freeze({
  start: 0,
  end: 0,
  line: 1,
  column: 1,
  endLine: 1,
  endColumn: 1,
});

function literalDefault(
  owner: string,
  parameter: string,
  value: "nil" | "string" | "boolean",
  literal?: string | boolean,
): PelNode {
  const base = {
    nodeId: `builtin:${owner}:${parameter}:default`,
    span: syntheticSpan,
  } as const;
  switch (value) {
    case "nil":
      return Object.freeze({ ...base, kind: "nil" });
    case "string":
      return Object.freeze({
        ...base,
        kind: "string",
        value: literal as string,
      });
    case "boolean":
      return Object.freeze({
        ...base,
        kind: "boolean",
        value: literal as boolean,
      });
  }
}

function parameter(
  name: string,
  required: boolean,
  evaluation: "strict" | "syntax",
  defaultExpression?: PelNode,
): ArgParameterV1 {
  return defaultExpression === undefined
    ? Object.freeze({ name, required, evaluation })
    : Object.freeze({ name, required, evaluation, defaultExpression });
}

function fixed(...parameters: readonly ArgParameterV1[]): ArgSpecV1 {
  return Object.freeze({
    kind: "fixed",
    parameters: Object.freeze(parameters),
  });
}

const binaryStrict = fixed(
  parameter("x", true, "strict"),
  parameter("y", true, "strict"),
);
const unaryXStrict = fixed(parameter("x", true, "strict"));

export const builtinArgSpecs: Record<string, ArgSpecV1> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, ArgSpecV1>, {
    def: fixed(
      parameter("name", true, "syntax"),
      parameter("value", true, "syntax"),
    ),
    lambda: fixed(
      parameter("params", true, "syntax"),
      parameter("body", true, "syntax"),
    ),
    "+": binaryStrict,
    "-": binaryStrict,
    "*": binaryStrict,
    "/": binaryStrict,
    pow: binaryStrict,
    gt: binaryStrict,
    lt: binaryStrict,
    eq: binaryStrict,
    concat: binaryStrict,
    sqrt: unaryXStrict,
    not: unaryXStrict,
    len: fixed(parameter("value", true, "strict")),
    if: fixed(
      parameter("cond", true, "syntax"),
      parameter("then", true, "syntax"),
      parameter("else", false, "syntax", literalDefault("if", "else", "nil")),
    ),
    case: fixed(
      parameter("scrut", true, "syntax"),
      parameter("body", true, "syntax"),
    ),
    for: fixed(
      parameter("coll", true, "syntax"),
      parameter("iterator", true, "syntax"),
      parameter("body", true, "syntax"),
    ),
    do: Object.freeze({ kind: "sequence" }),
    "do/async": Object.freeze({ kind: "sequence" }),
    list: fixed(
      parameter("at", false, "strict", literalDefault("list", "at", "nil")),
      parameter("from", false, "strict", literalDefault("list", "from", "nil")),
      parameter("to", false, "strict", literalDefault("list", "to", "nil")),
    ),
    print: fixed(
      parameter("vals", true, "strict"),
      parameter(
        "sep",
        false,
        "strict",
        literalDefault("print", "sep", "string", ""),
      ),
      parameter(
        "nl",
        false,
        "strict",
        literalDefault("print", "nl", "boolean", false),
      ),
    ),
    "pel/nl-condition": fixed(
      parameter("scrut", true, "strict"),
      parameter("condition", true, "strict"),
    ),
  }),
);

function failure(
  code: PelDiagnosticCode,
  span: SourceSpan,
  message: string,
): Result<never, PelDiagnostic> {
  return { ok: false, error: diagnostic(code, span, message) };
}

function numberArgument(
  value: PelValue | undefined,
  name: string,
  span: SourceSpan,
): Result<number, PelDiagnostic> {
  if (value?.tag !== "number")
    return failure("PEL_TYPE", span, `:${name} must be a number`);
  if (
    !Number.isFinite(value.value) ||
    (Number.isInteger(value.value) && !Number.isSafeInteger(value.value))
  ) {
    return failure(
      "PEL_NUMERIC_DOMAIN",
      span,
      `:${name} is outside the Pel numeric domain`,
    );
  }
  return { ok: true, value: Object.is(value.value, -0) ? 0 : value.value };
}

function checkedNumber(
  value: number,
  span: SourceSpan,
): Result<PelValue, PelDiagnostic> {
  if (
    !Number.isFinite(value) ||
    (Number.isInteger(value) && !Number.isSafeInteger(value))
  ) {
    return failure(
      "PEL_NUMERIC_DOMAIN",
      span,
      "numeric result is outside the Pel numeric domain",
    );
  }
  return {
    ok: true,
    value: { tag: "number", value: Object.is(value, -0) ? 0 : value },
  };
}

function binaryNumbers(
  args: Readonly<Record<string, PelValue>>,
  span: SourceSpan,
  operation: (x: number, y: number) => number,
): Result<PelValue, PelDiagnostic> {
  const x = numberArgument(args.x, "x", span);
  if (!x.ok) return x;
  const y = numberArgument(args.y, "y", span);
  if (!y.ok) return y;
  return checkedNumber(operation(x.value, y.value), span);
}

function normalizedNodeEqual(left: PelNode, right: PelNode): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "number":
      return right.kind === "number" && left.value === right.value;
    case "string":
      return right.kind === "string" && left.value === right.value;
    case "boolean":
      return right.kind === "boolean" && left.value === right.value;
    case "nil":
    case "caret":
      return true;
    case "key":
    case "symbol":
      return right.kind === left.kind && left.name === right.name;
    case "pair":
      return (
        right.kind === "pair" &&
        left.key === right.key &&
        left.valuePresent === right.valuePresent &&
        normalizedNodeEqual(left.value, right.value)
      );
    case "list":
    case "call":
      return (
        right.kind === left.kind &&
        left.items.length === right.items.length &&
        left.items.every((item, index) => {
          const other = right.items[index];
          return other !== undefined && normalizedNodeEqual(item, other);
        })
      );
    case "quote":
      return (
        right.kind === "quote" &&
        normalizedNodeEqual(left.expression, right.expression)
      );
    case "pipe":
      return (
        right.kind === "pipe" &&
        normalizedNodeEqual(left.left, right.left) &&
        normalizedNodeEqual(left.right, right.right)
      );
  }
}

function structuralEqual(
  left: PelValue,
  right: PelValue,
): Result<boolean, "closure"> {
  if (left.tag === "closure" || right.tag === "closure")
    return { ok: false, error: "closure" };
  if (left.tag !== right.tag) return { ok: true, value: false };
  switch (left.tag) {
    case "number":
      return {
        ok: true,
        value: right.tag === "number" && left.value === right.value,
      };
    case "string":
      return {
        ok: true,
        value: right.tag === "string" && left.value === right.value,
      };
    case "boolean":
      return {
        ok: true,
        value: right.tag === "boolean" && left.value === right.value,
      };
    case "nil":
      return { ok: true, value: true };
    case "key":
    case "symbol":
      return {
        ok: true,
        value: right.tag === left.tag && left.name === right.name,
      };
    case "pair": {
      if (right.tag !== "pair" || left.key !== right.key)
        return { ok: true, value: false };
      return structuralEqual(left.value, right.value);
    }
    case "list": {
      if (right.tag !== "list" || left.items.length !== right.items.length)
        return { ok: true, value: false };
      for (let index = 0; index < left.items.length; index += 1) {
        const leftItem = left.items[index];
        const rightItem = right.items[index];
        if (leftItem === undefined || rightItem === undefined)
          return { ok: true, value: false };
        const equal = structuralEqual(leftItem, rightItem);
        if (!equal.ok || !equal.value) return equal;
      }
      return { ok: true, value: true };
    }
    case "syntax":
      return {
        ok: true,
        value:
          right.tag === "syntax" && normalizedNodeEqual(left.node, right.node),
      };
  }
}

function containsClosure(
  value: PelValue,
  seen: WeakSet<object> = new WeakSet<object>(),
): boolean {
  if (value.tag === "closure") return true;
  if (value.tag !== "pair" && value.tag !== "list") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (value.tag === "pair") return containsClosure(value.value, seen);
  return value.items.some((item) => containsClosure(item, seen));
}

export function pureBuiltin(
  name: string,
  args: Readonly<Record<string, PelValue>>,
  span: SourceSpan,
): Result<PelValue, PelDiagnostic> {
  switch (name) {
    case "+": {
      if (args.y === undefined && args.x?.tag === "list") {
        let total = 0;
        for (const item of args.x.items) {
          const operand = numberArgument(item, "x", span);
          if (!operand.ok) return operand;
          const next = checkedNumber(total + operand.value, span);
          if (!next.ok) return next;
          total = next.value.tag === "number" ? next.value.value : total;
        }
        return { ok: true, value: { tag: "number", value: total } };
      }
      return binaryNumbers(args, span, (x, y) => x + y);
    }
    case "-":
      return binaryNumbers(args, span, (x, y) => x - y);
    case "*":
      return binaryNumbers(args, span, (x, y) => x * y);
    case "/": {
      const denominator = numberArgument(args.y, "y", span);
      if (!denominator.ok) return denominator;
      if (denominator.value === 0)
        return failure(
          "PEL_NUMERIC_DOMAIN",
          span,
          "division by zero is outside the Pel numeric domain",
        );
      const numerator = numberArgument(args.x, "x", span);
      if (!numerator.ok) return numerator;
      return checkedNumber(numerator.value / denominator.value, span);
    }
    case "pow":
      return binaryNumbers(args, span, (x, y) => x ** y);
    case "gt": {
      const x = numberArgument(args.x, "x", span);
      if (!x.ok) return x;
      const y = numberArgument(args.y, "y", span);
      if (!y.ok) return y;
      return { ok: true, value: { tag: "boolean", value: x.value > y.value } };
    }
    case "lt": {
      const x = numberArgument(args.x, "x", span);
      if (!x.ok) return x;
      const y = numberArgument(args.y, "y", span);
      if (!y.ok) return y;
      return { ok: true, value: { tag: "boolean", value: x.value < y.value } };
    }
    case "sqrt": {
      const x = numberArgument(args.x, "x", span);
      if (!x.ok) return x;
      return checkedNumber(Math.sqrt(x.value), span);
    }
    case "concat": {
      if (args.x?.tag !== "string" || args.y?.tag !== "string") {
        return failure("PEL_TYPE", span, ":x and :y must be strings");
      }
      return {
        ok: true,
        value: { tag: "string", value: args.x.value + args.y.value },
      };
    }
    case "len": {
      const value = args.value;
      if (value?.tag === "list") return checkedNumber(value.items.length, span);
      if (value?.tag === "string")
        return checkedNumber([...value.value].length, span);
      return failure("PEL_TYPE", span, ":value must be a list or string");
    }
    case "not": {
      if (args.x?.tag !== "boolean")
        return failure("PEL_TYPE", span, ":x must be Boolean");
      return { ok: true, value: { tag: "boolean", value: !args.x.value } };
    }
    case "eq": {
      if (args.x === undefined || args.y === undefined)
        return failure("PEL_TYPE", span, "eq requires two Pel values");
      if (containsClosure(args.x) || containsClosure(args.y)) {
        return failure(
          "PEL_TYPE",
          span,
          "closures cannot be compared for equality",
        );
      }
      const equal = structuralEqual(args.x, args.y);
      if (!equal.ok)
        return failure(
          "PEL_TYPE",
          span,
          "closures cannot be compared for equality",
        );
      return { ok: true, value: { tag: "boolean", value: equal.value } };
    }
    default:
      return failure(
        "PEL_TYPE",
        span,
        `${JSON.stringify(name)} is not a pure builtin`,
      );
  }
}

function validatedIndex(
  value: PelValue,
  length: number,
  span: SourceSpan,
): Result<number, PelDiagnostic> {
  if (value.tag !== "number")
    return failure("PEL_TYPE", span, "list index must be a number");
  if (
    !Number.isSafeInteger(value.value) ||
    value.value < 1 ||
    value.value > length
  ) {
    return failure(
      "PEL_INDEX",
      span,
      `list index ${String(value.value)} is outside 1..${String(length)}`,
    );
  }
  return { ok: true, value: value.value - 1 };
}

function selectOne(
  items: readonly PelValue[],
  selector: PelValue,
  span: SourceSpan,
): Result<PelValue, PelDiagnostic> {
  if (selector.tag === "number") {
    const index = validatedIndex(selector, items.length, span);
    if (!index.ok) return index;
    const selected = items[index.value];
    return selected === undefined
      ? failure("PEL_INDEX", span, "list index did not select a value")
      : { ok: true, value: selected };
  }
  if (selector.tag === "key") {
    for (const item of items) {
      if (item.tag === "pair" && item.key === selector.name)
        return { ok: true, value: item.value };
    }
    return { ok: true, value: { tag: "nil" } };
  }
  return failure(
    "PEL_TYPE",
    span,
    ":at must be an integer, key, or list of integers and keys",
  );
}

export function callableList(
  items: readonly PelValue[],
  args: Readonly<Record<string, PelValue>>,
  span: SourceSpan,
): Result<PelValue, PelDiagnostic> {
  const at = args.at ?? { tag: "nil" };
  const from = args.from ?? { tag: "nil" };
  const to = args.to ?? { tag: "nil" };
  if (at.tag !== "nil" && (from.tag !== "nil" || to.tag !== "nil")) {
    return failure(
      "PEL_ARGUMENT_MODE",
      span,
      ":at cannot be combined with :from or :to",
    );
  }
  if (at.tag !== "nil") {
    if (at.tag === "list") {
      const selected: PelValue[] = [];
      for (const selector of at.items) {
        const result = selectOne(items, selector, span);
        if (!result.ok) return result;
        selected.push(result.value);
      }
      return { ok: true, value: { tag: "list", items: selected } };
    }
    return selectOne(items, at, span);
  }
  if (from.tag === "nil" && to.tag === "nil")
    return { ok: true, value: { tag: "list", items } };
  const first =
    from.tag === "nil"
      ? ({ ok: true, value: 0 } as const)
      : validatedIndex(from, items.length, span);
  if (!first.ok) return first;
  const last =
    to.tag === "nil"
      ? ({ ok: true, value: items.length - 1 } as const)
      : validatedIndex(to, items.length, span);
  if (!last.ok) return last;
  if (first.value > last.value)
    return { ok: true, value: { tag: "list", items: [] } };
  return {
    ok: true,
    value: { tag: "list", items: items.slice(first.value, last.value + 1) },
  };
}
