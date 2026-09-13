#!/usr/bin/env node
import { open } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { Effect } from "effect";
import { makeForemanCli } from "./pel-authoring-cli.js";
import { defaultLiveProviderContext, makeLiveProviderCliServices } from './pel-provider-live.js';
import { makeLiveAuthoringGenerate } from './pel-provider-generation-live.js';
import {makeLivePelLifecycleServices,defaultPelLifecycleOptions} from './pel-lifecycle-live.js';
import {makeLivePelAdoptionServices} from './pel-adoption.js';
import {makePelResearchCliServices} from './pel-research-refresh.js';
import {makeLivePelMigrationServices} from './pel-migration-live.js';
import {
  authoringFailure,
  type AuthoringInputPort,
  type AuthoringOutputPort,
  type AuthoringServices,
  type AuthoringTerminalPort,
} from "./pel-authoring-contract.js";

export const nodeAuthoringInput: AuthoringInputPort = {
  read: (path, maxBytes) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => open(path, "r"),
            catch: (e) => authoringFailure("PEL_INPUT", String(e), 2, path),
          }),
          (handle) => Effect.promise(() => handle.close()),
        );
        return yield* Effect.tryPromise({
          try: async () => {
            const stat = await handle.stat();
            if (!stat.isFile()) throw new Error("Input must be a regular file");
            if (stat.size > maxBytes)
              throw new Error(`Input exceeds ${maxBytes} bytes`);
            const bytes = Buffer.alloc(maxBytes + 1);
            let offset = 0;
            while (offset < bytes.length) {
              const result = await handle.read(
                bytes,
                offset,
                bytes.length - offset,
                null,
              );
              if (!result.bytesRead) break;
              offset += result.bytesRead;
            }
            if (offset > maxBytes)
              throw new Error(`Input exceeds ${maxBytes} bytes`);
            return bytes.subarray(0, offset);
          },
          catch: (e) => authoringFailure("PEL_INPUT", String(e), 2, path),
        });
      }),
    ),
};
const write = (stream: NodeJS.WriteStream, text: string) =>
  Effect.async<void, ReturnType<typeof authoringFailure>>((resume) => {
    stream.write(text, (error) =>
      resume(
        error
          ? Effect.fail(authoringFailure("PEL_OUTPUT", error.message, 1))
          : Effect.void,
      ),
    );
  });
export const nodeAuthoringOutput: AuthoringOutputPort = {
  stdout: (text) => write(process.stdout, text),
  stderr: (text) => write(process.stderr, text),
};
export function defaultAuthoringSnapshotPath(
  moduleUrl = import.meta.url,
): string {
  return fileURLToPath(
    new URL("../assets/pel/default-authoring-snapshot.json", moduleUrl),
  );
}
export function runPelAuthoringMain(
  argv: readonly string[],
  overrides: Partial<AuthoringServices> = {},
): Effect.Effect<number> {
  return Effect.scoped(
    Effect.gen(function* () {
      let terminal: AuthoringTerminalPort | undefined = overrides.terminal;
      if (argv.includes("--interactive") && !terminal) {
        let complete = (prefix: string): readonly string[] => [];
        const reader = yield* Effect.acquireRelease(
          Effect.sync(() =>
            createInterface({
              input: process.stdin,
              output: process.stderr,
              terminal: process.stdin.isTTY === true,
              historySize: 100,
              completer: (line: string) => [[...complete(line)], line],
            }),
          ),
          (reader) => Effect.sync(() => reader.close()),
        );
        const iterator = reader[Symbol.asyncIterator]();
        terminal = {
          setCompleter: (fn) => {
            complete = fn;
          },
          readLine: (prompt) =>
            Effect.gen(function* () {
              if (process.stdin.isTTY)
                yield* nodeAuthoringOutput.stderr(prompt);
              const value = yield* Effect.tryPromise({
                try: () => iterator.next(),
                catch: (e) => authoringFailure("PEL_INPUT", String(e)),
              });
              return value.done ? null : value.value;
            }),
        };
      }
      const providerContext = defaultLiveProviderContext();
      const lifecycleOptions = defaultPelLifecycleOptions(overrides.output ?? nodeAuthoringOutput);
      const result = yield* makeForemanCli({
        input: nodeAuthoringInput,
        output: nodeAuthoringOutput,
        context: { defaultSnapshotPath: defaultAuthoringSnapshotPath() },
        providers: makeLiveProviderCliServices(providerContext),
        generate: makeLiveAuthoringGenerate(providerContext),
        lifecycle: makeLivePelLifecycleServices(lifecycleOptions),
        adoption: makeLivePelAdoptionServices({entryUrl:import.meta.url,foremanHome:lifecycleOptions.foremanHome}),
        research: makePelResearchCliServices({entryUrl:import.meta.url,foremanHome:lifecycleOptions.foremanHome,checkoutRoot:lifecycleOptions.cwd}),
        migration: makeLivePelMigrationServices({entryUrl:import.meta.url,foremanHome:lifecycleOptions.foremanHome,cwd:lifecycleOptions.cwd}),
        ...overrides,
        ...(terminal ? { terminal } : {}),
      }).run(argv);
      return result.exitCode;
    }),
  ).pipe(
    Effect.catchAll((e) =>
      Effect.gen(function* () {
        yield* nodeAuthoringOutput
          .stderr(`${e.code}: ${e.message}\n`)
          .pipe(Effect.ignore);
        return e.exitCode;
      }),
    ),
  );
}
if (
  process.argv[1] &&
  basename(fileURLToPath(import.meta.url)) === "foreman.js" &&
  fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  try {
    process.exitCode = await Effect.runPromise(
      runPelAuthoringMain(process.argv.slice(2)),
      { signal: controller.signal },
    );
  } catch {
    process.exitCode = controller.signal.aborted ? 4 : 1;
  } finally {
    process.removeListener("SIGINT", cancel);
  }
}
