import { Effect } from "effect";
import { parseJsonRejectDuplicateKeys, isCoreFailure } from "@foreman/core";
import {
  checkPel,
  planPel,
  parseAuthoringSnapshotV1,
  buildEffectiveAuthoringSnapshotV1,
  resolveModelSelection,
  validateAuthoringControlsV1,
  type AuthoringDiagnostic,
  type AuthoringSnapshotV1,
  type EffectiveAuthoringSelectionV1,
} from "@foreman/pel";
import {
  authoringFailure,
  type AuthoringServices,
  type ForemanCli,
  type AuthoringFailure,
  type AuthoringGenerateInput,
} from "./pel-authoring-contract.js";
import { makePelDraftSession } from "./pel-draft-session.js";
import { runProviderCli } from "./pel-provider-cli.js";
import { runPelLifecycleCli } from './pel-lifecycle-cli.js';
import { runPelAdoptionCli } from './pel-adoption-cli.js';
import { runPelResearchCli } from './pel-research-cli.js';
import { runPelMigrationCli } from './pel-migration-cli.js';

const SOURCE_LIMIT = 1024 * 1024;
const JSON_LIMIT = 16 * 1024 * 1024;
interface Args {
  command: "check" | "plan";
  file?: string;
  json: boolean;
  interactive: boolean;
  flags: Record<string, string>;
}
function parseArgs(argv: readonly string[]): Args | AuthoringFailure {
  const command = argv[0];
  if (command !== "check" && command !== "plan")
    return authoringFailure(
      "PEL_CLI_USAGE",
      "Use foreman check FILE or foreman plan FILE | --prompt TEXT",
    );
  const result: Args = { command, json: false, interactive: false, flags: {} };
  const valueFlags = [
    "--context",
    "--selection",
    "--controls",
    "--prompt",
    "--model",
    "--transport",
    "--credential-profile",
    "--grammar-mode",
  ];
  const seen = new Set<string>();
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      if (seen.has(arg))
        return authoringFailure("PEL_CLI_USAGE", `Duplicate option ${arg}`);
      seen.add(arg);
      if (arg === "--json") {
        result.json = true;
        continue;
      }
      if (arg === "--interactive") {
        result.interactive = true;
        continue;
      }
      if (
        !valueFlags.includes(arg) ||
        argv[i + 1] === undefined ||
        argv[i + 1]!.startsWith("--")
      )
        return authoringFailure(
          "PEL_CLI_USAGE",
          `Unknown or incomplete option ${arg}`,
        );
      result.flags[arg] = argv[++i]!;
    } else {
      if (result.file !== undefined)
        return authoringFailure(
          "PEL_CLI_USAGE",
          "Only one source file is accepted",
        );
      result.file = arg;
    }
  }
  const prompt = result.flags["--prompt"];
  if ((result.file === undefined) === (prompt === undefined))
    return authoringFailure(
      "PEL_CLI_USAGE",
      "Select exactly one source file or --prompt",
    );
  if (
    command === "check" &&
    (prompt !== undefined ||
      result.interactive ||
      [
        "--model",
        "--transport",
        "--controls",
        "--credential-profile",
        "--grammar-mode",
      ].some((k) => k in result.flags))
  )
    return authoringFailure(
      "PEL_CLI_USAGE",
      "check accepts only source, context, selection, and JSON options",
    );
  if (
    prompt !== undefined &&
    (!prompt.trim() ||
      Buffer.byteLength(prompt) > SOURCE_LIMIT ||
      result.interactive)
  )
    return authoringFailure(
      "PEL_CLI_USAGE",
      "Prompt must be nonempty, bounded, and noninteractive",
    );
  if (result.interactive && result.json)
    return authoringFailure(
      "PEL_CLI_USAGE",
      "Interactive mode does not accept --json",
    );
  if (
    result.file !== undefined &&
    !result.interactive &&
    [
      "--model",
      "--transport",
      "--controls",
      "--credential-profile",
      "--grammar-mode",
    ].some((k) => k in result.flags)
  )
    return authoringFailure(
      "PEL_CLI_USAGE",
      "Generation options require --prompt or --interactive",
    );
  if (
    prompt !== undefined &&
    (!result.flags["--model"] || !result.flags["--transport"])
  )
    return authoringFailure(
      "PEL_CLI_USAGE",
      "Generation requires exact --model and --transport",
    );
  const grammar = result.flags["--grammar-mode"];
  if (
    grammar !== undefined &&
    !["auto", "grammar-required", "envelope"].includes(grammar)
  )
    return authoringFailure("PEL_CLI_USAGE", "Unknown grammar mode");
  return result;
}
const diagnosticFailure = (
  diagnostics: readonly AuthoringDiagnostic[],
  input?: string,
): AuthoringFailure => ({
  ...authoringFailure(
    diagnostics[0]?.code ?? "PEL_SCHEMA",
    diagnostics[0]?.message ?? "Invalid input",
    2,
    input,
  ),
  diagnostics,
});
export function renderAuthoringDiagnostic(
  file: string,
  source: Uint8Array,
  d: AuthoringDiagnostic,
): string {
  const line =
    new TextDecoder().decode(source).split(/\r\n|\r|\n/)[d.span.line - 1] ?? "";
  return `${file}:${d.span.line}:${d.span.column}: ${d.code}: ${d.message}\n${line}\n${" ".repeat(Math.max(0, d.span.column - 1))}${"^".repeat(Math.max(1, Math.min(200, d.span.endLine === d.span.line ? d.span.endColumn - d.span.column : 1)))}\n${d.signature ? `Signature: ${d.signature}\n` : ""}${d.expectedForms.length ? `Expected: ${d.expectedForms.join(", ")}\n` : ""}${d.help ? `${d.help}\n` : ""}`;
}
export function makeForemanCli(services: AuthoringServices): ForemanCli {
  return {
    run: (argv) => {
      if (['--version', 'install', 'support'].includes(argv[0] ?? '')) return runPelAdoptionCli(argv, services);
      if (argv[0] === 'research') return runPelResearchCli(argv, services);
      if (argv[0] === 'migrate') return runPelMigrationCli(argv, services);
      if (argv[0] === 'providers') return runProviderCli(argv, services);
      if (['run', 'resume', 'status', 'cancel', 'project'].includes(argv[0] ?? '')) return runPelLifecycleCli(argv, services);
      let source: Uint8Array = new Uint8Array();
      let file = "<input>";
      const json = argv.includes("--json");
      const readJson = (path: string) =>
        Effect.gen(function* () {
          const data = yield* services.input.read(path, JSON_LIMIT);
          const parsed = yield* Effect.try({
            try: () =>
              parseJsonRejectDuplicateKeys(
                new TextDecoder("utf-8", { fatal: true }).decode(data),
              ),
            catch: (e) => authoringFailure("PEL_SCHEMA", String(e), 2, path),
          });
          if (isCoreFailure(parsed))
            return yield* Effect.fail(
              authoringFailure(
                "PEL_SCHEMA",
                "JSON must have unique keys",
                2,
                path,
              ),
            );
          return parsed;
        });
      const execute = Effect.gen(function* () {
        const args = parseArgs(argv);
        if ("_tag" in args) return yield* Effect.fail(args);
        file = args.file ?? "<prompt>";
        if (args.file !== undefined)
          source = yield* services.input.read(args.file, SOURCE_LIMIT);
        const contextPath =
          args.flags["--context"] ?? services.context.defaultSnapshotPath;
        const contextBytes = yield* services.input.read(
          contextPath,
          JSON_LIMIT,
        );
        const parsed = yield* Effect.try({
          try: () =>
            parseAuthoringSnapshotV1(
              new TextDecoder("utf-8", { fatal: true }).decode(contextBytes),
            ),
          catch: (e) =>
            authoringFailure("PEL_SCHEMA", String(e), 2, contextPath),
        });
        if (!parsed.ok)
          return yield* Effect.fail(
            diagnosticFailure(parsed.error, contextPath),
          );
        let snapshot: AuthoringSnapshotV1 = parsed.value;
        if (args.flags["--selection"]) {
          const selection = yield* readJson(args.flags["--selection"]);
          const effective = buildEffectiveAuthoringSnapshotV1(
            snapshot,
            selection as EffectiveAuthoringSelectionV1,
          );
          if (!effective.ok)
            return yield* Effect.fail(
              diagnosticFailure(effective.error, args.flags["--selection"]),
            );
          snapshot = effective.value;
        }
        if (services.lifecycle?.configuredSnapshot) snapshot = yield* services.lifecycle.configuredSnapshot(snapshot, args.flags['--context'] !== undefined || args.flags['--selection'] !== undefined);
        const generate = (prompt: string) =>
          Effect.gen(function* () {
            const model = args.flags["--model"];
            const transport = args.flags["--transport"];
            if (!model || !transport)
              return yield* Effect.fail(
                authoringFailure(
                  "PEL_PROFILE_UNSUPPORTED",
                  "Generation requires exact --model and --transport",
                ),
              );
            if (model.startsWith("role:"))
              return yield* Effect.fail(
                authoringFailure(
                  "PEL_PROFILE_UNSUPPORTED",
                  "Generation requires an exact model profile",
                ),
              );
            const resolved = resolveModelSelection(snapshot, model, transport);
            if (!resolved.ok)
              return yield* Effect.fail(diagnosticFailure(resolved.error));
            const profile = snapshot.providerProfiles.find(
              (p) => p.profileId === model && p.transportId === transport,
            )!;
            let controls = {
              ...resolved.value.controls,
              toolChoice: "none" as const,
            };
            if (args.flags["--controls"]) {
              const parsedControls = validateAuthoringControlsV1(
                yield* readJson(args.flags["--controls"]),
                profile,
              );
              if (!parsedControls.ok)
                return yield* Effect.fail(
                  diagnosticFailure(
                    parsedControls.error,
                    args.flags["--controls"],
                  ),
                );
              if (parsedControls.value.toolChoice !== "none")
                return yield* Effect.fail(
                  authoringFailure(
                    "PEL_PROFILE_UNSUPPORTED",
                    "Generation requires toolChoice none",
                  ),
                );
              controls = { ...parsedControls.value, toolChoice: "none" };
            }
            const credential =
              args.flags["--credential-profile"] ??
              resolved.value.credentialProfileRef;
            if (
              !snapshot.policy.allowedCredentialProfileRefs.includes(credential)
            )
              return yield* Effect.fail(
                authoringFailure(
                  "PEL_PROFILE_UNSUPPORTED",
                  "Credential reference is not admitted",
                ),
              );
            const grammarMode = (args.flags["--grammar-mode"] ??
              "auto") as AuthoringGenerateInput["grammarMode"];
            if (
              grammarMode === "grammar-required" &&
              profile.grammarSupport !== "qualified"
            )
              return yield* Effect.fail(
                authoringFailure(
                  "PEL_PROFILE_UNSUPPORTED",
                  "Exact endpoint does not have qualified grammar support",
                ),
              );
            if (!services.generate)
              return yield* Effect.fail(
                authoringFailure(
                  "PEL_PROVIDER_UNAVAILABLE",
                  "No generation transport is installed",
                  1,
                ),
              );
            return yield* services
              .generate({
                prompt,
                snapshot,
                modelProfileId: model,
                transportId: transport,
                controls,
                credentialProfileRef: credential,
                grammarMode,
              })
              .pipe(
                Effect.mapError((e) => ({
                  ...e,
                  ...authoringFailure(
                    e.code,
                    e.message,
                    e.code === "PEL_GENERATION_CANCELLED"
                      ? 4
                      : ["PEL_PROFILE_UNSUPPORTED", "PEL_SCHEMA"].includes(
                            e.code,
                          )
                        ? 2
                        : 1,
                  ),
                })),
              );
          });
        if (args.flags["--prompt"] !== undefined) {
          const generated = yield* generate(args.flags["--prompt"]);
          yield* services.output.stdout(
            args.json ? JSON.stringify(generated) + "\n" : generated.pelSource,
          );
          if (!args.json)
            yield* services.output.stderr(
              JSON.stringify(
                {
                  preview: generated.preview,
                  attemptCount: generated.attemptCount,
                  providerIdentities: generated.providerIdentities,
                  cumulativeUsage: generated.cumulativeUsage,
                },
                null,
                2,
              ) + "\n",
            );
          return { exitCode: 0 as const };
        }
        const check = (bytes: Uint8Array) =>
          checkPel({ source: bytes, snapshot });
        if (args.interactive) {
          if (!services.terminal)
            return yield* Effect.fail(
              authoringFailure(
                "PEL_CLI_USAGE",
                "Interactive terminal is unavailable",
              ),
            );
          const terminal = services.terminal;
          const draft = yield* makePelDraftSession({
            source,
            check,
            symbols: snapshot.registry.descriptors.map((d) => d.name),
            profile: snapshot.languageProfile,
          }).pipe(Effect.mapError((e) => authoringFailure(e.code, e.message)));
          terminal.setCompleter?.((prefix) => draft.complete(prefix));
          while (true) {
            const line = yield* terminal.readLine("pel> ");
            if (line === null || line === "abort")
              return { exitCode: 0 as const };
            const [command, nodeId, ...extra] = line.trim().split(/\s+/);
            const step = Effect.gen(function* () {
              if (command === "export") {
                yield* services.output.stdout(
                  new TextDecoder().decode(draft.source()),
                );
                return;
              }
              if (command === "show") {
                yield* services.output.stderr(
                  new TextDecoder().decode(draft.source()) +
                    "\n" +
                    JSON.stringify(
                      draft
                        .nodes()
                        .map((n) => ({ nodeId: n.nodeId, span: n.span })),
                    ) +
                    "\n",
                );
                return;
              }
              if (command === "history") {
                yield* services.output.stderr(
                  JSON.stringify(draft.history()) + "\n",
                );
                return;
              }
              if (command === "undo") {
                yield* draft
                  .undo()
                  .pipe(
                    Effect.mapError((e) => authoringFailure(e.code, e.message)),
                  );
              } else if (command === "repair") {
                yield* services.output.stderr(
                  `Provider use requested: ${args.flags["--model"] ?? "<unselected>"}/${args.flags["--transport"] ?? "<unselected>"}\n`,
                );
                const generated = yield* generate(
                  `Repair this Pel source within the same admitted snapshot:\n${new TextDecoder().decode(draft.source())}`,
                );
                yield* draft
                  .replace(
                    "program",
                    new TextEncoder().encode(generated.pelSource),
                  )
                  .pipe(
                    Effect.mapError((e) => authoringFailure(e.code, e.message)),
                  );
              } else if (command?.startsWith("replace-")) {
                const kind =
                  command === "replace-expression"
                    ? "expression"
                    : command === "replace-suffix"
                      ? "suffix"
                      : command === "replace-program"
                        ? "program"
                        : undefined;
                if (
                  !kind ||
                  extra.length ||
                  (kind === "program"
                    ? nodeId !== undefined
                    : nodeId === undefined)
                )
                  return yield* Effect.fail(
                    authoringFailure(
                      "PEL_CLI_USAGE",
                      "Use replace-program or replace-expression/replace-suffix NODE-ID",
                    ),
                  );
                let fragment = "";
                while (true) {
                  const next = yield* terminal.readLine("... ");
                  if (next === null)
                    return yield* Effect.fail(
                      authoringFailure(
                        "PEL_CLI_USAGE",
                        "Fragment requires .end",
                      ),
                    );
                  if (next === ".end") break;
                  fragment += next + "\n";
                  if (Buffer.byteLength(fragment) > SOURCE_LIMIT)
                    return yield* Effect.fail(
                      authoringFailure(
                        "PEL_LIMIT",
                        "Fragment exceeds source limit",
                      ),
                    );
                }
                yield* draft
                  .replace(kind, new TextEncoder().encode(fragment), nodeId)
                  .pipe(
                    Effect.mapError((e) => authoringFailure(e.code, e.message)),
                  );
              } else if (command !== "check" && command !== "preview")
                return yield* Effect.fail(
                  authoringFailure("PEL_CLI_USAGE", "Unknown draft command"),
                );
              const checked = draft.check();
              if (checked.tag === "invalid") {
                for (const d of checked.diagnostics)
                  yield* services.output.stderr(
                    renderAuthoringDiagnostic(file, draft.source(), d),
                  );
              } else
                yield* services.output.stderr(
                  JSON.stringify(
                    command === "preview"
                      ? planPel(checked.checked)
                      : {
                          schemaVersion: 1,
                          tag: "ok",
                          warnings: checked.warnings,
                        },
                  ) + "\n",
                );
            });
            yield* step.pipe(
              Effect.catchAll((e) =>
                services.output.stderr(`${e.code}: ${e.message}\n`),
              ),
            );
          }
        }
        const result = check(source);
        if (result.tag === "invalid")
          return yield* Effect.fail(
            diagnosticFailure(result.diagnostics, file),
          );
        if (args.command === "plan") {
          const preview = planPel(result.checked);
          yield* services.output.stdout(
            JSON.stringify(preview, null, args.json ? undefined : 2) + "\n",
          );
        } else
          yield* services.output.stdout(
            args.json
              ? JSON.stringify({
                  schemaVersion: 1,
                  tag: "ok",
                  warnings: result.warnings,
                }) + "\n"
              : `${file}: valid Pel\n`,
          );
        return { exitCode: 0 as const };
      });
      return execute.pipe(
        Effect.catchAll((e) =>
          Effect.gen(function* () {
            if (json)
              yield* services.output.stdout(
                JSON.stringify({ schemaVersion: 1, tag: "invalid", ...e }) +
                  "\n",
              );
            else if (e.diagnostics?.length) {
              for (const d of e.diagnostics)
                yield* services.output.stderr(
                  renderAuthoringDiagnostic(e.input ?? file, source, d),
                );
            } else
              yield* services.output.stderr(
                `${e.input ? e.input + ": " : ""}${e.code}: ${e.message}\n`,
              );
            if (!json && "attemptDiagnostics" in e && "cumulativeUsage" in e)
              yield* services.output.stderr(
                JSON.stringify({
                  attemptDiagnostics: e.attemptDiagnostics,
                  cumulativeUsage: e.cumulativeUsage,
                }) + "\n",
              );
            return { exitCode: e.exitCode };
          }),
        ),
      );
    },
  };
}
