// packages/orchestration/src/tier2-shared.ts
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
var Random = class {
  mt = new Uint32Array(624);
  index = 624;
  constructor(seedString) {
    const b = Buffer.from(seedString, "utf-8");
    const hash = createHash("sha512").update(b).digest();
    const full = Buffer.concat([b, hash]);
    let n = 0n;
    for (let i = 0; i < full.length; i++) {
      n = n << 8n | BigInt(full[i]);
    }
    const words = [];
    let temp = n;
    if (temp === 0n) {
      words.push(0);
    } else {
      while (temp > 0n) {
        words.push(Number(temp & 0xffffffffn));
        temp >>= 32n;
      }
    }
    this.init_by_array(words);
  }
  init_genrand(s) {
    this.mt[0] = s >>> 0;
    for (let mti = 1; mti < 624; mti++) {
      const prev = this.mt[mti - 1];
      this.mt[mti] = Math.imul(1812433253, prev ^ prev >>> 30) + mti >>> 0;
    }
    this.index = 624;
  }
  init_by_array(init_key) {
    this.init_genrand(19650218);
    let i = 1, j = 0;
    let k = 624 > init_key.length ? 624 : init_key.length;
    for (; k > 0; k--) {
      const prev = this.mt[i - 1];
      this.mt[i] = (this.mt[i] ^ Math.imul(prev ^ prev >>> 30, 1664525)) + init_key[j] + j;
      this.mt[i] >>>= 0;
      i++;
      j++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
      if (j >= init_key.length) j = 0;
    }
    for (k = 623; k > 0; k--) {
      const prev = this.mt[i - 1];
      this.mt[i] = (this.mt[i] ^ Math.imul(prev ^ prev >>> 30, 1566083941)) - i;
      this.mt[i] >>>= 0;
      i++;
      if (i >= 624) {
        this.mt[0] = this.mt[623];
        i = 1;
      }
    }
    this.mt[0] = 2147483648;
  }
  getrandbits(k) {
    if (k <= 32) {
      return this.genrand_int32() >>> 32 - k;
    }
    let numwords = Math.floor((k - 1) / 32) + 1;
    let result = 0n;
    for (let i = 0; i < numwords; i++) {
      result |= BigInt(this.genrand_int32()) << BigInt(i * 32);
    }
    result &= (1n << BigInt(k)) - 1n;
    return Number(result);
  }
  genrand_int32() {
    const mag01 = [0, 2567483615];
    if (this.index >= 624) {
      let kk = 0;
      for (; kk < 624 - 397; kk++) {
        const y3 = this.mt[kk] & 2147483648 | this.mt[kk + 1] & 2147483647;
        this.mt[kk] = this.mt[kk + 397] ^ y3 >>> 1 ^ mag01[y3 & 1];
      }
      for (; kk < 623; kk++) {
        const y3 = this.mt[kk] & 2147483648 | this.mt[kk + 1] & 2147483647;
        this.mt[kk] = this.mt[kk + (397 - 624)] ^ y3 >>> 1 ^ mag01[y3 & 1];
      }
      const y2 = this.mt[623] & 2147483648 | this.mt[0] & 2147483647;
      this.mt[623] = this.mt[397 - 1] ^ y2 >>> 1 ^ mag01[y2 & 1];
      this.index = 0;
    }
    let y = this.mt[this.index++];
    y ^= y >>> 11;
    y ^= y << 7 & 2636928640;
    y ^= y << 15 & 4022730752;
    y ^= y >>> 18;
    return y >>> 0;
  }
  randrange(n) {
    const k = n.toString(2).length;
    while (true) {
      const r = this.getrandbits(k);
      if (r < n) return r;
    }
  }
};
function fsum(values) {
  let sum = 0;
  let c = 0;
  for (let val of values) {
    let t = sum + val;
    if (Math.abs(sum) >= Math.abs(val)) {
      c += sum - t + val;
    } else {
      c += val - t + sum;
    }
    sum = t;
  }
  return sum + c;
}

