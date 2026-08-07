/**
 * Pure tool-check report rendering (text + JSON inventory schema).
 */

import type { ToolCheckLane, ToolCheckProfile } from "./tool-check-cli.js";

/** Closed tool row statuses (includes unknown for unhandled ids). */
export type ToolStatus =
  | "ok"
  | "missing"
  | "outdated"
  | "not_authenticated"
  | "degraded"
  | "unknown"
  | "warn";

export type ToolRow = {
  readonly id: string;
  readonly status: ToolStatus;
  readonly detail: string;
};

export type LockAtomicityRow = {
  readonly mechanism: string;
  readonly path: string;
  readonly version: string;
  readonly sha256: string;
  readonly verdict: string;
  readonly evidence_class: string;
  readonly filesystem_classes: readonly string[];
  readonly timestamp: string;
  readonly notes: string;
};

export type ToolCheckInventoryV1 = {
  readonly schema: "foreman.tool-check.v1";
  readonly profile: ToolCheckProfile;
  readonly ready: boolean;
  readonly host: string;
  readonly os: string;
  readonly wsl: boolean;
  readonly time: string;
  readonly repo: string;
  readonly tools: readonly ToolRow[];
  readonly skills: readonly ToolRow[];
  readonly lock_atomicity: readonly LockAtomicityRow[];
  readonly missing: readonly string[];
  readonly outdated: readonly string[];
  readonly degraded: readonly string[];
  readonly not_authenticated: readonly string[];
  readonly lane?: ToolCheckLane;
  readonly lane_ready?: boolean;
};

export type ReportModel = {
  readonly profile: ToolCheckProfile;
  readonly host: string;
  readonly os: string;
  readonly wsl: boolean;
  readonly time: string;
  readonly repo: string;
  readonly tools: readonly ToolRow[];
  readonly skills: readonly ToolRow[];
  readonly lockAtomicity: readonly LockAtomicityRow[];
  readonly lockAtomicityInfo: readonly string[];
  readonly ready: boolean;
  readonly mustFail: readonly string[];
  readonly lane: ToolCheckLane | null;
};

function statusLists(tools: readonly ToolRow[]): {
  missing: string[];
  outdated: string[];
  degraded: string[];
  not_authenticated: string[];
} {
  const missing: string[] = [];
  const outdated: string[] = [];
  const degraded: string[] = [];
  const not_authenticated: string[] = [];
  for (const t of tools) {
    switch (t.status) {
      case "missing":
        missing.push(t.id);
        break;
      case "outdated":
        outdated.push(t.id);
        break;
      case "degraded":
        degraded.push(t.id);
        break;
      case "not_authenticated":
        not_authenticated.push(t.id);
        break;
      default:
        break;
    }
  }
  return { missing, outdated, degraded, not_authenticated };
}

export function laneReadyFromTools(
  tools: readonly ToolRow[],
  lane: ToolCheckLane | null,
): boolean | null {
  if (lane === null) return null;
  const row = tools.find((t) => t.id === lane);
  return row !== undefined && row.status === "ok";
}

/** Build the inventory JSON object (foreman.tool-check.v1). */
export function buildInventoryJson(model: ReportModel): ToolCheckInventoryV1 {
  const lists = statusLists(model.tools);
  const inv: ToolCheckInventoryV1 = {
    schema: "foreman.tool-check.v1",
    profile: model.profile,
    ready: model.ready,
    host: model.host,
    os: model.os,
    wsl: model.wsl,
    time: model.time,
    repo: model.repo,
    tools: model.tools.map((t) => ({
      id: t.id,
      status: t.status,
      detail: t.detail,
    })),
    skills: model.skills.map((t) => ({
      id: t.id,
      status: t.status,
      detail: t.detail,
    })),
    lock_atomicity: model.lockAtomicity.map((r) => ({ ...r })),
    missing: lists.missing,
    outdated: lists.outdated,
    degraded: lists.degraded,
    not_authenticated: lists.not_authenticated,
  };
  if (model.lane !== null) {
    return {
      ...inv,
      lane: model.lane,
      lane_ready: laneReadyFromTools(model.tools, model.lane) === true,
    };
  }
  return inv;
}

