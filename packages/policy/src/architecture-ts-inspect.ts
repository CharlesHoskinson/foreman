/**
 * TypeScript source inspection for Bun-only and Deno-only APIs.
 *
 * Uses the exact-pinned @babel/parser TypeScript plugin. Walks the AST with
 * explicit value-vs-type classification (not a blind `startsWith("TS")` skip):
 *
 * - Pure type-only nodes are skipped entirely (no false positives on type names).
 * - Value-bearing TS wrappers (as / assertion / non-null / satisfies /
 *   instantiation) traverse their expression/value fields in value position.
 * - Runtime namespaces, enum initializers, export assignments, and import-equals
 *   are inspected.
 * - Unsupported unclassified TS nodes fail closed as schema_mismatch.
 *
 * Lexical scope: free global Bun/Deno and their aliases are prohibited; ordinary
 * locals, parameters, property keys, and free-require shadowing are allowed.
 * `var` hoists to the enclosing function/program. Ambient `declare` creates no
 * safe value binding. Named class/function expressions bind self-names.
 */

import { parse } from "@babel/parser";
import type { PolicyReason } from "./architecture-schema.js";

const BUN_MODULES = new Set([
  "bun",
  "bun:ffi",
  "bun:jsc",
  "bun:sqlite",
  "bun:test",
  "bun:wrap",
]);

type RuntimeTag = "Bun" | "Deno";

type BabelNode = {
  readonly type: string;
  readonly [key: string]: unknown;
};

type Scope = {
  readonly bindings: Set<string>;
  readonly runtimeAliases: Map<string, RuntimeTag>;
  readonly isVarHost: boolean;
};

/** TS nodes that wrap a runtime expression (value field is `expression`). */
const VALUE_TS_WRAPPERS = new Set([
  "TSAsExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSSatisfiesExpression",
  "TSInstantiationExpression",
]);

/**
 * Pure type-only TS nodes: no runtime evaluation. Entire subtree skipped.
 * Anything starting with TS that is not value-bearing and not listed here is
 * treated as unclassified and fails closed.
 */
const PURE_TYPE_TS_NODES = new Set([
  "TSTypeAnnotation",
  "TSTypeParameterInstantiation",
  "TSTypeParameterDeclaration",
  "TSTypeParameter",
  "TSTypeReference",
  "TSTypeLiteral",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSInterfaceBody",
  "TSExpressionWithTypeArguments",
  "TSTypeQuery",
  "TSIndexedAccessType",
  "TSMappedType",
  "TSLiteralType",
  "TSUnionType",
  "TSIntersectionType",
  "TSConditionalType",
  "TSInferType",
  "TSParenthesizedType",
  "TSFunctionType",
  "TSConstructorType",
  "TSTupleType",
  "TSNamedTupleMember",
  "TSRestType",
  "TSOptionalType",
  "TSArrayType",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSImportType",
  "TSThisType",
  "TSAnyKeyword",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSIntrinsicKeyword",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSUndefinedKeyword",
  "TSUnknownKeyword",
  "TSVoidKeyword",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSCallSignatureDeclaration",
  "TSConstructSignatureDeclaration",
  "TSIndexSignature",
  "TSQualifiedName",
]);

/** Value-bearing TS constructs that must be walked (not pure types). */
const VALUE_TS_NODES = new Set([
  ...VALUE_TS_WRAPPERS,
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSEnumDeclaration",
  "TSEnumMember",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
  "TSParameterProperty",
  "TSDeclareFunction",
  "TSDeclareMethod",
]);

function isNode(v: unknown): v is BabelNode {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as BabelNode).type === "string"
  );
}

function isBunModule(spec: string): boolean {
  if (BUN_MODULES.has(spec)) return true;
  return spec.startsWith("bun:");
}

function isDenoModule(spec: string): boolean {
  if (spec === "deno" || spec.startsWith("deno:")) return true;
  if (
    spec.startsWith("https://deno.land/") ||
    spec.startsWith("https://jsr.io/")
  ) {
    return true;
  }
  return false;
}

