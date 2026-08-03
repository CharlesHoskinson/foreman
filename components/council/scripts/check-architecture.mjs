import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { extname, join, relative } from "node:path";
import globals from "globals";
import ts from "typescript";

const roots = {
  schema: "packages/schema/src",
  domain: "packages/domain/src",
  application: "packages/application/src",
  "application-test": "packages/application/test",
  "platform-node": "packages/platform-node/src",
  "adapter-grok": "packages/adapter-grok/src",
};

const pureLayers = new Set([
  "schema",
  "domain",
  "application",
  "application-test",
  "adapter-grok",
]);

const executableExtensions = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const scriptKind = (file) => {
  switch (extname(file)) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".tsx":
      return ts.ScriptKind.TSX;
    default:
      return ts.ScriptKind.TS;
  }
};

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
};

const bareBuiltinRoots = new Set(
  builtinModules
    .filter((specifier) => !specifier.startsWith("node:"))
    .map((specifier) => specifier.split("/")[0]),
);

const isNodeBuiltin = (specifier) =>
  specifier.startsWith("node:") ||
  bareBuiltinRoots.has(specifier.split("/")[0]);

const isEffectModule = (specifier) =>
  specifier === "effect" || specifier.startsWith("effect/");

const councilPackage = (specifier) => /^@council\/[^/]+/.exec(specifier)?.[0];

const isForbiddenDomainLayer = (specifier) => {
  const packageName = councilPackage(specifier);
  return (
    packageName === "@council/application" ||
    packageName === "@council/platform-node" ||
    packageName === "@council/runtime-node" ||
    packageName === "@council/mcp-server" ||
    packageName?.startsWith("@council/adapter-") === true
  );
};

const isForbiddenApplicationLayer = (specifier) => {
  const packageName = councilPackage(specifier);
  return (
    packageName === "@council/platform-node" ||
    packageName === "@council/runtime-node" ||
    packageName === "@council/mcp-server" ||
    packageName?.startsWith("@council/adapter-") === true
  );
};

const isForbiddenPlatformLayer = (specifier) => {
  const packageName = councilPackage(specifier);
  return (
    packageName === "@council/domain" ||
    packageName === "@council/runtime-node" ||
    packageName === "@council/mcp-server" ||
    packageName?.startsWith("@council/adapter-") === true
  );
};

const isForbiddenAdapterLayer = (specifier) => {
  const packageName = councilPackage(specifier);
  return (
    packageName === "@council/domain" ||
    packageName === "@council/platform-node" ||
    packageName === "@council/runtime-node" ||
    packageName === "@council/mcp-server" ||
    (packageName?.startsWith("@council/adapter-") === true &&
      packageName !== "@council/adapter-grok")
  );
};

const runtimeGlobals = new Set([
  ...Object.keys(globals.node).filter((name) => !(name in globals.es2024)),
  "globalThis",
]);

const isDeclarationOrPropertyName = (node) => {
  const parent = node.parent;
  if (parent === undefined) return false;
  if (
    ts.isTypeNode(parent) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isPropertyAccessChain(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.propertyName === node)
  ) {
    return true;
  }
  return (
    "name" in parent &&
    parent.name === node &&
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isImportClause(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isImportEqualsDeclaration(parent))
  );
};

const inspectSource = (file, source) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const specifiers = [];
  const sourceViolations = [];

  const addStringLiteral = (node) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
      return true;
    }
    return false;
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      if (!addStringLiteral(node.arguments[0])) {
        sourceViolations.push("nonliteral-dynamic-import");
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "require"
    ) {
      sourceViolations.push("direct-require");
      addStringLiteral(node.arguments[0]);
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      ((ts.isIdentifier(node.expression) &&
        node.expression.text === "Date" &&
        node.name.text === "now") ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "Math" &&
          node.name.text === "random"))
    ) {
      sourceViolations.push(
        `runtime-access ${node.expression.text}.${node.name.text}`,
      );
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (node.expression.text === "Date" || node.expression.text === "Math")
    ) {
      const member = node.argumentExpression;
      if (
        ts.isStringLiteralLike(member) &&
        ((node.expression.text === "Date" && member.text === "now") ||
          (node.expression.text === "Math" && member.text === "random"))
      ) {
        sourceViolations.push(
          `runtime-access ${node.expression.text}.${member.text}`,
        );
      } else if (!ts.isStringLiteralLike(member)) {
        sourceViolations.push(
          `runtime-access ${node.expression.text}[computed]`,
        );
      }
    }

    if (
      ts.isIdentifier(node) &&
      runtimeGlobals.has(node.text) &&
      !isDeclarationOrPropertyName(node)
    ) {
      sourceViolations.push(`runtime-global ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { specifiers, sourceViolations };
};

const violations = [];
for (const [layer, root] of Object.entries(roots)) {
  // application-test reuses the application import rules and labels.
  const ruleLayer = layer === "application-test" ? "application" : layer;
  for (const file of await walk(root)) {
    if (!executableExtensions.has(extname(file))) continue;
    const source = await readFile(file, "utf8");
    const inspection = inspectSource(file, source);
    if (pureLayers.has(layer)) {
      for (const violation of inspection.sourceViolations) {
        violations.push(`${relative(".", file)}: ${ruleLayer}-${violation}`);
      }
    } else {
      // platform-node: still ban nonliteral dynamic import / direct require
      // for consistency, but allow Node globals.
      for (const violation of inspection.sourceViolations) {
        if (
          violation === "nonliteral-dynamic-import" ||
          violation === "direct-require"
        ) {
          violations.push(`${relative(".", file)}: ${ruleLayer}-${violation}`);
        }
      }
    }
    for (const specifier of inspection.specifiers) {
      if (ruleLayer === "schema") {
        if (
          isNodeBuiltin(specifier) ||
          (isEffectModule(specifier) && specifier !== "effect/Schema")
        ) {
          violations.push(
            relative(".", file) + ": schema-runtime-import " + specifier,
          );
        } else {
          const packageName = councilPackage(specifier);
          if (packageName !== undefined && packageName !== "@council/schema") {
            violations.push(
              relative(".", file) + ": schema-layer-import " + specifier,
            );
          }
        }
      }
      if (ruleLayer === "domain") {
        if (isNodeBuiltin(specifier) || isEffectModule(specifier)) {
          violations.push(
            relative(".", file) + ": domain-runtime-import " + specifier,
          );
        } else if (isForbiddenDomainLayer(specifier)) {
          violations.push(
            relative(".", file) + ": domain-layer-import " + specifier,
          );
        }
      }
      if (ruleLayer === "application") {
        if (isNodeBuiltin(specifier)) {
          violations.push(
            relative(".", file) + ": application-runtime-import " + specifier,
          );
        } else if (isForbiddenApplicationLayer(specifier)) {
          violations.push(
            relative(".", file) + ": application-layer-import " + specifier,
          );
        }
      }
      if (ruleLayer === "platform-node") {
        if (isForbiddenPlatformLayer(specifier)) {
          violations.push(
            relative(".", file) + ": platform-node-layer-import " + specifier,
          );
        }
      }
      if (ruleLayer === "adapter-grok") {
        if (isNodeBuiltin(specifier)) {
          violations.push(
            relative(".", file) + ": adapter-grok-runtime-import " + specifier,
          );
        } else if (isForbiddenAdapterLayer(specifier)) {
          violations.push(
            relative(".", file) + ": adapter-grok-layer-import " + specifier,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(violations.join("\n") + "\n");
  process.exitCode = 1;
}
