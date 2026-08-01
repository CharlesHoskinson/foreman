import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const roots = {
  schema: "packages/schema/src",
  domain: "packages/domain/src",
};

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    }),
  );
  return nested.flat();
};

const importPattern = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;

const violations = [];
for (const [layer, root] of Object.entries(roots)) {
  for (const file of await walk(root)) {
    if (extname(file) !== ".ts") continue;
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (specifier === undefined) continue;
      if (
        layer === "schema" &&
        (specifier.startsWith("node:") ||
          (specifier.startsWith("effect/") && specifier !== "effect/Schema"))
      ) {
        violations.push(
          relative(".", file) + ": schema-runtime-import " + specifier,
        );
      }
      if (
        layer === "domain" &&
        (specifier === "effect" ||
          specifier.startsWith("effect/") ||
          specifier.startsWith("node:") ||
          specifier.includes("platform") ||
          specifier.includes("adapter") ||
          specifier.includes("runtime"))
      ) {
        violations.push(
          relative(".", file) + ": domain-runtime-import " + specifier,
        );
      }
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(violations.join("\n") + "\n");
  process.exitCode = 1;
}
