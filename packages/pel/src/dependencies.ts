import type { PelNode, PelProgram } from "./ast.js";

export interface ExpressionDependency {
  readonly index: number;
  readonly defines: readonly string[];
  readonly reads: readonly string[];
  readonly dependencies: readonly number[];
}

export interface DependencySummary {
  readonly expressions: readonly ExpressionDependency[];
  readonly cycles: readonly (readonly number[])[];
}

function directCall(
  node: PelNode,
  name: string,
): readonly PelNode[] | undefined {
  if (node.kind !== "call") return undefined;
  const callable = node.items[0];
  return callable?.kind === "symbol" && callable.name === name
    ? node.items.slice(1)
    : undefined;
}

function fixedCallArguments(
  node: PelNode,
  name: string,
  parameterNames: readonly string[],
): Readonly<Record<string, PelNode | undefined>> | undefined {
  const args = directCall(node, name);
  if (args === undefined) return undefined;
  const result: Record<string, PelNode | undefined> = Object.create(
    null,
  ) as Record<string, PelNode | undefined>;
  if (args.length !== 0 && args.every((argument) => argument.kind === "pair")) {
    for (const argument of args) {
      if (
        argument.kind === "pair" &&
        parameterNames.includes(argument.key) &&
        !Object.hasOwn(result, argument.key)
      ) {
        result[argument.key] = argument.value;
      }
    }
  } else {
    for (let index = 0; index < parameterNames.length; index += 1) {
      const parameterName = parameterNames[index];
      if (parameterName !== undefined) result[parameterName] = args[index];
    }
  }
  return result;
}

function directDefinition(
  node: PelNode,
): { readonly name: string; readonly value: PelNode | undefined } | undefined {
  const args = fixedCallArguments(node, "def", ["name", "value"]);
  if (args === undefined) return undefined;
  const binder = args.name;
  if (binder?.kind !== "symbol") return undefined;
  return { name: binder.name, value: args.value };
}

function lambdaParts(
  node: PelNode,
):
  | {
      readonly parameters: PelNode | undefined;
      readonly body: PelNode | undefined;
    }
  | undefined {
  const args = fixedCallArguments(node, "lambda", ["params", "body"]);
  return args === undefined
    ? undefined
    : { parameters: args.params, body: args.body };
}

function parameterNames(parameters: PelNode | undefined): ReadonlySet<string> {
  const names = new Set<string>();
  if (parameters?.kind !== "list") return names;
  for (const item of parameters.items) {
    if (item.kind === "pair") names.add(item.key);
  }
  return names;
}

function addRead(
  reads: string[],
  seen: Set<string>,
  name: string,
  bound: ReadonlySet<string>,
): void {
  if (!bound.has(name) && !seen.has(name)) {
    seen.add(name);
    reads.push(name);
  }
}

function blockNodes(args: readonly PelNode[]): readonly PelNode[] {
  if (args.length === 1 && args[0]?.kind === "list") return args[0].items;
  return args;
}