// packages/orchestration/src/tier2-compare-main.ts
function percentile(sorted_values, probability) {
  const position = (sorted_values.length - 1) * probability;
  const lower_index = Math.floor(position);
  const upper_index = Math.ceil(position);
  if (lower_index === upper_index) {
    return sorted_values[lower_index];
  }
  const fraction = position - lower_index;
  return sorted_values[lower_index] * (1 - fraction) + sorted_values[upper_index] * fraction;
}
function bootstrap_ci(values, expected_n, resamples, confidence_level, seed) {
  const denominator = { name: "observed runs", value: values.length };
  if (values.length !== expected_n) {
    return {
      status: "uncomputable",
      denominator,
      required_n: expected_n,
      resamples,
      confidence_level: new Float(confidence_level)
    };
  }
  const rng = new Random(seed);
  const means = [];
  for (let i = 0; i < resamples; i++) {
    const chosen = [];
    for (let j = 0; j < expected_n; j++) {
      chosen.push(values[rng.randrange(expected_n)]);
    }
    let sum = fsum(chosen);
    means.push(sum / expected_n);
  }
  means.sort((a, b) => a - b);
  const tail = (1 - confidence_level) / 2;
  const lower = percentile(means, tail);
  const upper = percentile(means, 1 - tail);
  const width = upper - lower;
  return {
    status: "computed",
    lower: new Float(lower),
    upper: new Float(upper),
    width: new Float(width),
    half_width: new Float(width / 2),
    denominator,
    resamples,
    confidence_level: new Float(confidence_level)
  };
}
function rate_record(numerator, denominator_name, denominator) {
  const denominator_record = { name: denominator_name, value: denominator };
  const d_val = denominator instanceof Float ? denominator.value : denominator;
  if (d_val < 0) {
    throw new InputError("rate denominator must be nonnegative");
  }
  if (d_val === 0) {
    return {
      status: "uncomputable",
      denominator: denominator_record,
      decision: "not_evaluated"
    };
  }
  const value = numerator / d_val;
  return {
    status: "computed",
    value: rounded(value),
    percent: rounded(value * 100),
    denominator: denominator_record,
    decision: "evaluated"
  };
}
function budget_field(actual, declared, field, material_margin_percent) {
  const delta = actual - declared;
  if (declared === 0) {
    const breach2 = actual > 0;
    const margin2 = rate_record(delta, `declared ${field} budget`, 0);
    return {
      actual: new Float(actual),
      declared: new Float(declared),
      delta: rounded(delta),
      budget_breach: breach2,
      budget_review: breach2,
      margin_percent: margin2
    };
  }
  const denominator = { name: `declared ${field} budget`, value: new Float(declared) };
  const margin = {
    status: "computed",
    value: rounded(delta / declared * 100),
    denominator,
    decision: "evaluated"
  };
  const breach = actual > declared;
  const review = actual > declared * (1 + material_margin_percent / 100);
  return {
    actual: new Float(actual),
    declared: new Float(declared),
    delta: rounded(delta),
    budget_breach: breach,
    budget_review: review,
    margin_percent: margin
  };
}
function evaluate_cadence(run, declared, tier) {
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
  if (!Array.isArray(allowed) || !allowed.every((item) => typeof item === "string")) {
    throw new InputError(`${tier} allowed_invocation_sources must be an array of strings`);
  }
  const record = {
    source,
    allowed_sources: allowed,
    explicit_override: override,
    declared_cadence: declared.cadence
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
    reason: "invocation source is more frequent than the declared cadence permits"
  };
}
function evaluate_budget(run, policy) {
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
    tier,
    started_at: run.started_at,
    duration_s: new Float(duration),
    cost_usd: new Float(cost),
    declared_budget: declared,
    invocation: run.invocation,
    cadence_check,
    cadence_permitted: ["permitted", "overridden"].includes(cadence_check.status),
    material_margin_percent: new Float(material_margin),
    fields: { duration_s: duration_check, cost_usd: cost_check },
    budget_breach: duration_check.budget_breach || cost_check.budget_breach,
    budget_review: duration_check.budget_review || cost_check.budget_review
  };
  return result;
}
function validate_model_pin(data) {
  const reasons = [];
  const conditions = data.conditions;
  const pins = {};
  for (const condition_name of ["baseline", "candidate"]) {
    const condition = conditions[condition_name];
    const pin = condition.pinned_model;
    if (typeof pin !== "object" || pin === null) {
      reasons.push(`${condition_name} pinned model is missing`);
      continue;
    }
    const identity = [pin.vendor, pin.identifier, pin.version];
    pins[condition_name] = identity;
    if (pin.pinned !== true || !identity.every((value) => typeof value === "string" && value)) {
      reasons.push(`${condition_name} model is not pinned to vendor/identifier/version`);
    }
    const runs = Array.isArray(condition.runs) ? condition.runs : [];
    for (let index = 1; index <= runs.length; index++) {
      const run = runs[index - 1];
      const observed = typeof run === "object" && run !== null ? run.observed_model : null;
      const observed_identity = typeof observed === "object" && observed !== null ? [observed.vendor, observed.identifier, observed.version] : [void 0, void 0, void 0];
      const identityMatches = observed_identity[0] === identity[0] && observed_identity[1] === identity[1] && observed_identity[2] === identity[2];
      if (!identityMatches) {
        const run_id = typeof run === "object" && run !== null && run.run_id !== void 0 ? run.run_id : index;
        const obs_repr = `(${JSON.stringify(observed_identity[0])}, ${JSON.stringify(observed_identity[1])}, ${JSON.stringify(observed_identity[2])})`.replace(/"/g, "'");
        const id_repr = `(${JSON.stringify(identity[0])}, ${JSON.stringify(identity[1])}, ${JSON.stringify(identity[2])})`.replace(/"/g, "'");
        reasons.push(`${condition_name} run ${run_id} observed model ${obs_repr}, expected pinned model ${id_repr}`);
      }
    }
  }
  if (Object.keys(pins).length === 2) {
    const b = pins.baseline;
    const c = pins.candidate;
    if (b[0] !== c[0] || b[1] !== c[1] || b[2] !== c[2]) {
      const brepr = `(${JSON.stringify(b[0])}, ${JSON.stringify(b[1])}, ${JSON.stringify(b[2])})`.replace(/"/g, "'");
      const crepr = `(${JSON.stringify(c[0])}, ${JSON.stringify(c[1])}, ${JSON.stringify(c[2])})`.replace(/"/g, "'");
      reasons.push(`comparison conditions use different pinned models: baseline=${brepr} candidate=${crepr}`);
    }
  }
  return reasons;
}
function condition_samples(condition, spec_id) {
  const runs = condition.runs;
  if (!Array.isArray(runs)) {
    throw new InputError("condition runs must be an array");
  }
  const samples = [];
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
function validate_run_structure(conditions, specs, expected_n) {
  const spec_set = new Set(specs);
  for (const condition_name of ["baseline", "candidate"]) {
    const runs = conditions[condition_name].runs;
    if (!Array.isArray(runs) || runs.length !== expected_n) {
      throw new InputError(`${condition_name} condition must contain exactly ${expected_n} run records`);
    }
    const run_ids = [];
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
      const extra_specs = Object.keys(scores).filter((k) => !spec_set.has(k)).sort();
      if (extra_specs.length > 0) {
        throw new InputError(`${condition_name} run ${run_id} has unlocked score keys: ` + extra_specs.join(", "));
      }
    }
    if (new Set(run_ids).size !== run_ids.length) {
      throw new InputError(`${condition_name} run_id values must be unique`);
    }
  }
}
function condition_result(condition_name, condition, spec_id, expected_n, resamples, confidence_level, seed) {
  const samples = condition_samples(condition, spec_id);
  let point_estimate;
  if (samples.length > 0) {
    point_estimate = new Float(fsum(samples) / samples.length);
  } else {
    point_estimate = {
      status: "uncomputable",
      denominator: { name: "observed runs", value: 0 }
    };
  }
  return {
    model: condition.pinned_model,
    n: samples.length,
    point_estimate,
    confidence_interval: bootstrap_ci(
      samples,
      expected_n,
      resamples,
      confidence_level,
      `${seed}:${condition_name}:${spec_id}`
    )
  };
}
function evaluate_comparison(data, policy) {
  if (data.schema_version !== "tier2-comparison-input/v1") {
    throw new InputError("unsupported Tier 2 comparison input schema");
  }
  const specs = locked_specs(data);
  const [expected_n, resamples, confidence_level, seed] = comparison_configuration(data);
  const conditions = data.conditions;
  if (typeof conditions !== "object" || conditions === null || !["baseline", "candidate"].every((name) => typeof conditions[name] === "object" && conditions[name] !== null)) {
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
    const ci_computed = baseline.confidence_interval.status === "computed" && candidate.confidence_interval.status === "computed";
    const points_computed = baseline_point !== null && candidate_point !== null;
    let absolute_difference = null;
    let point_estimate_difference = null;
    let relative_difference;
    let uncertainty_half_width = null;
    let difference = 0;
    if (points_computed) {
      difference = candidate_point - baseline_point;
      point_estimate_difference = new Float(difference);
      absolute_difference = new Float(Math.abs(difference));
      relative_difference = rate_record(difference, "baseline condition point estimate", new Float(baseline_point));
    } else {
      relative_difference = {
        status: "uncomputable",
        denominator: {
          name: "baseline condition point estimate",
          value: baseline.point_estimate
        },
        decision: "not_evaluated"
      };
    }
    let outcome;
    let decision;
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
      spec_id,
      baseline,
      candidate,
      point_estimate_difference,
      absolute_difference,
      relative_difference,
      uncertainty_half_width,
      outcome,
      decision
    });
  }
  return {
    schema_version: "tier2-comparison-result/v1",
    comparison_id: data.comparison_id,
    research_only: true,
    expected_n,
    bootstrap: {
      resamples,
      confidence_level: new Float(confidence_level),
      seed
    },
    locked_specs: specs,
    validity: {
      status: invalid_reasons.length > 0 ? "invalid" : "valid",
      reasons: invalid_reasons
    },
    plan: planned_comparison(specs, expected_n, policy),
    run_record,
    results
  };
}
function print_comparison_summary(result) {
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
function compare_command(args) {
  const result = evaluate_comparison(load_json(args.input), load_budgets(args.budgets));
  write_json(result, args.output);
  if (args.output !== null) {
    print_comparison_summary(result);
  }
  return result.validity.status === "invalid" ? 1 : 0;
}
function rate_command(args) {
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
    )
  };
  write_json(result, args.output);
  if (args.output !== null) {
    const rate = result.rate;
    console.log(`RATE rate_id=${result.rate_id} status=${rate.status} denominator=${rate.denominator.name}:${rate.denominator.value.value}`);
  }
  return 0;
}
function budget_command(args) {
  const data = load_json(args.input);
  if (data.schema_version !== "tier-run-input/v1" || !Array.isArray(data.runs)) {
    throw new InputError("unsupported tier run input schema");
  }
  const policy = load_budgets(args.budgets);
  const runs = data.runs.map((run) => evaluate_budget(run, policy));
  const result = {
    schema_version: "tier-budget-result/v1",
    material_margin_percent: policy.material_margin_percent,
    // 20
    runs
  };
  write_json(result, args.output);
  if (args.output !== null) {
    for (const run of runs) {
      console.log(`BUDGET run_id=${run.run_id} breach=${run.budget_breach} review=${run.budget_review}`);
    }
  }
  return runs.every((run) => run.cadence_permitted) ? 0 : 1;
}
function main() {
  const argv = process.argv.slice(2);
  let command = "";
  let input = "";
  let output = null;
  let budgets = DEFAULT_BUDGETS;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output") {
      output = argv[++i];
    } else if (arg === "--budgets") {
      budgets = argv[++i];
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
