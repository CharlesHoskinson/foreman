import { statSync } from "node:fs";
import {
  DEFAULT_BUDGETS,
  InputError,
  Float,
  load_json,
  write_json,
  number,
  rounded,
  load_budgets,
  comparison_configuration,
  locked_specs,
  planned_comparison
} from "./tier2-shared.js";
import * as child_process from "node:child_process";

function invoke_adapter(
  adapter: string,
  condition: string,
  spec_id: string,
  run_number: number,
  pinned_model: any
): any {
  const commandArgs = [
    "--condition", condition,
    "--spec-id", spec_id,
    "--run-number", run_number.toString(),
    "--pinned-model-json", JSON.stringify(pinned_model)
  ];
  let completed;
  try {
    completed = child_process.spawnSync(adapter, commandArgs, {
      encoding: "utf8",
      timeout: 600000
    });
  } catch (exc: any) {
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
  } catch (exc: any) {
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
  return { score: score, observed_model: observed_model, cost_usd: cost };
}

function pinned_identity(condition_name: string, condition: any): [string, string, string] {
  const pinned_model = condition.pinned_model;
  if (typeof pinned_model !== "object" || pinned_model === null) {
    throw new InputError(`${condition_name} pinned_model is required`);
  }
  const identity: [string, string, string] = [
    pinned_model.vendor,
    pinned_model.identifier,
    pinned_model.version
  ];
  if (pinned_model.pinned !== true || !identity.every(value => typeof value === "string" && value)) {
    throw new InputError(`${condition_name} model is not pinned to vendor/identifier/version`);
  }
  return identity;
}

function collect(args: any): any {
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
  if (typeof conditions !== "object" || conditions === null || 
      !["baseline", "candidate"].every(name => typeof conditions[name] === "object" && conditions[name] !== null)) {
    throw new InputError("collection plan requires baseline and candidate conditions");
  }
  const pin_identities: Record<string, [string, string, string]> = {
    baseline: pinned_identity("baseline", conditions.baseline),
    candidate: pinned_identity("candidate", conditions.candidate)
  };
  const b = pin_identities.baseline!;
  const c = pin_identities.candidate!;
  if (b[0] !== c[0] || b[1] !== c[1] || b[2] !== c[2]) {
    throw new InputError("collection conditions must use the same pinned model");
  }
  const policy = load_budgets(args.budgets);
  const cost_plan = planned_comparison(specs, expected_n, policy);
  console.log(`MANUAL TIER2 PLAN calls=${cost_plan.planned_vendor_calls} declared_expected_cost_usd=${cost_plan.declared_expected_cost_usd.value}`);

  const started = process.uptime();
  const started_at = new Date().toISOString();
  let total_cost = 0.0;
  let adapter_invocations = 0;
  const collected_conditions: any = {};

  for (const condition_name of ["baseline", "candidate"]) {
    const source_condition = conditions[condition_name];
    const pinned_model = source_condition.pinned_model;
    const collected_runs = [];
    for (let run_number = 1; run_number <= expected_n; run_number++) {
      const scores: Record<string, number> = {};
      let run_model: any = null;
      for (const spec_id of specs) {
        const response = invoke_adapter(args.adapter, condition_name, spec_id, run_number, pinned_model);
        adapter_invocations += 1;
        total_cost += response.cost_usd;
        const observed = response.observed_model;
        const observed_identity = [observed.vendor, observed.identifier, observed.version];
        const pid = pin_identities[condition_name]!;
        if (observed_identity[0] !== pid[0] || observed_identity[1] !== pid[1] || observed_identity[2] !== pid[2]) {
          const obs_repr = `(${JSON.stringify(observed_identity[0])}, ${JSON.stringify(observed_identity[1])}, ${JSON.stringify(observed_identity[2])})`.replace(/"/g, "'");
          const pid_repr = `(${JSON.stringify(pid[0])}, ${JSON.stringify(pid[1])}, ${JSON.stringify(pid[2])})`.replace(/"/g, "'");
          throw new InputError(`adapter observed model ${obs_repr}, expected pinned model ${pid_repr}; collection stopped`);
        }
        scores[spec_id] = response.score; // wait, do they need to be floats? In TS a number is just a number. The python outputs float if it has decimals.
        // wait, Python's response["score"] is a float and collected, so we keep it as number.
        if (run_model === null) {
          run_model = response.observed_model;
        } else if (JSON.stringify(run_model) !== JSON.stringify(response.observed_model)) {
          throw new InputError(`adapter model changed within ${condition_name} run ${run_number}`);
        }
      }
      collected_runs.push({
        run_id: `${condition_name}-${run_number}`,
        observed_model: run_model,
        scores: scores, // wait, should scores be new Float()? Python's JSON parses score as float, and outputs it. JS will just output number. The golden tests don't check collect, they check compare/budget/rate.
      });
    }
    collected_conditions[condition_name] = {
      label: source_condition.label,
      pinned_model: pinned_model,
      runs: collected_runs,
    };
  }

  const duration = process.uptime() - started;
  return {
    schema_version: "tier2-comparison-input/v1",
    comparison_id: plan_input.comparison_id,
    expected_n: expected_n,
    bootstrap: plan_input.bootstrap,
    locked_specs: specs,
    collection: {
      mode: "explicit_manual_adapter",
      adapter_invocations: adapter_invocations,
      expected_n: expected_n,
      plan: cost_plan,
    },
    measurement: {
      run_id: plan_input.comparison_id,
      tier: "tier2",
      started_at: started_at,
      duration_s: new Float(duration),
      cost_usd: rounded(total_cost),
      invocation: { source: "manual", explicit_override: false },
    },
    conditions: collected_conditions,
  };
}

export function main() {
  const argv = process.argv.slice(2);
  const args: any = { budgets: DEFAULT_BUDGETS, acknowledge_paid_vendor_calls: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--output") {
      args.output = argv[++i]!;
    } else if (arg === "--budgets") {
      args.budgets = argv[++i]!;
    } else if (arg === "--adapter") {
      args.adapter = argv[++i]!;
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
  } catch (exc: any) {
    if (exc instanceof InputError) {
      process.stderr.write(`ERROR: ${exc.message}\n`);
      process.exit(2);
    }
    throw exc;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
