import { fsum,
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
  planned_comparison,
  Random
} from "./tier2-shared.js";
import { parseArgs } from "node:util";

function percentile(sorted_values: number[], probability: number): number {
  const position = (sorted_values.length - 1) * probability;
  const lower_index = Math.floor(position);
  const upper_index = Math.ceil(position);
  if (lower_index === upper_index) {
    return sorted_values[lower_index]!;
  }
  const fraction = position - lower_index;
  return (
    sorted_values[lower_index]! * (1.0 - fraction) +
    sorted_values[upper_index]! * fraction
  );
}

function bootstrap_ci(
  values: number[],
  expected_n: number,
  resamples: number,
  confidence_level: number,
  seed: string
): any {
  const denominator = { name: "observed runs", value: values.length };
  if (values.length !== expected_n) {
    return {
      status: "uncomputable",
      denominator: denominator,
      required_n: expected_n,
      resamples: resamples,
      confidence_level: new Float(confidence_level),
    };
  }

  const rng = new Random(seed);
  const means: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const chosen: number[] = [];
    for (let j = 0; j < expected_n; j++) {
      chosen.push(values[rng.randrange(expected_n)]!);
    }
    let sum = fsum(chosen);
    means.push(sum / expected_n);
  }
  means.sort((a, b) => a - b);
  const tail = (1.0 - confidence_level) / 2.0;
  const lower = percentile(means, tail);
  const upper = percentile(means, 1.0 - tail);
  const width = upper - lower;
  return {
    status: "computed",
    lower: new Float(lower),
    upper: new Float(upper),
    width: new Float(width),
    half_width: new Float(width / 2.0),
    denominator: denominator,
    resamples: resamples,
    confidence_level: new Float(confidence_level),
  };
}

function rate_record(numerator: number, denominator_name: string, denominator: any): any {
  const denominator_record = { name: denominator_name, value: denominator };
  const d_val = denominator instanceof Float ? denominator.value : denominator;
  if (d_val < 0) {
    throw new InputError("rate denominator must be nonnegative");
  }
  if (d_val === 0) {
    return {
      status: "uncomputable",
      denominator: denominator_record,
      decision: "not_evaluated",
    };
  }
  const value = numerator / d_val;
  return {
    status: "computed",
    value: rounded(value),
    percent: rounded(value * 100.0),
    denominator: denominator_record,
    decision: "evaluated",
  };
}

function budget_field(
  actual: number,
  declared: number,
  field: string,
  material_margin_percent: number
): any {
  const delta = actual - declared;
  if (declared === 0) {
    const breach = actual > 0;
    const margin = rate_record(delta, `declared ${field} budget`, 0);
    return {
      actual: new Float(actual),
      declared: new Float(declared),
      delta: rounded(delta),
      budget_breach: breach,
      budget_review: breach,
      margin_percent: margin,
    };
  }

  const denominator = { name: `declared ${field} budget`, value: new Float(declared) };
  const margin = {
    status: "computed",
    value: rounded((delta / declared) * 100.0),
    denominator: denominator,
    decision: "evaluated",
  };
  const breach = actual > declared;
  const review = actual > declared * (1.0 + material_margin_percent / 100.0);
  return {
    actual: new Float(actual),
    declared: new Float(declared),
    delta: rounded(delta),
    budget_breach: breach,
    budget_review: review,
    margin_percent: margin,
  };
}