function stringLiteralValue(node: BabelNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node.type === "TemplateLiteral" &&
    Array.isArray(node.expressions) &&
    (node.expressions as unknown[]).length === 0 &&
    Array.isArray(node.quasis) &&
    (node.quasis as unknown[]).length === 1
  ) {
    const q = (node.quasis as BabelNode[])[0];
    if (q && typeof q === "object" && q !== null) {
      const val = (q as { value?: { cooked?: unknown; raw?: unknown } }).value;
      if (val && typeof val.cooked === "string") return val.cooked;
      if (val && typeof val.raw === "string") return val.raw;
    }
  }
  return null;
}

function moduleSpecFromSource(source: unknown): string | null {
  if (!isNode(source)) return null;
  return stringLiteralValue(source);
}

function identifierName(node: BabelNode | null | undefined): string | null {
  if (!node || node.type !== "Identifier") return null;
  return typeof node.name === "string" ? node.name : null;
}

/**
 * Classify a TS node type. Returns:
 * - "pure-type" — skip subtree
 * - "value" — walk in value-aware mode
 * - "unknown-ts" — fail closed
 * - "non-ts" — ordinary JS node
 */
function classifyTsNode(
  type: string,
): "pure-type" | "value" | "unknown-ts" | "non-ts" {
  if (!type.startsWith("TS")) return "non-ts";
  if (PURE_TYPE_TS_NODES.has(type)) return "pure-type";
  if (VALUE_TS_NODES.has(type)) return "value";
  return "unknown-ts";
}

/** Whether a child field is type-only given the parent node type. */
function childFieldIsTypeOnly(parentType: string, key: string): boolean {
  if (
    key === "typeAnnotation" ||
    key === "typeParameters" ||
    key === "returnType" ||
    key === "superTypeParameters" ||
    key === "implements" ||
    key === "typeParameter"
  ) {
    return true;
  }
  if (VALUE_TS_WRAPPERS.has(parentType)) {
    // expression is value; typeAnnotation is type
    return key !== "expression";
  }
  if (parentType === "TSExportAssignment") return key !== "expression";
  if (parentType === "TSEnumMember") return key !== "initializer" && key !== "id";
  if (parentType === "TSModuleDeclaration") return key === "id";
  if (parentType === "TSExternalModuleReference") return false;
  if (parentType === "TSImportEqualsDeclaration") {
    return key !== "moduleReference" && key !== "id";
  }
  if (parentType === "TSParameterProperty") return key !== "parameter";
  return false;
}

function isOrdinaryBinding(
  name: string,
  scopes: readonly Scope[],
): boolean {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (scopes[i]!.bindings.has(name)) return true;
  }
  return false;
}

function resolveName(
  name: string,
  scopes: readonly Scope[],
): RuntimeTag | null {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    const scope = scopes[i]!;
    if (scope.bindings.has(name)) {
      return scope.runtimeAliases.get(name) ?? null;
    }
  }
  if (name === "Bun" || name === "Deno") return name;
  return null;
}

/** Unwrap value-bearing TS wrappers and parentheses. */
function unwrapValueExpr(
  node: BabelNode | null | undefined,
): BabelNode | null {
  let cur = node ?? null;
  while (cur) {
    if (
      VALUE_TS_WRAPPERS.has(cur.type) ||
      cur.type === "ParenthesizedExpression"
    ) {
      cur = isNode(cur.expression) ? cur.expression : null;
      continue;
    }
    break;
  }
  return cur;
}

function memberPropertyName(node: BabelNode): string | null {
  if (!isNode(node.property)) return null;
  if (node.computed !== true) {
    return identifierName(node.property);
  }
  return stringLiteralValue(node.property);
}

/**
 * Free globalThis.Bun / globalThis.Deno after unwrapping object wrappers.
 */
function globalThisRuntimeProperty(
  node: BabelNode,
  scopes: readonly Scope[],
): RuntimeTag | null {
  if (
    node.type !== "MemberExpression" &&
    node.type !== "OptionalMemberExpression"
  ) {
    return null;
  }
  const obj = unwrapValueExpr(isNode(node.object) ? node.object : null);
  if (!obj || obj.type !== "Identifier") return null;
  if (identifierName(obj) !== "globalThis") return null;
  if (isOrdinaryBinding("globalThis", scopes)) return null;
  const prop = memberPropertyName(node);
  if (prop === "Bun" || prop === "Deno") return prop;
  return null;
}

