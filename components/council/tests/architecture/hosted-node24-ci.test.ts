import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const councilRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(councilRoot, "../..");

const workflowPaths = {
  linux: join(repoRoot, ".github/workflows/gates-linux.yml"),
  windows: join(repoRoot, ".github/workflows/gates-windows.yml"),
} as const;

const STEP_NAME = "Run Council Node 24 gate";
const WORKING_DIRECTORY = "components/council";
const SETUP_NODE_ACTION = "actions/setup-node@v4";
const NODE_VERSION = "24";
const SHELL = "bash";
const EXPECTED_ENV = { CI: "true" } as const;

const EXPECTED_RUN_LINES = [
  "set -euo pipefail",
  "corepack pnpm install --frozen-lockfile",
  "corepack pnpm check",
  "corepack pnpm exec openspec validate --all --strict --no-interactive",
] as const;

const PROVIDER_CREDENTIAL_PATTERNS = [
  /ANTHROPIC_API_KEY/i,
  /OPENAI_API_KEY/i,
  /XAI_API_KEY/i,
  /GEMINI_API_KEY/i,
  /GOOGLE_API_KEY/i,
  /CLAUDE_API_KEY/i,
  /CODEX_API_KEY/i,
  /GROK_API_KEY/i,
  /secrets\.[A-Z0-9_]*API[_-]?KEY/i,
  /secrets\.[A-Z0-9_]*TOKEN/i,
  /secrets\.[A-Z0-9_]*CREDENTIAL/i,
] as const;

const LIVE_PROVIDER_CALL_PATTERNS = [
  /\bclaude\b/i,
  /\bcodex\b/i,
  /\bgrok\b/i,
  /\bgemini\b/i,
  /provider[-_ ]?health/i,
  /live[-_ ]?canary/i,
  /paid[-_ ]?call/i,
] as const;

type WorkflowId = keyof typeof workflowPaths;

/**
 * Per-workflow trigger contract.
 *
 * Linux gates: it must run on every pull request, so `pull_request` is
 * required and its absence is a defect.
 *
 * Windows does not gate. The Bats suite has never passed there (pass=444
 * fail=270 skip=26, run 31199790530) and does not fit the 60-minute job cap;
 * see docs/evidence/w0/2026-08-07-windows-suite-measurement.md. `19d5dc0`
 * therefore removed its `push` and `pull_request` triggers so a red Windows
 * result cannot block a merge and a green one cannot be mistaken for Windows
 * support.
 *
 * `forbiddenTriggers` makes that decision enforceable rather than merely
 * true today: re-adding a gating trigger to Windows must fail this test and
 * force the evidence to be revisited, exactly as removing `pull_request`
 * from Linux must.
 */
const EXPECTED_JOB: Record<
  WorkflowId,
  {
    readonly jobId: string;
    readonly runsOn: string;
    readonly requiredTrigger: string;
    readonly forbiddenTriggers: readonly string[];
  }