function evaluate_cadence(run: any, declared: any, tier: string): any {
  const invocation = run.invocation;
  if (typeof invocation !== "object" || invocation === null) {
    throw new InputError(`${tier} run record must name its invocation source`);
  }
  const source = invocation.source;
  const override = invocation.explicit_override;
  if (typeof source !== "string" || !source) {
    throw new InputError(`${tier} invocation source must be a nonempty string`);
  }
  if (typeof override !== "boolean") {
    throw new InputError(`${tier} invocation explicit_override must be boolean`);
  }
  const allowed = declared.allowed_invocation_sources;
  if (!Array.isArray(allowed) || !allowed.every(item => typeof item === "string")) {
    throw new InputError(`${tier} allowed_invocation_sources must be an array of strings`);
  }
  const record = {
    source: source,
    allowed_sources: allowed,
    explicit_override: override,
    declared_cadence: declared.cadence,
  };
  if (allowed.includes(source)) {
    return { ...record, status: "permitted", decision: "evaluated" };
  }
  if (tier !== "tier2" && override) {
    return { ...record, status: "overridden", decision: "evaluated" };
  }
  return {
    ...record,
    status: "refused",
    decision: "not_evaluated",
    reason: "invocation source is more frequent than the declared cadence permits",
  };
}

function evaluate_budget(run: any, policy: any): any {
  const tier = run.tier;
  const tiers = policy.tiers;
  if (!(tier in tiers)) {
    throw new InputError(`unknown tier in run record: ${tier}`);
  }
  const declared = tiers[tier];
  const duration = number(run.duration_s, "duration_s");
  const cost = number(run.cost_usd, "cost_usd");
  if (duration < 0 || cost < 0) {
    throw new InputError("duration_s and cost_usd must be nonnegative");
  }
  const material_margin = number(policy.material_margin_percent, "material margin");
  const duration_check = budget_field(
    duration,
    number(declared.max_duration_s, `${tier}.max_duration_s`),
    "duration_s",
    material_margin
  );
  const cost_check = budget_field(
    cost,
    number(declared.max_cost_usd, `${tier}.max_cost_usd`),
    "cost_usd",
    material_margin
  );
  const cadence_check = evaluate_cadence(run, declared, tier);
  const result = {
    run_id: run.run_id,
    tier: tier,
    started_at: run.started_at,
    duration_s: new Float(duration),
    cost_usd: new Float(cost),
    declared_budget: declared,
    invocation: run.invocation,
    cadence_check: cadence_check,
    cadence_permitted: ["permitted", "overridden"].includes(cadence_check.status),
    material_margin_percent: new Float(material_margin),
    fields: { duration_s: duration_check, cost_usd: cost_check },
    budget_breach: duration_check.budget_breach || cost_check.budget_breach,
    budget_review: duration_check.budget_review || cost_check.budget_review,
  };
  return result;
}

