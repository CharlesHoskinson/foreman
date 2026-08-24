import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { canonicalize, isCommitSha40 } from "@foreman/core";
import {
  acquireGraphifyPublicationLockV1,
  evaluateGraphifyFreshnessV1,
  isTrackedGraphifySourcePathV1,
  qualifyGraphifyCandidateV1,
  releaseGraphifyPublicationLockV1,
  runGraphifyQualificationCli,
  type GraphifyCliResultV1,
  type GraphifyDiagnosticsV1,
  type GraphifyFileRenameV1,
} from "./graphify-qualification.js";

const MAX_GRAPH_BYTES = 32 * 1024 * 1024;
const MAX_PROCESS_BYTES = 4 * 1024 * 1024;
const PROCESS_TIMEOUT_MS = 10 * 60_000;
const GRAPHIFY_VERSION = "0.9.48";
const ZERO_DIAGNOSTICS: GraphifyDiagnosticsV1 = {
  danglingEndpointEdges: 0,
  missingEndpointEdges: 0,
  nonObjectEdges: 0,
};

type ProcessResult = {
  readonly ok: boolean;
  readonly stdout: string;
};

function refused(): GraphifyCliResultV1 {
  return { schemaVersion: 1, _tag: "Refused", reason: "invalid_input" };
}

function physicallyInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return (
    rel.length === 0 ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`))
  );
}

function boundedRegularFile(path: string, maxBytes: number): Uint8Array {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) {
    throw new Error("invalid bounded file");
  }
  const bytes = readFileSync(path);
  const after = lstatSync(path);
  if (
    bytes.byteLength > maxBytes ||
    !after.isFile() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error("file identity changed");
  }
  return Uint8Array.from(bytes);
}

function run(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ProcessResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: "utf8",
    env,
    maxBuffer: MAX_PROCESS_BYTES,
    timeout: PROCESS_TIMEOUT_MS,
    windowsHide: true,
  });
  return {
    ok:
      result.error === undefined &&
      result.signal === null &&
      result.status === 0 &&
      Buffer.byteLength(result.stdout, "utf8") <= MAX_PROCESS_BYTES &&
      Buffer.byteLength(result.stderr, "utf8") <= MAX_PROCESS_BYTES,
    stdout: result.stdout,
  };
}

function resolveHostExecutable(name: string, repository: string): string {
  const suffixes = process.platform === "win32" ? [".exe", ".cmd"] : [""];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory.length === 0 || !isAbsolute(directory)) continue;
    for (const suffix of suffixes) {
      const lexical = join(directory, `${name}${suffix}`);
      try {
        const physical = realpathSync(lexical);
        const stat = statSync(physical);
        if (!stat.isFile() || physicallyInside(repository, physical)) continue;
        accessSync(physical, constants.X_OK);
        return physical;
      } catch {
        // Continue through the fixed host PATH inventory.
      }
    }
  }
  throw new Error("host executable unavailable");
}

function gitEnvironment(git: string): NodeJS.ProcessEnv {
  return {
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
    PATH: dirname(git),
    ...(process.platform === "win32" ? { PATHEXT: ".EXE" } : {}),
  };
}

function git(
  executable: string,
  repository: string,
  args: readonly string[],
): string {
  const result = run(
    executable,
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "-C",
      repository,
      ...args,
    ],
    repository,
    gitEnvironment(executable),
  );
  if (!result.ok) throw new Error("Git operation failed");
  return result.stdout;
}

function oneLfLine(value: string): string {
  if (!value.endsWith("\n") || value.endsWith("\r\n")) {
    throw new Error("invalid line frame");
  }
  const line = value.slice(0, -1);
  if (line.length === 0 || /[\r\n\u0000]/u.test(line)) {
    throw new Error("invalid line");
  }
  return line;
}

function manifestSection(text: string): {
  readonly version: string;
  readonly interpreter: string;
} {
  const match = /(?:^|\n)\[graphify_qualification\]\n([\s\S]*?)(?=\n\[|$)/u.exec(
    text,
  );
  if (match?.[1] === undefined) throw new Error("missing graphify manifest");
  const version = /^version = "([^"]+)"$/mu.exec(match[1])?.[1];
  const interpreter = /^reference_interpreter = "([^"]+)"$/mu.exec(
    match[1],
  )?.[1];
  if (version !== GRAPHIFY_VERSION || interpreter === undefined) {
    throw new Error("invalid graphify manifest");
  }
  return { version, interpreter };
}

function interpreterFor(repository: string, manifestPath: string): {
  readonly lexical: string;
  readonly physical: string;
  readonly version: string;
} {
  const manifest = new TextDecoder("utf-8", { fatal: true }).decode(
    boundedRegularFile(manifestPath, 1024 * 1024),
  );
  const config = manifestSection(manifest);
  const localPath = join(repository, "graphify-out", ".graphify_python");
  let lexical = config.interpreter;
  if (existsSync(localPath)) {
    lexical = oneLfLine(
      new TextDecoder("utf-8", { fatal: true }).decode(
        boundedRegularFile(localPath, 4096),
      ),
    );
  }
  if (!isAbsolute(lexical)) throw new Error("interpreter is not absolute");
  const physical = realpathSync(lexical);
  if (physicallyInside(repository, physical) || !statSync(physical).isFile()) {
    throw new Error("unsafe interpreter");
  }
  accessSync(physical, constants.X_OK);
  return { lexical, physical, version: config.version };
}

function graphifyEnvironment(interpreter: string, home: string): NodeJS.ProcessEnv {
  return {
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "1",
    PATH: dirname(interpreter),
    PYTHONDONTWRITEBYTECODE: "1",
    ...(process.platform === "win32" ? { PATHEXT: ".EXE" } : {}),
  };
}

function runGraphifyBuild(
  interpreter: string,
  repository: string,
  output: string,
  home: string,
  raw: boolean,
): void {
  const args = [
    "-m",
    "graphify",
    "extract",
    repository,
    "--out",
    output,
    "--code-only",
    "--max-workers",
    "1",
    ...(raw ? ["--no-cluster"] : []),
  ];
  const result = run(
    interpreter,
    args,
    repository,
    graphifyEnvironment(interpreter, home),
  );
  if (!result.ok) throw new Error("Graphify build failed");
}

function tokenCounts(output: string): {
  readonly input: number;
  readonly output: number;
} {
  const bytes = boundedRegularFile(
    join(output, "graphify-out", ".graphify_analysis.json"),
    1024 * 1024,
  );
  const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  if (
    value === null ||
    typeof value !== "object" ||
    !("tokens" in value) ||
    value.tokens === null ||
    typeof value.tokens !== "object" ||
    !("input" in value.tokens) ||
    !("output" in value.tokens) ||
    typeof value.tokens.input !== "number" ||
    typeof value.tokens.output !== "number"
  ) {
    throw new Error("invalid Graphify analysis");
  }
  return { input: value.tokens.input, output: value.tokens.output };
}

function parseRenames(raw: string): readonly GraphifyFileRenameV1[] {
  if (raw.length === 0) return [];
  const fields = raw.split("\u0000");
  if (fields.at(-1) !== "") throw new Error("invalid rename frame");
  fields.pop();
  const result: GraphifyFileRenameV1[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index];
    if (status?.startsWith("R")) {
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (oldPath === undefined || newPath === undefined) {
        throw new Error("invalid rename record");
      }
      result.push({ oldPath, newPath });
      index += 3;
    } else {
      index += 2;
    }
  }
  return result;
}

function trackedSourcePaths(gitPath: string, repository: string): readonly string[] {
  const raw = git(gitPath, repository, ["ls-files", "-z"]);
  if (raw.length > 0 && !raw.endsWith("\u0000")) {
    throw new Error("invalid tracked path frame");
  }
  return raw
    .split("\u0000")
    .filter(isTrackedGraphifySourcePathV1)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function changedSourcePaths(
  gitPath: string,
  repository: string,
  sourceCommit: string,
  currentCommit: string,
): readonly string[] {
  const raw = git(gitPath, repository, [
    "diff",
    "--name-only",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    sourceCommit,
    currentCommit,
    "--",
  ]);
  if (raw.length > 0 && !raw.endsWith("\u0000")) {
    throw new Error("invalid changed path frame");
  }
  return raw
    .split("\u0000")
    .filter(isTrackedGraphifySourcePathV1)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)));
}

function materializeCommit(
  gitPath: string,
  repository: string,
  sourceCommit: string,
  temporary: string,
): string {
  const archive = join(temporary, "source.tar");
  const source = join(temporary, "source");
  mkdirSync(source);
  const archived = run(
    gitPath,
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      `core.excludesFile=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
      "-C",
      repository,
      "archive",
      "--format=tar",
      "-o",
      archive,
      sourceCommit,
    ],
    repository,
    gitEnvironment(gitPath),
  );
  if (!archived.ok) throw new Error("Git archive failed");
  const tar = resolveHostExecutable("tar", repository);
  const extracted = run(tar, ["-xf", archive, "-C", source], repository, {
    LANG: "C",
    LC_ALL: "C",
    PATH: dirname(tar),
  });
  if (!extracted.ok) throw new Error("archive extraction failed");
  return source;
}

