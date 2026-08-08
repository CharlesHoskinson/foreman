import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import * as os from "node:os";

const _dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(_dirname, "../../../..");
export const DEFAULT_BUDGETS = join(
  REPO_ROOT,
  "skills/foreman/references/regression-tier-budgets.json"
);

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export class Float {
  constructor(public value: number) {}
}

export function load_json(path: string): any {
  try {
    const text = readFileSync(path, "utf-8");
    const value = JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new InputError(`JSON input ${path} must be an object`);
    }
    return value;
  } catch (exc: any) {
    if (exc instanceof InputError) throw exc;
    throw new InputError(`cannot read JSON input ${path}: ${exc.message}`);
  }
}

export function stringify(value: any, indentLevel: number = 0): string {
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
      const k = keys[i] as string;
      out += nextIndentStr + JSON.stringify(k) + ": " + stringify(value[k], indentLevel + 1);
      if (i < keys.length - 1) out += ",";
      out += "\n";
    }
    out += indentStr + "}";
    return out;
  }
  throw new Error("unsupported type");
}

export function write_json(value: any, output: string | null): void {
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

export function number(value: any, field: string): number {
  if (typeof value !== "number" || typeof value === "boolean") {
    throw new InputError(`${field} must be numeric`);
  }
  if (!Number.isFinite(value)) {
    throw new InputError(`${field} must be finite`);
  }
  return value;
}

export function rounded(value: number): Float {
  return new Float(Number(value.toFixed(8)));
}

export function load_budgets(path: string = DEFAULT_BUDGETS): any {
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

export function comparison_configuration(data: any): [number, number, number, number] {
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

export function locked_specs(data: any): string[] {
  const specs = data.locked_specs;
  if (
    !Array.isArray(specs) ||
    specs.length < 8 ||
    specs.length > 12 ||
    new Set(specs).size !== specs.length ||
    !specs.every(s => typeof s === "string" && s.length > 0)
  ) {
    throw new InputError("locked_specs must contain 8 to 12 unique spec identifiers");
  }
  return specs;
}

export function planned_comparison(specs: string[], expected_n: number, policy: any): any {
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
    expected_n: expected_n,
    planned_vendor_calls: calls,
    max_cost_per_vendor_call_usd: new Float(per_call_cost),
    declared_expected_cost_usd: new Float(expected_cost),
    declared_max_cost_usd: declared.max_cost_usd, // keep it as is, usually int
  };
}

export class Random {
    private mt = new Uint32Array(624);
    private index = 624;

    constructor(seedString: string) {
        const b = Buffer.from(seedString, 'utf-8');
        const hash = createHash('sha512').update(b).digest();
        const full = Buffer.concat([b, hash]);
        
        let n = 0n;
        for (let i = 0; i < full.length; i++) {
            n = (n << 8n) | BigInt(full[i]!);
        }
        
        const words: number[] = [];
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

    private init_genrand(s: number) {
        this.mt[0]! = s >>> 0;
        for (let mti = 1; mti < 624; mti++) {
            const prev = this.mt[mti - 1]!;
            this.mt[mti] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + mti) >>> 0;
        }
        this.index = 624;
    }

    private init_by_array(init_key: number[]) {
        this.init_genrand(19650218);
        let i = 1, j = 0;
        let k = 624 > init_key.length ? 624 : init_key.length;
        for (; k > 0; k--) {
            const prev = this.mt[i - 1]!;
            this.mt[i]! = (this.mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + init_key[j]! + j;
            this.mt[i]! >>>= 0;
            i++; j++;
            if (i >= 624) { this.mt[0]! = this.mt[623]!; i = 1; }
            if (j >= init_key.length) j = 0;
        }
        for (k = 623; k > 0; k--) {
            const prev = this.mt[i - 1]!;
            this.mt[i]! = (this.mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i;
            this.mt[i]! >>>= 0;
            i++;
            if (i >= 624) { this.mt[0]! = this.mt[623]!; i = 1; }
        }
        this.mt[0]! = 0x80000000;
    }

    public getrandbits(k: number): number {
        if (k <= 32) {
            return this.genrand_int32() >>> (32 - k);
        }
        let numwords = Math.floor((k - 1) / 32) + 1;
        let result = 0n;
        for (let i = 0; i < numwords; i++) {
            result |= (BigInt(this.genrand_int32()) << BigInt(i * 32));
        }
        result &= (1n << BigInt(k)) - 1n;
        return Number(result); 
    }

    private genrand_int32(): number {
        const mag01 = [0, 0x9908b0df];
        if (this.index >= 624) {
            let kk = 0;
            for (; kk < 624 - 397; kk++) {
                const y = (this.mt[kk]! & 0x80000000) | (this.mt[kk + 1]! & 0x7fffffff);
                this.mt[kk]! = this.mt[kk + 397]! ^ (y >>> 1) ^ mag01[y & 1]!;
            }
            for (; kk < 623; kk++) {
                const y = (this.mt[kk]! & 0x80000000) | (this.mt[kk + 1]! & 0x7fffffff);
                this.mt[kk]! = this.mt[kk + (397 - 624)]! ^ (y >>> 1) ^ mag01[y & 1]!;
            }
            const y = (this.mt[623]! & 0x80000000) | (this.mt[0]! & 0x7fffffff);
            this.mt[623]! = this.mt[397 - 1]! ^ (y >>> 1) ^ mag01[y & 1]!;
            this.index = 0;
        }
        let y = this.mt[this.index++]!;
        y ^= (y >>> 11);
        y ^= (y << 7) & 0x9d2c5680;
        y ^= (y << 15) & 0xefc60000;
        y ^= (y >>> 18);
        return y >>> 0;
    }

    public randrange(n: number): number {
        const k = n.toString(2).length;
        while (true) {
            const r = this.getrandbits(k);
            if (r < n) return r;
        }
    }
}

export function fsum(values: number[]): number {
  let sum = 0.0;
  let c = 0.0;
  for (let val of values) {
    let t = sum + val;
    if (Math.abs(sum) >= Math.abs(val)) {
      c += (sum - t) + val;
    } else {
      c += (val - t) + sum;
    }
    sum = t;
  }
  return sum + c;
}