function validate_model_pin(data: any): string[] {
  const reasons: string[] = [];
  const conditions = data.conditions;
  const pins: Record<string, [any, any, any]> = {};
  for (const condition_name of ["baseline", "candidate"]) {
    const condition = conditions[condition_name];
    const pin = condition.pinned_model;
    if (typeof pin !== "object" || pin === null) {
      reasons.push(`${condition_name} pinned model is missing`);
      continue;
    }
    const identity: [any, any, any] = [pin.vendor, pin.identifier, pin.version];
    pins[condition_name] = identity;
    if (
      pin.pinned !== true ||
      !identity.every(value => typeof value === "string" && value)
    ) {
      reasons.push(`${condition_name} model is not pinned to vendor/identifier/version`);
    }
    const runs = Array.isArray(condition.runs) ? condition.runs : [];
    for (let index = 1; index <= runs.length; index++) {
      const run = runs[index - 1];
      const observed = (typeof run === "object" && run !== null) ? run.observed_model : null;
      const observed_identity = (typeof observed === "object" && observed !== null)
        ? [observed.vendor, observed.identifier, observed.version]
        : [undefined, undefined, undefined];
      
      const identityMatches = observed_identity[0] === identity[0] &&
                              observed_identity[1] === identity[1] &&
                              observed_identity[2] === identity[2];

      if (!identityMatches) {
        const run_id = (typeof run === "object" && run !== null && run.run_id !== undefined) ? run.run_id : index;
        const obs_repr = `(${JSON.stringify(observed_identity[0])}, ${JSON.stringify(observed_identity[1])}, ${JSON.stringify(observed_identity[2])})`.replace(/"/g, "'");
        const id_repr = `(${JSON.stringify(identity[0])}, ${JSON.stringify(identity[1])}, ${JSON.stringify(identity[2])})`.replace(/"/g, "'");
        reasons.push(`${condition_name} run ${run_id} observed model ${obs_repr}, expected pinned model ${id_repr}`);
      }
    }
  }
  if (Object.keys(pins).length === 2) {
    const b = pins.baseline!;
    const c = pins.candidate!;
    if (b[0] !== c[0] || b[1] !== c[1] || b[2] !== c[2]) {
      const brepr = `(${JSON.stringify(b[0])}, ${JSON.stringify(b[1])}, ${JSON.stringify(b[2])})`.replace(/"/g, "'");
      const crepr = `(${JSON.stringify(c[0])}, ${JSON.stringify(c[1])}, ${JSON.stringify(c[2])})`.replace(/"/g, "'");
      reasons.push(`comparison conditions use different pinned models: baseline=${brepr} candidate=${crepr}`);
    }
  }
  return reasons;
}

function condition_samples(condition: any, spec_id: string): number[] {
  const runs = condition.runs;
  if (!Array.isArray(runs)) {
    throw new InputError("condition runs must be an array");
  }
  const samples: number[] = [];
  for (const run of runs) {
    if (typeof run !== "object" || run === null) {
      throw new InputError("each condition run must be an object");
    }
    const scores = run.scores;
    if (typeof scores !== "object" || scores === null) {
      throw new InputError("each condition run must carry a scores object");
    }
    if (!(spec_id in scores)) {
      continue;
    }
    const score = number(scores[spec_id], `score for ${spec_id}`);
    if (score < 0 || score > 1) {
      throw new InputError(`score for ${spec_id} must be between zero and one`);
    }
    samples.push(score);
  }
  return samples;
}

function validate_run_structure(conditions: any, specs: string[], expected_n: number): void {
  const spec_set = new Set(specs);
  for (const condition_name of ["baseline", "candidate"]) {
    const runs = conditions[condition_name].runs;
    if (!Array.isArray(runs) || runs.length !== expected_n) {
      throw new InputError(`${condition_name} condition must contain exactly ${expected_n} run records`);
    }
    const run_ids: string[] = [];
    for (const run of runs) {
      if (typeof run !== "object" || run === null) {
        throw new InputError(`${condition_name} run records must be objects`);
      }
      const run_id = run.run_id;
      if (typeof run_id !== "string" || !run_id) {
        throw new InputError(`${condition_name} run_id values must be nonempty strings`);
      }
      run_ids.push(run_id);
      const scores = run.scores;
      if (typeof scores !== "object" || scores === null) {
        throw new InputError(`${condition_name} run ${run_id} must carry a scores object`);
      }
      const extra_specs = Object.keys(scores).filter(k => !spec_set.has(k)).sort();
      if (extra_specs.length > 0) {
        throw new InputError(`${condition_name} run ${run_id} has unlocked score keys: ` + extra_specs.join(", "));
      }
    }
    if (new Set(run_ids).size !== run_ids.length) {
      throw new InputError(`${condition_name} run_id values must be unique`);
    }
  }
}

function condition_result(
  condition_name: string,
  condition: any,
  spec_id: string,
  expected_n: number,
  resamples: number,
  confidence_level: number,
  seed: number
): any {
  const samples = condition_samples(condition, spec_id);
  let point_estimate: any;
  if (samples.length > 0) {
    point_estimate = new Float(fsum(samples) / samples.length);
  } else {
    point_estimate = {
      status: "uncomputable",
      denominator: { name: "observed runs", value: 0 },
    };
  }
  return {
    model: condition.pinned_model,
    n: samples.length,
    point_estimate: point_estimate,
    confidence_interval: bootstrap_ci(
      samples,
      expected_n,
      resamples,
      confidence_level,
      `${seed}:${condition_name}:${spec_id}`
    ),
  };
}

function evaluate_comparison(data: any, policy: any): any {
  if (data.schema_version !== "tier2-comparison-input/v1") {
    throw new InputError("unsupported Tier 2 comparison input schema");
  }
  const specs = locked_specs(data);
  const [expected_n, resamples, confidence_level, seed] = comparison_configuration(data);
  const conditions = data.conditions;
  if (typeof conditions !== "object" || conditions === null || 
      !["baseline", "candidate"].every(name => typeof conditions[name] === "object" && conditions[name] !== null)) {
    throw new InputError("baseline and candidate conditions are required");
  }
  validate_run_structure(conditions, specs, expected_n);

  const measurement = data.measurement;
  if (typeof measurement !== "object" || measurement === null || measurement.tier !== "tier2") {
    throw new InputError("a Tier 2 measurement run record is required");
  }
  const run_record = evaluate_budget(measurement, policy);

  const invalid_reasons = validate_model_pin(data);
  if (!run_record.cadence_permitted) {
    invalid_reasons.push(`Tier 2 comparison invocation refused by cadence policy: source=${run_record.cadence_check.source}`);
  }
  const results = [];
  for (const spec_id of specs) {
    const baseline = condition_result("baseline", conditions.baseline, spec_id, expected_n, resamples, confidence_level, seed);
    const candidate = condition_result("candidate", conditions.candidate, spec_id, expected_n, resamples, confidence_level, seed);
    
    const baseline_point = baseline.point_estimate instanceof Float ? baseline.point_estimate.value : null;
    const candidate_point = candidate.point_estimate instanceof Float ? candidate.point_estimate.value : null;
    
    const ci_computed = (
      baseline.confidence_interval.status === "computed" &&
      candidate.confidence_interval.status === "computed"
    );
    const points_computed = baseline_point !== null && candidate_point !== null;
    
    let absolute_difference: any = null;
    let point_estimate_difference: any = null;
    let relative_difference: any;
    let uncertainty_half_width: any = null;
    let difference = 0.0;
    
    if (points_computed) {
      difference = candidate_point! - baseline_point!;
      point_estimate_difference = new Float(difference);
      absolute_difference = new Float(Math.abs(difference));
      relative_difference = rate_record(difference, "baseline condition point estimate", new Float(baseline_point!));
    } else {
      relative_difference = {
        status: "uncomputable",
        denominator: {
          name: "baseline condition point estimate",
          value: baseline.point_estimate,
        },
        decision: "not_evaluated",
      };
    }

    let outcome: string;
    let decision: string;
    if (invalid_reasons.length > 0) {
      outcome = "INVALID";
      decision = "not_evaluated";
    } else if (!ci_computed || !points_computed || relative_difference.status === "uncomputable") {
      outcome = "INCONCLUSIVE";
      decision = "not_evaluated";
    } else {
      const hw1 = baseline.confidence_interval.half_width.value;
      const hw2 = candidate.confidence_interval.half_width.value;
      const max_hw = Math.max(hw1, hw2);
      uncertainty_half_width = new Float(max_hw);
      
      if (Math.abs(difference) <= max_hw) {
        outcome = "INCONCLUSIVE";
        decision = "not_evaluated";
      } else if (difference > 0) {
        outcome = "IMPROVEMENT";
        decision = "evaluated";
      } else {
        outcome = "REGRESSION";
        decision = "evaluated";
      }
    }

    results.push({
      spec_id: spec_id,
      baseline: baseline,
      candidate: candidate,
      point_estimate_difference: point_estimate_difference,
      absolute_difference: absolute_difference,
      relative_difference: relative_difference,
      uncertainty_half_width: uncertainty_half_width,
      outcome: outcome,
      decision: decision,
    });
  }

  return {
    schema_version: "tier2-comparison-result/v1",
    comparison_id: data.comparison_id,
    research_only: true,
    expected_n: expected_n,
    bootstrap: {
      resamples: resamples,
      confidence_level: new Float(confidence_level),
      seed: seed,
    },
    locked_specs: specs,
    validity: {
      status: invalid_reasons.length > 0 ? "invalid" : "valid",
      reasons: invalid_reasons,
    },
    plan: planned_comparison(specs, expected_n, policy),
    run_record: run_record,
    results: results,
  };
}

function print_comparison_summary(result: any): void {
  if (result.validity.status === "invalid") {
    for (const reason of result.validity.reasons) {
      console.log(`INVALID comparison_id=${result.comparison_id} reason=${reason}`);
    }
  }
  for (const row of result.results) {
    const diff = row.absolute_difference !== null ? row.absolute_difference.value.toString() : "uncomputable";
    const unc = row.uncertainty_half_width !== null ? row.uncertainty_half_width.value.toString() : "uncomputable";
    console.log(`RESULT spec_id=${row.spec_id} outcome=${row.outcome} absolute_difference=${diff} uncertainty_half_width=${unc}`);
  }
  if (result.run_record.budget_review) {
    console.log("BUDGET_REVIEW tier=tier2");
  }
}

function compare_command(args: any): number {
  const result = evaluate_comparison(load_json(args.input), load_budgets(args.budgets));
  write_json(result, args.output);
  if (args.output !== null) {
    print_comparison_summary(result);
  }
  return result.validity.status === "invalid" ? 1 : 0;
}

function rate_command(args: any): number {
  const data = load_json(args.input);
  if (data.schema_version !== "tier-rate-input/v1") {
    throw new InputError("unsupported rate input schema");
  }
  const denominator = data.denominator;
  if (typeof denominator !== "object" || denominator === null || typeof denominator.name !== "string") {
    throw new InputError("rate denominator must carry a name and value");
  }
  const result = {
    schema_version: "tier-rate-result/v1",
    rate_id: data.rate_id,
    rate: rate_record(
      number(data.numerator, "rate numerator"),
      denominator.name,
      new Float(number(denominator.value, "rate denominator"))
    ),
  };
  write_json(result, args.output);
  if (args.output !== null) {
    const rate = result.rate;
    console.log(`RATE rate_id=${result.rate_id} status=${rate.status} denominator=${rate.denominator.name}:${rate.denominator.value.value}`);
  }
  return 0;
}

function budget_command(args: any): number {
  const data = load_json(args.input);
  if (data.schema_version !== "tier-run-input/v1" || !Array.isArray(data.runs)) {
    throw new InputError("unsupported tier run input schema");
  }
  const policy = load_budgets(args.budgets);
  const runs = data.runs.map((run: any) => evaluate_budget(run, policy));
  const result = {
    schema_version: "tier-budget-result/v1",
    material_margin_percent: policy.material_margin_percent, // 20
    runs: runs,
  };
  write_json(result, args.output);
  if (args.output !== null) {
    for (const run of runs) {
      console.log(`BUDGET run_id=${run.run_id} breach=${run.budget_breach} review=${run.budget_review}`);
    }
  }
  return runs.every((run: any) => run.cadence_permitted) ? 0 : 1;
}

export function main() {
  const argv = process.argv.slice(2);
  let command = "";
  let input = "";
  let output: string | null = null;
  let budgets = DEFAULT_BUDGETS;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--output") {
      output = argv[++i]!;
    } else if (arg === "--budgets") {
      budgets = argv[++i]!;
    } else if (["compare", "rate", "budget"].includes(arg)) {
      command = arg;
    } else if (!arg.startsWith("--") && input === "") {
      input = arg;
    }
  }

  if (!command || !input) {
    console.error("Missing command or input");
    process.exit(2);
  }

  try {
    let code = 0;
    const args = { input, output, budgets };
    if (command === "compare") {
      code = compare_command(args);
    } else if (command === "rate") {
      code = rate_command(args);
    } else if (command === "budget") {
      code = budget_command(args);
    }
    process.exit(code);
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