function resolveExpression(
  node: BabelNode | null | undefined,
  scopes: readonly Scope[],
): RuntimeTag | null {
  if (!node) return null;
  const unwrapped = unwrapValueExpr(node);
  if (!unwrapped) return null;
  if (unwrapped.type === "Identifier") {
    const name = identifierName(unwrapped);
    if (name === null) return null;
    return resolveName(name, scopes);
  }
  if (
    unwrapped.type === "MemberExpression" ||
    unwrapped.type === "OptionalMemberExpression"
  ) {
    const g = globalThisRuntimeProperty(unwrapped, scopes);
    if (g) return g;
    return resolveExpression(
      isNode(unwrapped.object) ? unwrapped.object : null,
      scopes,
    );
  }
  return null;
}

function addBinding(scope: Scope, name: string): void {
  scope.bindings.add(name);
}

function bindPattern(node: BabelNode, scope: Scope): void {
  if (node.type === "Identifier") {
    const name = identifierName(node);
    if (name) addBinding(scope, name);
    return;
  }
  if (node.type === "AssignmentPattern" && isNode(node.left)) {
    bindPattern(node.left, scope);
    return;
  }
  if (node.type === "RestElement" && isNode(node.argument)) {
    bindPattern(node.argument, scope);
    return;
  }
  if (node.type === "ObjectPattern" && Array.isArray(node.properties)) {
    for (const p of node.properties) {
      if (!isNode(p)) continue;
      if (p.type === "RestElement" && isNode(p.argument)) {
        bindPattern(p.argument, scope);
      } else if (p.type === "ObjectProperty" && isNode(p.value)) {
        bindPattern(p.value, scope);
      }
    }
    return;
  }
  if (node.type === "ArrayPattern" && Array.isArray(node.elements)) {
    for (const el of node.elements) {
      if (isNode(el)) bindPattern(el, scope);
    }
  }
  if (node.type === "TSParameterProperty" && isNode(node.parameter)) {
    bindPattern(node.parameter, scope);
  }
}

function pushScope(scopes: Scope[], isVarHost: boolean): Scope {
  const s: Scope = {
    bindings: new Set(),
    runtimeAliases: new Map(),
    isVarHost,
  };
  scopes.push(s);
  return s;
}

function popScope(scopes: Scope[]): void {
  scopes.pop();
}

function varHostScope(scopes: readonly Scope[]): Scope {
  for (let i = scopes.length - 1; i >= 0; i -= 1) {
    if (scopes[i]!.isVarHost) return scopes[i]!;
  }
  return scopes[0]!;
}

function isFunctionLike(type: string): boolean {
  return (
    type === "FunctionDeclaration" ||
    type === "FunctionExpression" ||
    type === "ArrowFunctionExpression" ||
    type === "ClassMethod" ||
    type === "ClassPrivateMethod" ||
    type === "ObjectMethod" ||
    type === "TSDeclareFunction" ||
    type === "TSDeclareMethod"
  );
}

function isAmbientDeclaration(node: BabelNode): boolean {
  return node.declare === true;
}

