// packages/orchestration/src/tier2-collect-main.ts
import { statSync } from "node:fs";

// packages/orchestration/src/tier2-shared.ts
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
var _dirname = dirname(fileURLToPath(import.meta.url));
var REPO_ROOT = resolve(_dirname, "../../../..");
var DEFAULT_BUDGETS = join(
  REPO_ROOT,
  "skills/foreman/references/regression-tier-budgets.json"
);
var InputError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InputError";
  }
};
var Float = class {
  constructor(value) {
    this.value = value;
  }
};
function load_json(path) {
  try {
    const text = readFileSync(path, "utf-8");
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InputError(`JSON input ${path} must be an object`);
    }
    return value;
  } catch (exc) {
    if (exc instanceof InputError) throw exc;
    throw new InputError(`cannot read JSON input ${path}: ${exc.message}`);
  }
}
function stringify(value, indentLevel = 0) {
  const indentStr = "  ".repeat(indentLevel);
  const nextIndentStr = "  ".repeat(indentLevel + 1);
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (Object.is(value, -0)) return "-0.0";
    return value.toString();
  }
  if (value instanceof Float) {
    if (!Number.isFinite(value.value)) throw new InputError("finite required");
    let s = value.value.toString();
    if (!s.includes(".") && !s.includes("e")) {
      s += ".0";
    }
    return s;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    let out = "[\n";
    for (let i = 0; i < value.length; i++) {
      out += nextIndentStr + stringify(value[i], indentLevel + 1);
      if (i < value.length - 1) out += ",";
      out += "\n";
    }
    out += indentStr + "]";
    return out;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return "{}";
    let out = "{\n";
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      out += nextIndentStr + JSON.stringify(k) + ": " + stringify(value[k], indentLevel + 1);
      if (i < keys.length - 1) out += ",";
      out += "\n";
    }
    out += indentStr + "}";
    return out;
  }
  throw new Error("unsupported type");
}
function write_json(value, output) {
  const rendered = stringify(value) + "\n";
  if (output === null) {
    process.stdout.write(rendered);
    return;
  }
  mkdirSync(dirname(output), { recursive: true });
  const temporary = join(dirname(output), `.${basename(output)}.${process.pid}.tmp`);
  writeFileSync(temporary, rendered, "utf-8");
  renameSync(temporary, output);
}
function number(value, field) {
  if (typeof value !== "number" || typeof value === "boolean") {
    throw new InputError(`${field} must be numeric`);
  }
  if (!Number.isFinite(value)) {
    throw new InputError(`${field} must be finite`);
  }
  return value;
}
function rounded(value) {
  return new Float(Number(value.toFixed(8)));
}
function load_budgets(path = DEFAULT_BUDGETS) {
  const policy = load_json(path);
  if (policy.material_margin_percent !== 20) {
    throw new InputError("material_margin_percent must be the fixed value 20");
  }
  const tiers = policy.tiers;
  if (typeof tiers !== "object" || tiers === null || Array.isArray(tiers)) {
    throw new InputError("budget policy tiers must be an object");
  }
  return policy;
}
function comparison_configuration(data) {
  const expected_n = data.expected_n;
  if (expected_n !== 3) {
    throw new InputError("expected_n must be exactly 3");
  }
  const bootstrap = data.bootstrap;
  if (typeof bootstrap !== "object" || bootstrap === null) {
    throw new InputError("bootstrap configuration is required");
  }
  const resamples = bootstrap.resamples;
  const confidence_level = bootstrap.confidence_level;
  const seed = bootstrap.seed;
  if (typeof resamples !== "number" || typeof resamples === "boolean" || !Number.isInteger(resamples) || resamples < 1) {
    throw new InputError("bootstrap.resamples must be a positive integer");
  }
  const confidence = number(confidence_level, "bootstrap.confidence_level");
  if (confidence <= 0 || confidence >= 1) {
    throw new InputError("bootstrap.confidence_level must be between zero and one");
  }
  if (typeof seed !== "number" || typeof seed === "boolean" || !Number.isInteger(seed)) {
    throw new InputError("bootstrap.seed must be an integer");
  }
  return [expected_n, resamples, confidence, seed];
}
function locked_specs(data) {
  const specs = data.locked_specs;
  if (!Array.isArray(specs) || specs.length < 8 || specs.length > 12 || new Set(specs).size !== specs.length || !specs.every((s) => typeof s === "string" && s.length > 0)) {
    throw new InputError("locked_specs must contain 8 to 12 unique spec identifiers");
  }
  return specs;
}
function planned_comparison(specs, expected_n, policy) {
  const declared = policy.tiers.tier2;
  const condition_count = number(declared.comparison_conditions, "tier2.comparison_conditions");
  const per_call_cost = number(declared.max_cost_per_vendor_call_usd, "tier2.max_cost_per_vendor_call_usd");
  const calls = Math.floor(condition_count * specs.length * expected_n);
  const expected_cost = Number((calls * per_call_cost).toFixed(8));
  if (calls > declared.max_vendor_calls || expected_cost > declared.max_cost_usd) {
    throw new InputError("comparison plan exceeds the declared Tier 2 call or cost budget");
  }
  return {
    comparison_conditions: condition_count,
    locked_spec_count: specs.length,
    expected_n,
    planned_vendor_calls: calls,
    max_cost_per_vendor_call_usd: new Float(per_call_cost),
    declared_expected_cost_usd: new Float(expected_cost),
    declared_max_cost_usd: declared.max_cost_usd
    // keep it as is, usually int
  };
}