export function renderInventoryJson(model: ReportModel): string {
  return JSON.stringify(buildInventoryJson(model), null, 2);
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

/** Human-readable report matching the shell tool-check layout. */
export function renderReportText(model: ReportModel): string {
  const lines: string[] = [];
  lines.push("FOREMAN TOOL CHECK");
  lines.push(`profile: ${model.profile}`);
  lines.push(
    `host: ${model.host}  os: ${model.os}  wsl: ${model.wsl ? 1 : 0}`,
  );
  lines.push(`time: ${model.time}`);
  lines.push(`repo: ${model.repo}`);
  lines.push("---");
  lines.push(`${pad("TOOL", 16)} ${pad("STATUS", 10)} DETAIL`);
  for (const t of model.tools) {
    lines.push(`${pad(t.id, 16)} ${pad(t.status, 10)} ${t.detail}`);
  }

  const docsGroup: string[] = [];
  for (const did of ["markdownlint-cli2", "codespell", "lychee"] as const) {
    const row = model.tools.find((t) => t.id === did);
    if (row) docsGroup.push(`${did}:${row.status}`);
  }
  if (docsGroup.length > 0) {
    lines.push(`DOCS_GROUP: ${docsGroup.join(" ")}`);
  }

  lines.push("---");
  lines.push("LOCK_ATOMICITY");
  lines.push(
    `${pad("MECH", 8)} ${pad("VERDICT", 10)} ${pad("EVIDENCE", 16)} ${pad("FS_CLASSES", 12)} PATH`,
  );
  for (const r of model.lockAtomicity) {
    lines.push(
      `${pad(r.mechanism, 8)} ${pad(r.verdict, 10)} ${pad(r.evidence_class, 16)} ${pad(r.filesystem_classes.join(","), 12)} ${r.path}`,
    );
    if (r.sha256.length > 0) {
      lines.push(`  sha256=${r.sha256}`);
    }
    if (r.version.length > 0) {
      lines.push(`  version=${r.version}`);
    }
  }
  for (const info of model.lockAtomicityInfo) {
    lines.push(info);
  }

  lines.push("---");
  lines.push("SKILLS");
  lines.push(`${pad("SKILL", 16)} ${pad("STATUS", 10)} DETAIL`);
  for (const s of model.skills) {
    lines.push(`${pad(s.id, 16)} ${pad(s.status, 10)} ${s.detail}`);
  }

  lines.push("---");
  if (model.ready) {
    lines.push(
      `READY: yes — profile '${model.profile}' must-tools are OK`,
    );
  } else {
    lines.push("READY: no — fix must-tools before implementation work");
    lines.push(`MUST_FAIL: ${model.mustFail.join(" ")}`);
  }

  const lists = statusLists(model.tools);
  if (lists.missing.length > 0) {
    lines.push(`MISSING: ${lists.missing.join(" ")}`);
  }
  if (lists.outdated.length > 0) {
    lines.push(`OUTDATED: ${lists.outdated.join(" ")}`);
  }
  if (lists.degraded.length > 0) {
    lines.push(`DEGRADED: ${lists.degraded.join(" ")}`);
  }
  if (lists.not_authenticated.length > 0) {
    lines.push(`NOT_AUTHENTICATED: ${lists.not_authenticated.join(" ")}`);
  }

  if (model.lane !== null) {
    const lr = laneReadyFromTools(model.tools, model.lane);
    lines.push(
      `LANE_READY: ${model.lane}=${lr === true ? "yes" : "no"}`,
    );
  }

  lines.push("---");
  lines.push("NEXT:");
  if (!model.ready) {
    lines.push(`  bash env/bootstrap-wsl.sh --profile ${model.profile}`);
    lines.push(
      `  # then re-run: bash env/tool-check.sh --profile ${model.profile}`,
    );
  } else {
    lines.push("  proceed with /foreman soft or hard implementation");
  }

  return lines.join("\n");
}

/** Profile membership (mirrors shell must_/should_ arrays). */
export function profileToolIds(
  profile: ToolCheckProfile,
  isWsl: boolean,
): { readonly must: readonly string[]; readonly should: readonly string[] } {
  const mustSoft = [
    "git",
    "python3",
    "jq",
    "grok",
    "codex",
    "strace",
    "foreman_skill",
  ];
  const mustHard = [
    "git",
    "python3",
    "jq",
    "docker",
    "flock",
    "strace",
    "foreman_skill",
  ];
  const mustFull = [
    "git",
    "python3",
    "jq",
    "grok",
    "codex",
    "docker",
    "flock",
    "strace",
    "bats",
    "sqlite3",
    "markdownlint-cli2",
    "codespell",
    "lychee",
    "foreman_skill",
  ];
  const mustDurable = ["git", "jq", "coreutils", "bash", "flock", "strace"];
  const shouldSoft = ["node", "npm", "foreman_home_fs"];
  const shouldHard = [
    "shellcheck",
    "bats",
    "sqlite3",
    "gh",
    "timeout",
    "grok",
    "codex",
    "foreman_home_fs",
  ];
  const shouldFull = [
    "node",
    "npm",
    "shellcheck",
    "gh",
    "timeout",
    "bun",
    "pueue",
    "foreman_home_fs",
  ];
  const shouldDurable = ["nats-server", "nats-cli", "foreman_home_fs"];

  let must: string[];
  let should: string[];
  switch (profile) {
    case "soft":
      must = [...mustSoft];
      should = [...shouldSoft];
      break;
    case "hard":
      must = [...mustHard];
      should = [...shouldHard];
      break;
    case "full":
      must = [...mustFull];
      should = [...shouldFull];
      break;
    case "durable":
      must = [...mustDurable];
      should = [...shouldDurable];
      break;
  }
  if (isWsl) {
    should.push("foreman-launch");
  }
  return { must, should };
}

export const SKILL_IDS = [
  "foreman",
  "scrapling",
  "graphify",
  "superpowers",
  "council",
] as const;