function optionalFile(path: string): Uint8Array | null {
  try {
    return boundedRegularFile(path, MAX_GRAPH_BYTES);
  } catch {
    return null;
  }
}

function publishPair(
  directory: string,
  graphBytes: Uint8Array,
  metadataBytes: Uint8Array,
): void {
  mkdirSync(directory, { recursive: true });
  const graphPath = join(directory, "graph.json");
  const metadataPath = join(directory, "refresh-meta.json");
  const priorGraph = optionalFile(graphPath);
  const priorMetadata = optionalFile(metadataPath);
  const graphTemp = join(directory, `.graph.json.${randomUUID()}.tmp`);
  const metadataTemp = join(directory, `.refresh-meta.json.${randomUUID()}.tmp`);
  try {
    writeFileSync(graphTemp, graphBytes, { flag: "wx", mode: 0o600 });
    writeFileSync(metadataTemp, metadataBytes, { flag: "wx", mode: 0o600 });
    renameSync(graphTemp, graphPath);
    renameSync(metadataTemp, metadataPath);
  } catch (error) {
    rmSync(graphTemp, { force: true });
    rmSync(metadataTemp, { force: true });
    if (priorGraph === null) rmSync(graphPath, { force: true });
    else writeFileSync(graphPath, priorGraph, { mode: 0o600 });
    if (priorMetadata === null) rmSync(metadataPath, { force: true });
    else writeFileSync(metadataPath, priorMetadata, { mode: 0o600 });
    throw error;
  }
}

async function qualifyLive(input: {
  readonly repository: string;
  readonly manifest: string;
  readonly cadence: string;
}): Promise<GraphifyCliResultV1> {
  let temporary: string | null = null;
  let lock: ReturnType<typeof acquireGraphifyPublicationLockV1> | null = null;
  try {
    const repository = realpathSync(input.repository);
    if (!statSync(repository).isDirectory()) return refused();
    const manifest = realpathSync(input.manifest);
    if (!physicallyInside(repository, manifest)) return refused();
    const gitPath = resolveHostExecutable("git", repository);
    const root = realpathSync(oneLfLine(git(gitPath, repository, ["rev-parse", "--show-toplevel"])));
    if (root !== repository) return refused();
    const sourceCommit = oneLfLine(git(gitPath, repository, ["rev-parse", "HEAD"]));
    if (git(gitPath, repository, ["status", "--porcelain", "--untracked-files=no"]) !== "") {
      return refused();
    }
    const interpreter = interpreterFor(repository, manifest);
    temporary = mkdtempSync(join(tmpdir(), "foreman-graphify-"));
    const home = join(temporary, "home");
    const raw = join(temporary, "raw");
    const first = join(temporary, "first");
    const second = join(temporary, "second");
    mkdirSync(home, { recursive: true });
    const source = materializeCommit(
      gitPath,
      repository,
      sourceCommit,
      temporary,
    );
    const version = run(
      interpreter.lexical,
      ["-m", "graphify", "--version"],
      repository,
      graphifyEnvironment(interpreter.lexical, home),
    );
    if (!version.ok || !version.stdout.startsWith(`graphify ${interpreter.version}\n`)) {
      return refused();
    }
    runGraphifyBuild(interpreter.lexical, source, raw, home, true);
    const rawGraph = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        boundedRegularFile(join(raw, "graphify-out", "graph.json"), MAX_GRAPH_BYTES),
      ),
    ) as { input_tokens?: unknown; output_tokens?: unknown };
    if (rawGraph.input_tokens !== 0 || rawGraph.output_tokens !== 0) return refused();
    runGraphifyBuild(interpreter.lexical, source, first, home, false);
    runGraphifyBuild(interpreter.lexical, source, second, home, false);
    const firstTokens = tokenCounts(first);
    const secondTokens = tokenCounts(second);
    const graphDirectory = join(repository, "graphify-out");
    const previousGraph = optionalFile(join(graphDirectory, "graph.json"));
    const previousMetadata = optionalFile(join(graphDirectory, "refresh-meta.json"));
    let fileRenames: readonly GraphifyFileRenameV1[] = [];
    if (previousMetadata !== null) {
      const meta = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(previousMetadata)) as {
        sourceCommit?: unknown;
      };
      if (typeof meta.sourceCommit === "string" && meta.sourceCommit !== sourceCommit) {
        fileRenames = parseRenames(
          git(gitPath, repository, [
            "diff",
            "--name-status",
            "-z",
            "-M",
            meta.sourceCommit,
            sourceCommit,
            "--",
          ]),
        );
      }
    }
    const result = qualifyGraphifyCandidateV1({
      expectedVersion: interpreter.version,
      observedVersion: interpreter.version,
      expectedCommit: sourceCommit,
      observedCommit: sourceCommit,
      interpreter: interpreter.physical,
      graphBytesA: boundedRegularFile(
        join(first, "graphify-out", "graph.json"),
        MAX_GRAPH_BYTES,
      ),
      graphBytesB: boundedRegularFile(
        join(second, "graphify-out", "graph.json"),
        MAX_GRAPH_BYTES,
      ),
      inputTokensA: firstTokens.input,
      outputTokensA: firstTokens.output,
      inputTokensB: secondTokens.input,
      outputTokensB: secondTokens.output,
      diagnosticsA: ZERO_DIAGNOSTICS,
      diagnosticsB: ZERO_DIAGNOSTICS,
      previousGraphBytes: previousGraph,
      fileRenames,
      cadence: input.cadence,
      generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
    });
    if (result._tag !== "Qualified") return result;
    const commonRaw = oneLfLine(git(gitPath, repository, ["rev-parse", "--git-common-dir"]));
    const commonGitDirectory = realpathSync(
      isAbsolute(commonRaw) ? commonRaw : resolve(repository, commonRaw),
    );
    lock = acquireGraphifyPublicationLockV1(commonGitDirectory, randomUUID());
    if (lock._tag !== "Acquired") return lock;
    const revalidated = oneLfLine(git(gitPath, repository, ["rev-parse", "HEAD"]));
    if (revalidated !== sourceCommit) return refused();
    publishPair(graphDirectory, result.graphBytes, result.metadataBytes);
    return { schemaVersion: 1, _tag: "Qualified", sourceCommit };
  } catch {
    return refused();
  } finally {
    if (lock?._tag === "Acquired") releaseGraphifyPublicationLockV1(lock);
    if (temporary !== null) rmSync(temporary, { recursive: true, force: true });
  }
}