function collectFreeReads(
  node: PelNode,
  bound: ReadonlySet<string>,
  reads: string[],
  seen: Set<string>,
): void {
  switch (node.kind) {
    case "number":
    case "string":
    case "boolean":
    case "nil":
    case "key":
    case "caret":
    case "quote":
      return;
    case "symbol":
      addRead(reads, seen, node.name, bound);
      return;
    case "pair":
      if (node.valuePresent) collectFreeReads(node.value, bound, reads, seen);
      return;
    case "list":
      for (const item of node.items) collectFreeReads(item, bound, reads, seen);
      return;
    case "pipe":
      collectFreeReads(node.left, bound, reads, seen);
      collectFreeReads(node.right, bound, reads, seen);
      return;
    case "call":
      break;
  }

  const definition = directDefinition(node);
  if (definition !== undefined) {
    if (definition.value !== undefined)
      collectFreeReads(definition.value, bound, reads, seen);
    return;
  }

  const lambda = lambdaParts(node);
  if (lambda !== undefined) {
    if (lambda.parameters?.kind === "list") {
      for (const item of lambda.parameters.items) {
        if (item.kind === "pair" && item.valuePresent)
          collectFreeReads(item.value, bound, reads, seen);
      }
    }
    if (lambda.body !== undefined) {
      const lambdaBound = new Set(bound);
      for (const name of parameterNames(lambda.parameters))
        lambdaBound.add(name);
      collectFreeReads(lambda.body, lambdaBound, reads, seen);
    }
    return;
  }

  const forArgs = fixedCallArguments(node, "for", ["coll", "iterator", "body"]);
  if (forArgs !== undefined) {
    const collection = forArgs.coll;
    if (collection !== undefined)
      collectFreeReads(collection, bound, reads, seen);
    const body = forArgs.body;
    if (body !== undefined) {
      const bodyBound = new Set(bound);
      const iterator = forArgs.iterator;
      if (iterator?.kind === "symbol") bodyBound.add(iterator.name);
      collectFreeReads(body, bodyBound, reads, seen);
    }
    return;
  }

  const doArgs = directCall(node, "do") ?? directCall(node, "do/async");
  if (doArgs !== undefined) {
    const expressions = blockNodes(doArgs);
    const blockBound = new Set(bound);
    for (const expression of expressions) {
      const local = directDefinition(expression);
      if (local !== undefined) blockBound.add(local.name);
    }
    for (const expression of expressions)
      collectFreeReads(expression, blockBound, reads, seen);
    return;
  }

  for (const item of node.items) collectFreeReads(item, bound, reads, seen);
}

function readsForExpression(node: PelNode): readonly string[] {
  const reads: string[] = [];
  const seen = new Set<string>();
  const definition = directDefinition(node);
  if (definition === undefined) {
    collectFreeReads(node, new Set<string>(), reads, seen);
    return reads;
  }
  if (definition.value === undefined) return reads;
  const bound = new Set<string>();
  if (lambdaParts(definition.value) !== undefined) bound.add(definition.name);
  collectFreeReads(definition.value, bound, reads, seen);
  return reads;
}

function findCycles(
  expressions: readonly ExpressionDependency[],
): readonly (readonly number[])[] {
  let nextIndex = 0;
  const indices = new Map<number, number>();
  const lowLinks = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const cycles: number[][] = [];

  const visit = (vertex: number): void => {
    indices.set(vertex, nextIndex);
    lowLinks.set(vertex, nextIndex);
    nextIndex += 1;
    stack.push(vertex);
    onStack.add(vertex);

    for (const dependency of expressions[vertex]?.dependencies ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lowLinks.set(
          vertex,
          Math.min(lowLinks.get(vertex) ?? 0, lowLinks.get(dependency) ?? 0),
        );
      } else if (onStack.has(dependency)) {
        lowLinks.set(
          vertex,
          Math.min(lowLinks.get(vertex) ?? 0, indices.get(dependency) ?? 0),
        );
      }
    }

    if (lowLinks.get(vertex) !== indices.get(vertex)) return;
    const component: number[] = [];
    while (stack.length !== 0) {
      const member = stack.pop();
      if (member === undefined) break;
      onStack.delete(member);
      component.push(member);
      if (member === vertex) break;
    }
    component.sort((left, right) => left - right);
    if (component.length > 1) cycles.push(component);
  };

  for (let vertex = 0; vertex < expressions.length; vertex += 1) {
    if (!indices.has(vertex)) visit(vertex);
  }
  cycles.sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
  return cycles;
}

export function analyzeSequence(nodes: readonly PelNode[]): DependencySummary {
  const firstDefinition = new Map<string, number>();
  const definitions = nodes.map((node, index) => {
    const definition = directDefinition(node);
    const names = definition === undefined ? [] : [definition.name];
    for (const name of names)
      if (!firstDefinition.has(name)) firstDefinition.set(name, index);
    return names;
  });

  const expressions: ExpressionDependency[] = nodes.map((node, index) => {
    const reads = readsForExpression(node);
    const dependencies = [
      ...new Set(
        reads.flatMap((name) => {
          const source = firstDefinition.get(name);
          return source === undefined || source === index ? [] : [source];
        }),
      ),
    ].sort((left, right) => left - right);
    return { index, defines: definitions[index] ?? [], reads, dependencies };
  });
  return { expressions, cycles: findCycles(expressions) };
}

export function analyzeDependencies(program: PelProgram): DependencySummary {
  return analyzeSequence(program.expressions);
}
