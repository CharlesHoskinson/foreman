import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve, dirname, join, relative } from "node:path";
import ts from "typescript";
import { Effect, Stream } from "effect";
import { PROVIDER_PROFILES } from "./profiles.js";
import { createTransportCellFixture } from "./fixtures/transport-test-fixture.js";
for (const profile of PROVIDER_PROFILES)
  for (const transportId of profile.transports)
    test(`T-M3-027/R-M3-027 ${profile.id}/${transportId} resolves the exact opaque account and releases its lease after transport cleanup`, async () => {
      for (const outcome of ["completed", "stream-loss"] as const) {
        const fixture = await createTransportCellFixture(
          profile.id,
          transportId,
          { outcome },
        );
        try {
          const result = await Effect.runPromise(
            Effect.either(
              Effect.scoped(
                Effect.flatMap(
                  fixture.transport.start(fixture.request),
                  Stream.runCollect,
                ),
              ),
            ),
          );
          assert.deepEqual(fixture.credentialRefs, [
            fixture.request.credentialProfileRef,
          ]);
          assert.equal(
            fixture.releases.filter((item) => item === "credential").length,
            1,
          );
          assert.equal(fixture.releases.at(-1), "credential");
          assert(
            fixture.releases.includes(
              fixture.launches.length ? "process" : "http",
            ),
          );
          assert(!JSON.stringify(fixture.request).includes("fixture-secret"));
          if (result._tag === "Right") {
            for (const event of result.right) {
              assert.equal(
                event.providerIdentity.credentialProfileRef,
                fixture.request.credentialProfileRef,
              );
              assert(!JSON.stringify(event).includes("fixture-secret"));
            }
          } else
            assert(!JSON.stringify(result.left).includes("fixture-secret"));
        } finally {
          await fixture.dispose();
        }
      }
    });
test("T-M3-027/R-M3-027 observe and cancel resolve the original account and each scoped lease closes", async () => {
  const fixture = await createTransportCellFixture(
    "gpt-6-astra",
    "openai-responses",
    { background: true },
  );
  try {
    const events = Array.from(
      await Effect.runPromise(
        Effect.scoped(
          Effect.flatMap(
            fixture.transport.start(fixture.request),
            Stream.runCollect,
          ),
        ),
      ),
    );
    const identity = events[0]!.providerIdentity;
    fixture.setRemote("in_progress");
    await Effect.runPromise(fixture.transport.observe(identity));
    await Effect.runPromise(fixture.transport.cancel(identity));
    assert.deepEqual(fixture.credentialRefs, [
      fixture.request.credentialProfileRef,
      fixture.request.credentialProfileRef,
      fixture.request.credentialProfileRef,
    ]);
    assert.equal(
      fixture.releases.filter((item) => item === "credential").length,
      3,
    );
    assert.equal(fixture.releases.at(-1), "credential");
  } finally {
    await fixture.dispose();
  }
});
async function importsUnder(
  root: string,
): Promise<readonly { file: string; specifier: string }[]> {
  const files = (await readdir(root, { recursive: true })).filter((file) =>
    file.endsWith(".ts"),
  );
  const imports: { file: string; specifier: string }[] = [];
  for (const file of files) {
    const path = join(root, file);
    const source = ts.createSourceFile(
      path,
      await readFile(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push({ file: path, specifier: node.moduleSpecifier.text });
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push({ file: path, specifier: node.arguments[0].text });
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return imports;
}
test("T-M3-016/T-M3-027 provider/Pel source imports and package references remain acyclic", async () => {
  const workspace = resolve(".");
  for (const [name, forbidden] of [
    ["providers", ["orchestration"]],
    ["pel", ["providers", "orchestration"]],
  ] as const) {
    const root = join(workspace, "packages", name);
    const imports = await importsUnder(join(root, "src"));
    assert(imports.length > 0);
    for (const { file, specifier } of imports) {
      for (const target of forbidden) {
        assert.notEqual(
          specifier,
          `@foreman/${target}`,
          `${relative(workspace, file)} imports forbidden package`,
        );
        if (specifier.startsWith("."))
          assert(
            !resolve(dirname(file), specifier).startsWith(
              join(workspace, "packages", target),
            ),
            `${relative(workspace, file)} crosses a forbidden package boundary`,
          );
      }
    }
    const config = JSON.parse(
      await readFile(join(root, "tsconfig.json"), "utf8"),
    ) as { references?: { path: string }[] };
    for (const reference of config.references ?? [])
      for (const target of forbidden)
        assert.notEqual(
          resolve(root, reference.path),
          join(workspace, "packages", target),
        );
  }
  const index = await readFile(
    join(workspace, "packages/providers/src/index.ts"),
    "utf8",
  );
  assert(!index.includes("transport-test-fixture"));
  assert(!index.includes("fixture:account"));
});