async function freshnessLive(repositoryInput: string): Promise<GraphifyCliResultV1> {
  try {
    const repository = realpathSync(repositoryInput);
    const gitPath = resolveHostExecutable("git", repository);
    const currentCommit = oneLfLine(git(gitPath, repository, ["rev-parse", "HEAD"]));
    const graphBytes = optionalFile(join(repository, "graphify-out", "graph.json"));
    const metadataBytes = optionalFile(
      join(repository, "graphify-out", "refresh-meta.json"),
    );
    let ancestry: "same" | "ancestor" | "unrelated" | "missing" = "missing";
    let changedPaths: readonly string[] = [];
    if (metadataBytes !== null) {
      try {
        const value = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(metadataBytes),
        ) as { sourceCommit?: unknown };
        if (
          typeof value.sourceCommit === "string" &&
          isCommitSha40(value.sourceCommit)
        ) {
          if (value.sourceCommit === currentCommit) ancestry = "same";
          else {
            const ancestor = run(
              gitPath,
              [
                "-c",
                "core.fsmonitor=false",
                "-C",
                repository,
                "merge-base",
                "--is-ancestor",
                value.sourceCommit,
                currentCommit,
              ],
              repository,
              gitEnvironment(gitPath),
            );
            ancestry = ancestor.ok ? "ancestor" : "unrelated";
            if (ancestry === "ancestor") {
              changedPaths = changedSourcePaths(
                gitPath,
                repository,
                value.sourceCommit,
                currentCommit,
              );
            }
          }
        }
      } catch {
        ancestry = "missing";
      }
    }
    return evaluateGraphifyFreshnessV1({
      graphBytes,
      metadataBytes,
      currentCommit,
      ancestry,
      trackedSourcePaths: trackedSourcePaths(gitPath, repository),
      changedSourcePaths: changedPaths,
    });
  } catch {
    return { schemaVersion: 1, _tag: "Invalid" };
  }
}

const exitCode = await runGraphifyQualificationCli(
  process.argv,
  {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  },
  { qualify: qualifyLive, freshness: freshnessLive },
);
process.exitCode = exitCode;