function collectHoistedBindings(
  node: BabelNode,
  blockScope: Scope,
  scopes: readonly Scope[],
): void {
  // Unwrap export wrappers
  if (
    (node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration") &&
    isNode(node.declaration)
  ) {
    collectHoistedBindings(node.declaration, blockScope, scopes);
    return;
  }
  if (isAmbientDeclaration(node)) {
    return;
  }
  if (node.type === "FunctionDeclaration" && isNode(node.id)) {
    const name = identifierName(node.id);
    if (name) addBinding(varHostScope(scopes), name);
    return;
  }
  if (node.type === "ClassDeclaration" && isNode(node.id)) {
    const name = identifierName(node.id);
    if (name) addBinding(blockScope, name);
    return;
  }
  if (
    node.type === "VariableDeclaration" &&
    Array.isArray(node.declarations)
  ) {
    const kind = typeof node.kind === "string" ? node.kind : "const";
    const target = kind === "var" ? varHostScope(scopes) : blockScope;
    for (const d of node.declarations) {
      if (isNode(d) && isNode(d.id)) bindPattern(d.id, target);
    }
    return;
  }
  if (node.type === "ImportDeclaration" && Array.isArray(node.specifiers)) {
    for (const sp of node.specifiers) {
      if (!isNode(sp)) continue;
      const local = isNode(sp.local) ? identifierName(sp.local) : null;
      if (local) addBinding(blockScope, local);
    }
    return;
  }
  if (node.type === "TSImportEqualsDeclaration" && isNode(node.id)) {
    const local = identifierName(node.id);
    if (local) addBinding(blockScope, local);
  }
}

function walkScoped(root: BabelNode): PolicyReason | null {
  let found: PolicyReason | null = null;
  const scopes: Scope[] = [];
  pushScope(scopes, true);

  const visit = (
    node: BabelNode,
    parent: BabelNode | null,
    inTypePosition: boolean,
  ): void => {
    if (found !== null) return;

    const tsClass = classifyTsNode(node.type);
    if (tsClass === "unknown-ts") {
      found = "schema_mismatch";
      return;
    }
    if (tsClass === "pure-type" || inTypePosition) {
      // Pure type subtree: do not flag type names as free globals
      return;
    }

    // import / export ... from "mod"
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      isNode(node.source)
    ) {
      const spec = moduleSpecFromSource(node.source);
      if (spec !== null) {
        if (isBunModule(spec)) {
          found = "prohibited_bun_only";
          return;
        }
        if (isDenoModule(spec)) {
          found = "prohibited_deno_only";
          return;
        }
      }
    }

    // import X = require("mod")
    if (node.type === "TSImportEqualsDeclaration") {
      const ref = isNode(node.moduleReference) ? node.moduleReference : null;
      if (
        ref &&
        ref.type === "TSExternalModuleReference" &&
        isNode(ref.expression)
      ) {
        const spec = moduleSpecFromSource(ref.expression);
        if (spec !== null) {
          if (isBunModule(spec)) {
            found = "prohibited_bun_only";
            return;
          }
          if (isDenoModule(spec)) {
            found = "prohibited_deno_only";
            return;
          }
        }
      }
    }

    // export = expr
    // (expression walked as child; Identifier Bun flagged below)

    // import("mod")
    if (node.type === "ImportExpression" && isNode(node.source)) {
      const spec = moduleSpecFromSource(node.source);
      if (spec !== null) {
        if (isBunModule(spec)) {
          found = "prohibited_bun_only";
          return;
        }
        if (isDenoModule(spec)) {
          found = "prohibited_deno_only";
          return;
        }
      }
    }
    if (
      node.type === "CallExpression" &&
      isNode(node.callee) &&
      node.callee.type === "Import" &&
      Array.isArray(node.arguments) &&
      node.arguments.length > 0 &&
      isNode((node.arguments as unknown[])[0])
    ) {
      const spec = moduleSpecFromSource((node.arguments as BabelNode[])[0]!);
      if (spec !== null) {
        if (isBunModule(spec)) {
          found = "prohibited_bun_only";
          return;
        }
        if (isDenoModule(spec)) {
          found = "prohibited_deno_only";
          return;
        }
      }
    }
    // Free require("mod") only — local parameter/var named require is allowed
    if (
      node.type === "CallExpression" &&
      isNode(node.callee) &&
      node.callee.type === "Identifier" &&
      identifierName(node.callee) === "require" &&
      !isOrdinaryBinding("require", scopes) &&
      Array.isArray(node.arguments) &&
      node.arguments.length > 0 &&
      isNode((node.arguments as unknown[])[0])
    ) {
      const spec = moduleSpecFromSource((node.arguments as BabelNode[])[0]!);
      if (spec !== null) {
        if (isBunModule(spec)) {
          found = "prohibited_bun_only";
          return;
        }
        if (isDenoModule(spec)) {
          found = "prohibited_deno_only";
          return;
        }
      }
    }

    // globalThis.Bun / globalThis.Deno (after wrappers on object)
    if (
      node.type === "MemberExpression" ||
      node.type === "OptionalMemberExpression"
    ) {
      const g = globalThisRuntimeProperty(node, scopes);
      if (g !== null) {
        found = g === "Bun" ? "prohibited_bun_only" : "prohibited_deno_only";
        return;
      }
    }

    // Free global / runtime-alias identifier in value position
    if (node.type === "Identifier") {
      const name = identifierName(node);
      if (name !== null) {
        const isStaticKey =
          parent !== null &&
          (parent.type === "ObjectProperty" ||
            parent.type === "ObjectMethod" ||
            parent.type === "ClassMethod" ||
            parent.type === "ClassProperty" ||
            parent.type === "ClassPrivateProperty" ||
            parent.type === "TSPropertySignature" ||
            parent.type === "TSMethodSignature" ||
            parent.type === "TSEnumMember") &&
          parent.key === node &&
          parent.computed !== true;

        const isMemberProperty =
          parent !== null &&
          (parent.type === "MemberExpression" ||
            parent.type === "OptionalMemberExpression") &&
          parent.property === node &&
          parent.computed !== true;

        const isImportExportName =
          parent !== null &&
          (parent.type === "ImportSpecifier" ||
            parent.type === "ImportDefaultSpecifier" ||
            parent.type === "ImportNamespaceSpecifier" ||
            parent.type === "ExportSpecifier" ||
            parent.type === "TSImportEqualsDeclaration") &&
          (parent.local === node ||
            parent.imported === node ||
            parent.exported === node ||
            parent.id === node);

        const isDeclId =
          parent !== null &&
          ((parent.type === "VariableDeclarator" && parent.id === node) ||
            (parent.type === "FunctionDeclaration" && parent.id === node) ||
            (parent.type === "FunctionExpression" && parent.id === node) ||
            (parent.type === "ClassDeclaration" && parent.id === node) ||
            (parent.type === "ClassExpression" && parent.id === node) ||
            (parent.type === "CatchClause" && parent.param === node) ||
            (parent.type === "TSEnumDeclaration" && parent.id === node) ||
            (parent.type === "TSEnumMember" && parent.id === node) ||
            (parent.type === "TSModuleDeclaration" && parent.id === node));

        if (
          !isStaticKey &&
          !isMemberProperty &&
          !isImportExportName &&
          !isDeclId
        ) {
          const tag = resolveName(name, scopes);
          if (tag !== null) {
            found =
              tag === "Bun" ? "prohibited_bun_only" : "prohibited_deno_only";
            return;
          }
        }
      }
    }

    if (node.type === "RegExpLiteral") return;
    if (node.type === "StringLiteral" || node.type === "DirectiveLiteral") {
      return;
    }
    if (node.type === "TemplateElement") return;

    const isBlockScope =
      node.type === "BlockStatement" ||
      node.type === "ForStatement" ||
      node.type === "ForInStatement" ||
      node.type === "ForOfStatement" ||
      node.type === "SwitchStatement" ||
      node.type === "CatchClause" ||
      node.type === "TSModuleBlock";

    const isFunction = isFunctionLike(node.type);
    const isClass =
      node.type === "ClassExpression" || node.type === "ClassDeclaration";
    let entered = false;

    if (isFunction) {
      pushScope(scopes, true);
      entered = true;
      const fnScope = scopes[scopes.length - 1]!;
      if (
        (node.type === "FunctionExpression" ||
          node.type === "ClassExpression") &&
        isNode(node.id)
      ) {
        const n = identifierName(node.id);
        if (n) addBinding(fnScope, n);
      }
      if (Array.isArray(node.params)) {
        for (const p of node.params) {
          if (isNode(p)) bindPattern(p, fnScope);
        }
      }
    } else if (isClass) {
      // Class body scope; named class expression binds self-name here.
      pushScope(scopes, false);
      entered = true;
      const classScope = scopes[scopes.length - 1]!;
      if (node.type === "ClassExpression" && isNode(node.id)) {
        const n = identifierName(node.id);
        if (n) addBinding(classScope, n);
      }
    } else if (isBlockScope) {
      pushScope(scopes, false);
      entered = true;
      const blockScope = scopes[scopes.length - 1]!;
      if (node.type === "CatchClause" && isNode(node.param)) {
        bindPattern(node.param, blockScope);
      }
      if (
        (node.type === "BlockStatement" || node.type === "TSModuleBlock") &&
        Array.isArray(node.body)
      ) {
        for (const stmt of node.body) {
          if (isNode(stmt)) {
            collectHoistedBindings(stmt, blockScope, scopes);
          }
        }
      }
    } else if (node.type === "Program" && Array.isArray(node.body)) {
      const mod = scopes[scopes.length - 1]!;
      for (const stmt of node.body) {
        if (isNode(stmt)) collectHoistedBindings(stmt, mod, scopes);
      }
    } else if (node.type === "TSModuleDeclaration") {
      // Namespace body is a TSModuleBlock; id is type-ish for binding
      // Nested namespaces handled when body is visited
    }

    // Variable declarators
    if (
      node.type === "VariableDeclarator" &&
      isNode(node.id) &&
      parent !== null &&
      parent.type === "VariableDeclaration" &&
      !isAmbientDeclaration(parent)
    ) {
      const kind = typeof parent.kind === "string" ? parent.kind : "const";
      const target =
        kind === "var" ? varHostScope(scopes) : scopes[scopes.length - 1]!;
      bindPattern(node.id, target);
      if (node.id.type === "Identifier" && isNode(node.init)) {
        const name = identifierName(node.id);
        if (name) {
          const tag = resolveExpression(node.init, scopes);
          if (tag !== null) {
            target.runtimeAliases.set(name, tag);
          }
        }
      }
    }

    if (
      node.type === "ImportDeclaration" &&
      isNode(node.source) &&
      Array.isArray(node.specifiers)
    ) {
      const spec = moduleSpecFromSource(node.source);
      if (spec !== null) {
        let tag: RuntimeTag | null = null;
        if (isBunModule(spec)) tag = "Bun";
        else if (isDenoModule(spec)) tag = "Deno";
        if (tag) {
          const cur = scopes[scopes.length - 1]!;
          for (const sp of node.specifiers) {
            if (!isNode(sp)) continue;
            const local = isNode(sp.local) ? identifierName(sp.local) : null;
            if (local) {
              addBinding(cur, local);
              cur.runtimeAliases.set(local, tag);
            }
          }
        }
      }
    }

    if (node.type === "TSImportEqualsDeclaration" && isNode(node.id)) {
      const local = identifierName(node.id);
      const ref = isNode(node.moduleReference) ? node.moduleReference : null;
      if (local && ref && ref.type === "TSExternalModuleReference") {
        const spec = moduleSpecFromSource(ref.expression);
        if (spec !== null) {
          let tag: RuntimeTag | null = null;
          if (isBunModule(spec)) tag = "Bun";
          else if (isDenoModule(spec)) tag = "Deno";
          if (tag) {
            const cur = scopes[scopes.length - 1]!;
            addBinding(cur, local);
            cur.runtimeAliases.set(local, tag);
          }
        }
      }
    }

    if (
      node.type === "AssignmentPattern" &&
      isNode(node.left) &&
      isNode(node.right) &&
      node.left.type === "Identifier"
    ) {
      const name = identifierName(node.left);
      if (name) {
        const tag = resolveExpression(node.right, scopes);
        if (tag !== null) {
          const cur = scopes[scopes.length - 1]!;
          cur.runtimeAliases.set(name, tag);
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (
        key === "type" ||
        key === "loc" ||
        key === "start" ||
        key === "end" ||
        key === "range" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments" ||
        key === "errors"
      ) {
        continue;
      }
      const childTypePos = childFieldIsTypeOnly(node.type, key);
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (isNode(c)) visit(c, node, childTypePos);
          if (found !== null) {
            if (entered) popScope(scopes);
            return;
          }
        }
      } else if (isNode(child)) {
        visit(child, node, childTypePos);
        if (found !== null) {
          if (entered) popScope(scopes);
          return;
        }
      }
    }

    if (entered) popScope(scopes);
  };

  visit(root, null, false);
  return found;
}

export function inspectTypeScriptSource(
  fileName: string,
  sourceText: string,
): PolicyReason | null {
  let ast: BabelNode;
  try {
    const isTsx = fileName.endsWith(".tsx") || fileName.endsWith(".jsx");
    const parsed = parse(sourceText, {
      sourceType: "module",
      sourceFilename: fileName,
      plugins: isTsx
        ? (["typescript", "jsx"] as const)
        : (["typescript"] as const),
      errorRecovery: false,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: false,
      attachComment: false,
      ranges: false,
      tokens: false,
    });
    ast = parsed as unknown as BabelNode;
  } catch {
    return "schema_mismatch";
  }

  const program = isNode(ast.program) ? ast.program : ast;
  return walkScoped(program);
}