> = {
  linux: {
    jobId: "gates-linux",
    runsOn: "ubuntu-latest",
    requiredTrigger: "pull_request",
    forbiddenTriggers: [],
  },
  windows: {
    jobId: "gates-windows",
    runsOn: "windows-latest",
    requiredTrigger: "workflow_dispatch",
    forbiddenTriggers: ["push", "pull_request"],
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isUnknownArray = (value: unknown): value is readonly unknown[] =>
  Array.isArray(value);

const loadWorkflowSource = async (id: WorkflowId): Promise<string> =>
  readFile(workflowPaths[id], "utf8");

const parseWorkflowDocument = (source: string): Record<string, unknown> => {
  const parsed: unknown = parseYaml(source);
  if (!isRecord(parsed)) {
    throw new Error("workflow root must be a mapping");
  }
  return parsed;
};

const requireRecord = (
  value: unknown,
  label: string,
): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value;
};

const requireString = (value: unknown, label: string): string => {
  if (!isString(value)) {
    throw new Error(`${label} must be a string`);
  }
  return value;
};

const requireSteps = (value: unknown, label: string): readonly unknown[] => {
  if (!isUnknownArray(value)) {
    throw new Error(`${label} must be a sequence`);
  }
  return value;
};

const stepRecord = (value: unknown, index: number): Record<string, unknown> =>
  requireRecord(value, `steps[${String(index)}]`);

const executableRunLines = (run: string): readonly string[] =>
  run
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

/**
 * Raw-text checker that the cold audit defeated: comments can satisfy markers,
 * fields, and commands because the checker never parses YAML structure.
 */
const rawTextCheckerAccepts = (source: string): boolean => {
  const stepMarker = `- name: ${STEP_NAME}`;
  const stepMarkers = source.match(new RegExp(`- name: ${STEP_NAME}`, "g"));
  if (stepMarkers?.length !== 1) {
    return false;
  }

  const setupIndex = source.indexOf(SETUP_NODE_ACTION);
  const stepIndex = source.indexOf(stepMarker);
  if (setupIndex < 0 || stepIndex <= setupIndex) {
    return false;
  }
  if (
    !/node-version:\s*["']?24["']?/.test(source.slice(setupIndex, stepIndex))
  ) {
    return false;
  }

  const after = source.slice(stepIndex + stepMarker.length);
  const nextStep = after.search(/\n {6}- /);
  const body = nextStep === -1 ? after : after.slice(0, nextStep);

  if (!new RegExp(`working-directory:\\s*${WORKING_DIRECTORY}`).test(body)) {
    return false;
  }
  if (!/shell:\s*bash/.test(body)) {
    return false;
  }
  if (!/CI:\s*["']true["']/.test(body)) {
    return false;
  }

  const positions = EXPECTED_RUN_LINES.slice(1).map((command) =>
    body.indexOf(command),
  );
  if (positions.some((position) => position < 0)) {
    return false;
  }
  const [installAt, checkAt, openspecAt] = positions;
  if (
    installAt === undefined ||
    checkAt === undefined ||
    openspecAt === undefined
  ) {
    return false;
  }
  if (!(installAt < checkAt && checkAt < openspecAt)) {
    return false;
  }

  if (/continue-on-error\s*:/.test(body) || /^\s*if\s*:/m.test(body)) {
    return false;
  }

  for (const pattern of PROVIDER_CREDENTIAL_PATTERNS) {
    if (pattern.test(body)) {
      return false;
    }
  }
  for (const pattern of LIVE_PROVIDER_CALL_PATTERNS) {
    if (pattern.test(body)) {
      return false;
    }
  }

  return body.includes("openspec validate --all --strict --no-interactive");
};

type GateCheckFailure = { readonly ok: false; readonly reason: string };
type GateCheckSuccess = {
  readonly ok: true;
  readonly gate: Record<string, unknown>;
};
type GateCheckResult = GateCheckFailure | GateCheckSuccess;

const fail = (reason: string): GateCheckFailure => ({ ok: false, reason });

/**
 * Structural contract checker: parse YAML, then inspect real job steps.
 * Comments cannot satisfy named-step, field, or command assertions.
 */
const checkParsedCouncilGateContract = (
  source: string,
  workflowId: WorkflowId,
): GateCheckResult => {
  try {
    const document = parseWorkflowDocument(source);

    const { jobId, runsOn, requiredTrigger, forbiddenTriggers } =
      EXPECTED_JOB[workflowId];

    const onValue = document["on"];
    if (!isRecord(onValue) || !Object.hasOwn(onValue, requiredTrigger)) {
      return fail(`workflow must declare a real ${requiredTrigger} trigger`);
    }
    for (const trigger of forbiddenTriggers) {
      if (Object.hasOwn(onValue, trigger)) {
        return fail(
          `workflow must not declare a ${trigger} trigger: this platform is ` +
            `non-gating (see docs/evidence/w0/2026-08-07-windows-suite-measurement.md)`,
        );
      }
    }
    const jobs = document.jobs;
    if (!isRecord(jobs) || !Object.hasOwn(jobs, jobId)) {
      return fail(`workflow must define job ${jobId}`);
    }

    const job = requireRecord(jobs[jobId], `jobs.${jobId}`);
    if (job["runs-on"] !== runsOn) {
      return fail(`jobs.${jobId}.runs-on must be ${runsOn}`);
    }

    const steps = requireSteps(job.steps, `jobs.${jobId}.steps`);

    let setupNodeIndex = -1;
    for (let index = 0; index < steps.length; index += 1) {
      const step = stepRecord(steps[index], index);
      if (step.uses !== SETUP_NODE_ACTION) {
        continue;
      }
      const withValue = step.with;
      if (!isRecord(withValue)) {
        continue;
      }
      const nodeVersion = withValue["node-version"];
      const versionText =
        typeof nodeVersion === "number"
          ? String(nodeVersion)
          : isString(nodeVersion)
            ? nodeVersion
            : undefined;
      if (versionText === NODE_VERSION) {
        if (setupNodeIndex !== -1) {
          return fail(
            `jobs.${jobId} must have exactly one ${SETUP_NODE_ACTION} step with Node ${NODE_VERSION}`,
          );
        }
        setupNodeIndex = index;
      }
    }
    if (setupNodeIndex === -1) {
      return fail(
        `jobs.${jobId} must include ${SETUP_NODE_ACTION} with Node ${NODE_VERSION}`,
      );
    }

    const gateIndices: number[] = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = stepRecord(steps[index], index);
      if (step.name === STEP_NAME) {
        gateIndices.push(index);
      }
    }
    if (gateIndices.length !== 1) {
      return fail(
        `jobs.${jobId} must define exactly one step named "${STEP_NAME}"`,
      );
    }

    const gateIndex = gateIndices[0];
    if (gateIndex === undefined || gateIndex <= setupNodeIndex) {
      return fail(
        `"${STEP_NAME}" must follow the Node ${NODE_VERSION} setup-node step`,
      );
    }

    const gate = stepRecord(steps[gateIndex], gateIndex);

    if (gate["working-directory"] !== WORKING_DIRECTORY) {
      return fail(
        `"${STEP_NAME}" working-directory must be exactly ${WORKING_DIRECTORY}`,
      );
    }
    if (gate.shell !== SHELL) {
      return fail(`"${STEP_NAME}" shell must be exactly ${SHELL}`);
    }

    if (!isRecord(gate.env)) {
      return fail(`"${STEP_NAME}" env must be a mapping`);
    }
    const envKeys = Object.keys(gate.env);
    if (
      envKeys.length !== 1 ||
      gate.env.CI !== EXPECTED_ENV.CI ||
      envKeys[0] !== "CI"
    ) {
      return fail(`"${STEP_NAME}" env must be exactly { CI: "true" }`);
    }

    if (Object.hasOwn(gate, "if")) {
      return fail(`"${STEP_NAME}" must not set if`);
    }
    if (Object.hasOwn(gate, "continue-on-error")) {
      return fail(`"${STEP_NAME}" must not set continue-on-error`);
    }

    const run = requireString(gate.run, `"${STEP_NAME}" run`);
    const runLines = executableRunLines(run);
    if (runLines.length !== EXPECTED_RUN_LINES.length) {
      return fail(
        `"${STEP_NAME}" run must contain exactly ${String(EXPECTED_RUN_LINES.length)} executable lines`,
      );
    }
    for (const [index, expected] of EXPECTED_RUN_LINES.entries()) {
      if (runLines[index] !== expected) {
        return fail(
          `"${STEP_NAME}" run line ${String(index + 1)} must be exactly: ${expected}`,
        );
      }
    }

    const gateText = JSON.stringify(gate);
    for (const pattern of PROVIDER_CREDENTIAL_PATTERNS) {
      if (pattern.test(gateText)) {
        return fail(
          `"${STEP_NAME}" must not contain provider credential configuration`,
        );
      }
    }
    for (const pattern of LIVE_PROVIDER_CALL_PATTERNS) {
      if (pattern.test(gateText)) {
        return fail(
          `"${STEP_NAME}" must not contain live provider-call configuration`,
        );
      }
    }

    return { ok: true, gate };
  } catch (error) {
    return fail(
      error instanceof Error ? error.message : "workflow contract check failed",
    );
  }
};

/**
 * Comment out the complete real Council step while leaving a comment copy of
 * every field and command. Raw-text search still sees the markers; YAML parse
 * does not.
 */
const commentOutCouncilGateStep = (source: string): string => {
  const lines = source.split("\n");
  const stepHeader = `      - name: ${STEP_NAME}`;
  const start = lines.findIndex((line) => line === stepHeader);
  if (start === -1) {
    throw new Error(`could not find real Council step header: ${stepHeader}`);
  }

  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    // Next job step at the same indentation ends the Council step body.
    if (/^ {6}- /.test(line)) {
      break;
    }
    // Blank line inside a step is still part of it; stop only at next step.
    end += 1;
  }

  const commented = lines.map((line, index) => {
    if (index < start || index >= end) {
      return line;
    }
    return line.length === 0 ? "#" : `# ${line}`;
  });
  return commented.join("\n");
};

describe.each(Object.keys(workflowPaths) as WorkflowId[])(
  "hosted Node 24 Council gate in %s workflow",
  (workflowId) => {
    it("provisions Node 24 and gates the deterministic Council TypeScript suite", async () => {
      const source = await loadWorkflowSource(workflowId);
      const result = checkParsedCouncilGateContract(source, workflowId);

      expect(result.ok, result.ok ? undefined : result.reason).toBe(true);
      if (!result.ok) {
        return;
      }

      expect(result.gate.name).toBe(STEP_NAME);
      expect(result.gate["working-directory"]).toBe(WORKING_DIRECTORY);
      expect(result.gate.shell).toBe(SHELL);
      expect(result.gate.env).toEqual(EXPECTED_ENV);
      expect(executableRunLines(requireString(result.gate.run, "run"))).toEqual(
        [...EXPECTED_RUN_LINES],
      );
    });

    it("rejects a fully commented Council step that still fools raw-text search", async () => {
      const source = await loadWorkflowSource(workflowId);
      const mutated = commentOutCouncilGateStep(source);

      // RED against the old raw-text checker: comments satisfy every assertion.
      expect(
        rawTextCheckerAccepts(mutated),
        "old raw-text checker must incorrectly accept a fully commented Council step",
      ).toBe(true);

      // GREEN after the parser rewrite: real steps[] must contain the gate.
      const result = checkParsedCouncilGateContract(mutated, workflowId);
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.reason).toMatch(/exactly one step named/i);
    });
  },
);