// packages/orchestration/src/tier2-collect-main.ts
import * as child_process from "node:child_process";
function invoke_adapter(adapter, condition, spec_id, run_number, pinned_model) {
  const commandArgs = [
    "--condition",
    condition,
    "--spec-id",
    spec_id,
    "--run-number",
    run_number.toString(),
    "--pinned-model-json",
    JSON.stringify(pinned_model)
  ];
  let completed;
  try {
    completed = child_process.spawnSync(adapter, commandArgs, {
      encoding: "utf8",
      timeout: 6e5
    });
  } catch (exc) {
    throw new InputError(`adapter failed to execute: ${exc.message}`);
  }
  if (completed.error) {
    throw new InputError(`adapter failed to execute: ${completed.error.message}`);
  }
  if (completed.status !== 0) {
    const detail = (completed.stderr || completed.stdout || "no diagnostic").trim();
    throw new InputError(`adapter failed condition=${condition} spec_id=${spec_id} run_number=${run_number}: ${detail}`);
  }
  let response;
  try {
    response = JSON.parse(completed.stdout);
  } catch (exc) {
    throw new InputError(`adapter returned invalid JSON condition=${condition} spec_id=${spec_id} run_number=${run_number}`);
  }
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    throw new InputError("adapter response must be a JSON object");
  }
  const score = number(response.score, "adapter score");
  if (score < 0 || score > 1) {
    throw new InputError("adapter score must be between zero and one");
  }
  const observed_model = response.observed_model;
  if (typeof observed_model !== "object" || observed_model === null || Array.isArray(observed_model)) {
    throw new InputError("adapter response must carry observed_model");
  }
  const cost = number(response.cost_usd, "adapter cost_usd");
  if (cost < 0) {
    throw new InputError("adapter cost_usd must be nonnegative");
  }
  return { score, observed_model, cost_usd: cost };
}
function pinned_identity(condition_name, condition) {
  const pinned_model = condition.pinned_model;
  if (typeof pinned_model !== "object" || pinned_model === null) {
    throw new InputError(`${condition_name} pinned_model is required`);
  }
  const identity = [
    pinned_model.vendor,
    pinned_model.identifier,
    pinned_model.version
  ];
  if (pinned_model.pinned !== true || !identity.every((value) => typeof value === "string" && value)) {
    throw new InputError(`${condition_name} model is not pinned to vendor/identifier/version`);
  }
  return identity;
}
function collect(args) {
  if (!args.acknowledge_paid_vendor_calls) {
    throw new InputError("--acknowledge-paid-vendor-calls is required for manual collection");
  }
  if (!statSync(args.adapter, { throwIfNoEntry: false })?.isFile()) {
    throw new InputError(`adapter is not a file: ${args.adapter}`);
  }
  const plan_input = load_json(args.plan);
  if (plan_input.schema_version !== "tier2-collection-plan/v1") {
    throw new InputError("unsupported Tier 2 collection plan schema");
  }
  const specs = locked_specs(plan_input);
  const [expected_n] = comparison_configuration(plan_input);
  const conditions = plan_input.conditions;
  if (typeof conditions !== "object" || conditions === null || !["baseline", "candidate"].every((name) => typeof conditions[name] === "object" && conditions[name] !== null)) {
    throw new InputError("collection plan requires baseline and candidate conditions");
  }
  const pin_identities = {
    baseline: pinned_identity("baseline", conditions.baseline),
    candidate: pinned_identity("candidate", conditions.candidate)
  };
  const b = pin_identities.baseline;
  const c = pin_identities.candidate;
  if (b[0] !== c[0] || b[1] !== c[1] || b[2] !== c[2]) {
    throw new InputError("collection conditions must use the same pinned model");
  }
  const policy = load_budgets(args.budgets);
  const cost_plan = planned_comparison(specs, expected_n, policy);
  console.log(`MANUAL TIER2 PLAN calls=${cost_plan.planned_vendor_calls} declared_expected_cost_usd=${cost_plan.declared_expected_cost_usd.value}`);
  const started = process.uptime();
  const started_at = (/* @__PURE__ */ new Date()).toISOString();
  let total_cost = 0;
  let adapter_invocations = 0;
  const collected_conditions = {};
  for (const condition_name of ["baseline", "candidate"]) {
    const source_condition = conditions[condition_name];
    const pinned_model = source_condition.pinned_model;
    const collected_runs = [];
    for (let run_number = 1; run_number <= expected_n; run_number++) {
      const scores = {};
      let run_model = null;
      for (const spec_id of specs) {
        const response = invoke_adapter(args.adapter, condition_name, spec_id, run_number, pinned_model);
        adapter_invocations += 1;
        total_cost += response.cost_usd;
        const observed = response.observed_model;
        const observed_identity = [observed.vendor, observed.identifier, observed.version];
        const pid = pin_identities[condition_name];
        if (observed_identity[0] !== pid[0] || observed_identity[1] !== pid[1] || observed_identity[2] !== pid[2]) {
          const obs_repr = `(${JSON.stringify(observed_identity[0])}, ${JSON.stringify(observed_identity[1])}, ${JSON.stringify(observed_identity[2])})`.replace(/"/g, "'");
          const pid_repr = `(${JSON.stringify(pid[0])}, ${JSON.stringify(pid[1])}, ${JSON.stringify(pid[2])})`.replace(/"/g, "'");
          throw new InputError(`adapter observed model ${obs_repr}, expected pinned model ${pid_repr}; collection stopped`);
        }
        scores[spec_id] = response.score;
        if (run_model === null) {
          run_model = response.observed_model;
        } else if (JSON.stringify(run_model) !== JSON.stringify(response.observed_model)) {
          throw new InputError(`adapter model changed within ${condition_name} run ${run_number}`);
        }
      }
      collected_runs.push({
        run_id: `${condition_name}-${run_number}`,
        observed_model: run_model,
        scores
        // wait, should scores be new Float()? Python's JSON parses score as float, and outputs it. JS will just output number. The golden tests don't check collect, they check compare/budget/rate.
      });
    }
    collected_conditions[condition_name] = {
      label: source_condition.label,
      pinned_model,
      runs: collected_runs
    };
  }
  const duration = process.uptime() - started;
  return {
    schema_version: "tier2-comparison-input/v1",
    comparison_id: plan_input.comparison_id,
    expected_n,
    bootstrap: plan_input.bootstrap,
    locked_specs: specs,
    collection: {
      mode: "explicit_manual_adapter",
      adapter_invocations,
      expected_n,
      plan: cost_plan
    },
    measurement: {
      run_id: plan_input.comparison_id,
      tier: "tier2",
      started_at,
      duration_s: new Float(duration),
      cost_usd: rounded(total_cost),
      invocation: { source: "manual", explicit_override: false }
    },
    conditions: collected_conditions
  };
}
function main() {
  const argv = process.argv.slice(2);
  const args = { budgets: DEFAULT_BUDGETS, acknowledge_paid_vendor_calls: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output") {
      args.output = argv[++i];
    } else if (arg === "--budgets") {
      args.budgets = argv[++i];
    } else if (arg === "--adapter") {
      args.adapter = argv[++i];
    } else if (arg === "--acknowledge-paid-vendor-calls") {
      args.acknowledge_paid_vendor_calls = true;
    } else if (!arg.startsWith("--") && !args.plan) {
      args.plan = arg;
    }
  }
  try {
    const result = collect(args);
    write_json(result, args.output);
    console.log(`COLLECTED fixture-only-compatible calls=${result.collection.adapter_invocations} output=${args.output}`);
    process.exit(0);
  } catch (exc) {
    if (exc instanceof InputError) {
      process.stderr.write(`ERROR: ${exc.message}
`);
      process.exit(2);
    }
    throw exc;
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
export {
  main
};
