import type { PelNode, SourceSpan } from "./ast.js";
import { diagnostic, type PelDiagnostic } from "./diagnostics.js";
import type { PelClosureValue, Result } from "./types.js";

export interface PlannedArgument {
  readonly name: string;
  readonly node: PelNode;
  readonly evaluation: "strict" | "syntax";
}

function argumentFailure(
  code: "PEL_ARGUMENT_MODE" | "PEL_ARGUMENT_NAME" | "PEL_ARITY",
  span: SourceSpan,
  message: string,
): Result<never, PelDiagnostic> {
  return { ok: false, error: diagnostic(code, span, message) };
}

export function planArguments(
  closure: PelClosureValue,
  args: readonly PelNode[],
  span: SourceSpan,
): Result<readonly PlannedArgument[], PelDiagnostic> {
  if (closure.argSpec.kind === "sequence") {
    return argumentFailure(
      "PEL_ARGUMENT_MODE",
      span,
      "sequence arguments are evaluated by their sequence builtin",
    );
  }

  const namedCount = args.reduce(
    (count, node) => count + (node.kind === "pair" ? 1 : 0),
    0,
  );
  if (namedCount !== 0 && namedCount !== args.length) {
    return argumentFailure(
      "PEL_ARGUMENT_MODE",
      span,
      "a call cannot mix named and positional arguments",
    );
  }

  const parameters = closure.argSpec.parameters;
  if (namedCount !== 0) {
    const parametersByName = new Map(
      parameters.map((entry) => [entry.name, entry] as const),
    );
    const seen = new Set<string>();
    const planned: PlannedArgument[] = [];
    for (const argument of args) {
      if (argument.kind !== "pair") continue;
      const declared = parametersByName.get(argument.key);
      if (declared === undefined) {
        return argumentFailure(
          "PEL_ARGUMENT_NAME",
          span,
          `unknown argument name :${argument.key}`,
        );
      }
      if (seen.has(argument.key)) {
        return argumentFailure(
          "PEL_ARGUMENT_NAME",
          span,
          `duplicate argument name :${argument.key}`,
        );
      }
      if (Object.hasOwn(closure.boundArguments, argument.key)) {
        return argumentFailure(
          "PEL_ARGUMENT_NAME",
          span,
          `argument :${argument.key} is already bound`,
        );
      }
      seen.add(argument.key);
      planned.push({
        name: argument.key,
        node: argument.value,
        evaluation: declared.evaluation,
      });
    }
    return { ok: true, value: planned };
  }

  const remaining = parameters.filter(
    (entry) => !Object.hasOwn(closure.boundArguments, entry.name),
  );
  if (args.length > remaining.length) {
    return argumentFailure(
      "PEL_ARITY",
      span,
      `call supplies ${String(args.length)} positional arguments for ${String(remaining.length)} remaining parameters`,
    );
  }
  return {
    ok: true,
    value: args.map((node, index) => {
      const declared = remaining[index];
      if (declared === undefined)
        throw new Error("unreachable positional argument plan");
      return { name: declared.name, node, evaluation: declared.evaluation };
    }),
  };
}
