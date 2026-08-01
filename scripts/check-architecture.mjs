import { readdir, readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { extname, join, relative } from "node:path";
import ts from "typescript";

const roots = {
  schema: "packages/schema/src",
  domain: "packages/domain/src",
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

const moduleSpecifiers = (file, source) => {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const specifiers = [];

  const addStringLiteral = (node) => {
    if (node !== undefined && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
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
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      addStringLiteral(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
};

const violations = [];
for (const [layer, root] of Object.entries(roots)) {
  for (const file of await walk(root)) {
    if (extname(file) !== ".ts") continue;
    const source = await readFile(file, "utf8");
    for (const specifier of moduleSpecifiers(file, source)) {
      if (layer === "schema") {
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
      if (layer === "domain") {
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
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(violations.join("\n") + "\n");
  process.exitCode = 1;
}
