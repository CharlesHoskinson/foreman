"""Evaluate recorded Tier 2 comparisons and tier budget/rate fixtures.

This module deliberately has no vendor execution interface. Paid result
collection is a separate, explicitly authorized human action; this evaluator
only turns recorded JSON into an honest machine-readable research result.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUDGETS = (
    REPO_ROOT / "skills" / "foreman" / "references" / "regression-tier-budgets.json"
)


class InputError(ValueError):
    """The recorded input does not satisfy the harness contract."""


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise InputError(f"cannot read JSON input {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise InputError(f"JSON input {path} must be an object")
    return value


def write_json(value: dict[str, Any], output: Path | None) -> None:
    rendered = json.dumps(value, indent=2, sort_keys=True) + "\n"
    if output is None:
        sys.stdout.write(rendered)
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{os.getpid()}.tmp")
    temporary.write_text(rendered, encoding="utf-8", newline="\n")
    os.replace(temporary, output)


def number(value: Any, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise InputError(f"{field} must be numeric")
    result = float(value)
    if not math.isfinite(result):
        raise InputError(f"{field} must be finite")
    return result


def rounded(value: float) -> float:
    return round(value, 8)


def percentile(sorted_values: list[float], probability: float) -> float:
    position = (len(sorted_values) - 1) * probability
    lower_index = math.floor(position)
    upper_index = math.ceil(position)
    if lower_index == upper_index:
        return sorted_values[lower_index]
    fraction = position - lower_index
    return (
        sorted_values[lower_index] * (1.0 - fraction)
        + sorted_values[upper_index] * fraction
    )


def bootstrap_ci(
    values: list[float],
    *,
    expected_n: int,
    resamples: int,
    confidence_level: float,
    seed: str,
) -> dict[str, Any]:
    denominator = {"name": "observed runs", "value": len(values)}
    if len(values) != expected_n:
        return {
            "status": "uncomputable",
            "denominator": denominator,
            "required_n": expected_n,
            "resamples": resamples,
            "confidence_level": confidence_level,
        }

    rng = random.Random(seed)
    means = []
    for _ in range(resamples):
        sample = [values[rng.randrange(expected_n)] for _ in range(expected_n)]
        means.append(sum(sample) / expected_n)
    means.sort()
    tail = (1.0 - confidence_level) / 2.0
    lower = percentile(means, tail)
    upper = percentile(means, 1.0 - tail)
    width = upper - lower
    return {
        "status": "computed",
        "lower": lower,
        "upper": upper,
        "width": width,
        "half_width": width / 2.0,
        "denominator": denominator,
        "resamples": resamples,
        "confidence_level": confidence_level,
    }


def rate_record(numerator: float, denominator_name: str, denominator: float) -> dict[str, Any]:
    denominator_record = {"name": denominator_name, "value": denominator}
    if denominator < 0:
        raise InputError("rate denominator must be nonnegative")
    if denominator == 0:
        return {
            "status": "uncomputable",
            "denominator": denominator_record,
            "decision": "not_evaluated",
        }
    value = numerator / denominator
    return {
        "status": "computed",
        "value": rounded(value),
        "percent": rounded(value * 100.0),
        "denominator": denominator_record,
        "decision": "evaluated",
    }


def load_budgets(path: Path = DEFAULT_BUDGETS) -> dict[str, Any]:
    policy = load_json(path)
    if policy.get("material_margin_percent") != 20:
        raise InputError("material_margin_percent must be the fixed value 20")
    tiers = policy.get("tiers")
    if not isinstance(tiers, dict):
        raise InputError("budget policy tiers must be an object")
    return policy


def budget_field(
    actual: float,
    declared: float,
    field: str,
    material_margin_percent: float,
) -> dict[str, Any]:
    delta = actual - declared
    if declared == 0:
        breach = actual > 0
        margin = rate_record(delta, f"declared {field} budget", 0)
        return {
            "actual": actual,
            "declared": declared,
            "delta": rounded(delta),
            "budget_breach": breach,
            "budget_review": breach,
            "margin_percent": margin,
        }

    denominator = {"name": f"declared {field} budget", "value": declared}
    margin = {
        "status": "computed",
        "value": rounded(delta / declared * 100.0),
        "denominator": denominator,
        "decision": "evaluated",
    }
    breach = actual > declared
    review = actual > declared * (1.0 + material_margin_percent / 100.0)
    return {
        "actual": actual,
        "declared": declared,
        "delta": rounded(delta),
        "budget_breach": breach,
        "budget_review": review,
        "margin_percent": margin,
    }


def evaluate_budget(run: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    tier = run.get("tier")
    tiers = policy["tiers"]
    if tier not in tiers:
        raise InputError(f"unknown tier in run record: {tier!r}")
    declared = tiers[tier]
    duration = number(run.get("duration_s"), "duration_s")
    cost = number(run.get("cost_usd"), "cost_usd")
    if duration < 0 or cost < 0:
        raise InputError("duration_s and cost_usd must be nonnegative")
    material_margin = number(policy["material_margin_percent"], "material margin")
    duration_check = budget_field(
        duration,
        number(declared["max_duration_s"], f"{tier}.max_duration_s"),
        "duration_s",
        material_margin,
    )
    cost_check = budget_field(
        cost,
        number(declared["max_cost_usd"], f"{tier}.max_cost_usd"),
        "cost_usd",
        material_margin,
    )
    cadence_check = evaluate_cadence(run, declared, tier)
    result = {
        "run_id": run.get("run_id"),
        "tier": tier,
        "started_at": run.get("started_at"),
        "duration_s": duration,
        "cost_usd": cost,
        "declared_budget": declared,
        "invocation": run.get("invocation"),
        "cadence_check": cadence_check,
        "cadence_permitted": cadence_check["status"] in ("permitted", "overridden"),
        "material_margin_percent": material_margin,
        "fields": {"duration_s": duration_check, "cost_usd": cost_check},
        "budget_breach": duration_check["budget_breach"] or cost_check["budget_breach"],
        "budget_review": duration_check["budget_review"] or cost_check["budget_review"],
    }
    return result


def evaluate_cadence(
    run: dict[str, Any], declared: dict[str, Any], tier: str
) -> dict[str, Any]:
    invocation = run.get("invocation")
    if not isinstance(invocation, dict):
        raise InputError(f"{tier} run record must name its invocation source")
    source = invocation.get("source")
    override = invocation.get("explicit_override")
    if not isinstance(source, str) or not source:
        raise InputError(f"{tier} invocation source must be a nonempty string")
    if not isinstance(override, bool):
        raise InputError(f"{tier} invocation explicit_override must be boolean")
    allowed = declared.get("allowed_invocation_sources")
    if not isinstance(allowed, list) or not all(isinstance(item, str) for item in allowed):
        raise InputError(f"{tier} allowed_invocation_sources must be an array of strings")
    record = {
        "source": source,
        "allowed_sources": allowed,
        "explicit_override": override,
        "declared_cadence": declared.get("cadence"),
    }
    if source in allowed:
        return {**record, "status": "permitted", "decision": "evaluated"}
    if tier != "tier2" and override:
        return {**record, "status": "overridden", "decision": "evaluated"}
    return {
        **record,
        "status": "refused",
        "decision": "not_evaluated",
        "reason": "invocation source is more frequent than the declared cadence permits",
    }


def validate_model_pin(data: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    conditions = data["conditions"]
    pins: dict[str, tuple[Any, Any, Any]] = {}
    for condition_name in ("baseline", "candidate"):
        condition = conditions[condition_name]
        pin = condition.get("pinned_model")
        if not isinstance(pin, dict):
            reasons.append(f"{condition_name} pinned model is missing")
            continue
        identity = (pin.get("vendor"), pin.get("identifier"), pin.get("version"))
        pins[condition_name] = identity
        if pin.get("pinned") is not True or not all(
            isinstance(value, str) and value for value in identity
        ):
            reasons.append(f"{condition_name} model is not pinned to vendor/identifier/version")
        for index, run in enumerate(condition.get("runs", []), start=1):
            observed = run.get("observed_model") if isinstance(run, dict) else None
            observed_identity = (
                observed.get("vendor"),
                observed.get("identifier"),
                observed.get("version"),
            ) if isinstance(observed, dict) else (None, None, None)
            if observed_identity != identity:
                run_id = run.get("run_id", index) if isinstance(run, dict) else index
                reasons.append(
                    f"{condition_name} run {run_id} observed model "
                    f"{observed_identity!r}, expected pinned model {identity!r}"
                )
    if len(pins) == 2 and pins["baseline"] != pins["candidate"]:
        reasons.append(
            "comparison conditions use different pinned models: "
            f"baseline={pins['baseline']!r} candidate={pins['candidate']!r}"
        )
    return reasons


def comparison_configuration(data: dict[str, Any]) -> tuple[int, int, float, int]:
    expected_n = data.get("expected_n")
    if expected_n != 3:
        raise InputError("expected_n must be exactly 3")
    bootstrap = data.get("bootstrap")
    if not isinstance(bootstrap, dict):
        raise InputError("bootstrap configuration is required")
    resamples = bootstrap.get("resamples")
    confidence_level = bootstrap.get("confidence_level")
    seed = bootstrap.get("seed")
    if isinstance(resamples, bool) or not isinstance(resamples, int) or resamples < 1:
        raise InputError("bootstrap.resamples must be a positive integer")
    confidence = number(confidence_level, "bootstrap.confidence_level")
    if not 0 < confidence < 1:
        raise InputError("bootstrap.confidence_level must be between zero and one")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise InputError("bootstrap.seed must be an integer")
    return expected_n, resamples, confidence, seed


def locked_specs(data: dict[str, Any]) -> list[str]:
    specs = data.get("locked_specs")
    if (
        not isinstance(specs, list)
        or not 8 <= len(specs) <= 12
        or len(set(specs)) != len(specs)
        or not all(isinstance(spec, str) and spec for spec in specs)
    ):
        raise InputError("locked_specs must contain 8 to 12 unique spec identifiers")
    return specs


def condition_samples(condition: dict[str, Any], spec_id: str) -> list[float]:
    runs = condition.get("runs")
    if not isinstance(runs, list):
        raise InputError("condition runs must be an array")
    samples: list[float] = []
    for run in runs:
        if not isinstance(run, dict):
            raise InputError("each condition run must be an object")
        scores = run.get("scores")
        if not isinstance(scores, dict):
            raise InputError("each condition run must carry a scores object")
        if spec_id not in scores:
            continue
        score = number(scores[spec_id], f"score for {spec_id}")
        if not 0 <= score <= 1:
            raise InputError(f"score for {spec_id} must be between zero and one")
        samples.append(score)
    return samples


def validate_run_structure(
    conditions: dict[str, Any], specs: list[str], expected_n: int
) -> None:
    spec_set = set(specs)
    for condition_name in ("baseline", "candidate"):
        runs = conditions[condition_name].get("runs")
        if not isinstance(runs, list) or len(runs) != expected_n:
            raise InputError(
                f"{condition_name} condition must contain exactly {expected_n} run records"
            )
        run_ids = []
        for run in runs:
            if not isinstance(run, dict):
                raise InputError(f"{condition_name} run records must be objects")
            run_id = run.get("run_id")
            if not isinstance(run_id, str) or not run_id:
                raise InputError(f"{condition_name} run_id values must be nonempty strings")
            run_ids.append(run_id)
            scores = run.get("scores")
            if not isinstance(scores, dict):
                raise InputError(f"{condition_name} run {run_id} must carry a scores object")
            extra_specs = sorted(set(scores) - spec_set)
            if extra_specs:
                raise InputError(
                    f"{condition_name} run {run_id} has unlocked score keys: "
                    + ", ".join(extra_specs)
                )
        if len(set(run_ids)) != len(run_ids):
            raise InputError(f"{condition_name} run_id values must be unique")


def planned_comparison(
    specs: list[str], expected_n: int, policy: dict[str, Any]
) -> dict[str, Any]:
    declared = policy["tiers"]["tier2"]
    condition_count = number(
        declared.get("comparison_conditions"), "tier2.comparison_conditions"
    )
    per_call_cost = number(
        declared.get("max_cost_per_vendor_call_usd"),
        "tier2.max_cost_per_vendor_call_usd",
    )
    calls = int(condition_count * len(specs) * expected_n)
    expected_cost = rounded(calls * per_call_cost)
    if calls > declared["max_vendor_calls"] or expected_cost > declared["max_cost_usd"]:
        raise InputError("comparison plan exceeds the declared Tier 2 call or cost budget")
    return {
        "comparison_conditions": int(condition_count),
        "locked_spec_count": len(specs),
        "expected_n": expected_n,
        "planned_vendor_calls": calls,
        "max_cost_per_vendor_call_usd": per_call_cost,
        "declared_expected_cost_usd": expected_cost,
        "declared_max_cost_usd": declared["max_cost_usd"],
    }


def condition_result(
    condition_name: str,
    condition: dict[str, Any],
    spec_id: str,
    expected_n: int,
    resamples: int,
    confidence_level: float,
    seed: int,
) -> dict[str, Any]:
    samples = condition_samples(condition, spec_id)
    point_estimate: Any
    if samples:
        point_estimate = sum(samples) / len(samples)
    else:
        point_estimate = {
            "status": "uncomputable",
            "denominator": {"name": "observed runs", "value": 0},
        }
    return {
        "model": condition.get("pinned_model"),
        "n": len(samples),
        "point_estimate": point_estimate,
        "confidence_interval": bootstrap_ci(
            samples,
            expected_n=expected_n,
            resamples=resamples,
            confidence_level=confidence_level,
            seed=f"{seed}:{condition_name}:{spec_id}",
        ),
    }


def evaluate_comparison(data: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    if data.get("schema_version") != "tier2-comparison-input/v1":
        raise InputError("unsupported Tier 2 comparison input schema")
    specs = locked_specs(data)
    expected_n, resamples, confidence_level, seed = comparison_configuration(data)
    conditions = data.get("conditions")
    if not isinstance(conditions, dict) or not all(
        isinstance(conditions.get(name), dict) for name in ("baseline", "candidate")
    ):
        raise InputError("baseline and candidate conditions are required")
    validate_run_structure(conditions, specs, expected_n)

    measurement = data.get("measurement")
    if not isinstance(measurement, dict) or measurement.get("tier") != "tier2":
        raise InputError("a Tier 2 measurement run record is required")
    run_record = evaluate_budget(measurement, policy)

    invalid_reasons = validate_model_pin(data)
    if not run_record["cadence_permitted"]:
        invalid_reasons.append(
            "Tier 2 comparison invocation refused by cadence policy: "
            f"source={run_record['cadence_check']['source']}"
        )
    results = []
    for spec_id in specs:
        baseline = condition_result(
            "baseline", conditions["baseline"], spec_id,
            expected_n, resamples, confidence_level, seed,
        )
        candidate = condition_result(
            "candidate", conditions["candidate"], spec_id,
            expected_n, resamples, confidence_level, seed,
        )
        baseline_point = baseline["point_estimate"]
        candidate_point = candidate["point_estimate"]
        ci_computed = (
            baseline["confidence_interval"]["status"] == "computed"
            and candidate["confidence_interval"]["status"] == "computed"
        )
        points_computed = isinstance(baseline_point, float) and isinstance(candidate_point, float)
        absolute_difference: Any = None
        point_estimate_difference: Any = None
        relative_difference: dict[str, Any]
        uncertainty_half_width: Any = None
        if points_computed:
            difference = candidate_point - baseline_point
            point_estimate_difference = difference
            absolute_difference = abs(difference)
            relative_difference = rate_record(
                difference,
                "baseline condition point estimate",
                baseline_point,
            )
        else:
            difference = 0.0
            relative_difference = {
                "status": "uncomputable",
                "denominator": {
                    "name": "baseline condition point estimate",
                    "value": baseline_point,
                },
                "decision": "not_evaluated",
            }

        if invalid_reasons:
            outcome = "INVALID"
            decision = "not_evaluated"
        elif (
            not ci_computed
            or not points_computed
            or relative_difference["status"] == "uncomputable"
        ):
            outcome = "INCONCLUSIVE"
            decision = "not_evaluated"
        else:
            uncertainty_half_width = max(
                baseline["confidence_interval"]["half_width"],
                candidate["confidence_interval"]["half_width"],
            )
            if abs(difference) <= uncertainty_half_width:
                outcome = "INCONCLUSIVE"
                decision = "not_evaluated"
            elif difference > 0:
                outcome = "IMPROVEMENT"
                decision = "evaluated"
            else:
                outcome = "REGRESSION"
                decision = "evaluated"

        results.append({
            "spec_id": spec_id,
            "baseline": baseline,
            "candidate": candidate,
            "point_estimate_difference": point_estimate_difference,
            "absolute_difference": absolute_difference,
            "relative_difference": relative_difference,
            "uncertainty_half_width": uncertainty_half_width,
            "outcome": outcome,
            "decision": decision,
        })

    return {
        "schema_version": "tier2-comparison-result/v1",
        "comparison_id": data.get("comparison_id"),
        "research_only": True,
        "expected_n": expected_n,
        "bootstrap": {
            "resamples": resamples,
            "confidence_level": confidence_level,
            "seed": seed,
        },
        "locked_specs": specs,
        "validity": {
            "status": "invalid" if invalid_reasons else "valid",
            "reasons": invalid_reasons,
        },
        "plan": planned_comparison(specs, expected_n, policy),
        "run_record": run_record,
        "results": results,
    }


def print_comparison_summary(result: dict[str, Any]) -> None:
    if result["validity"]["status"] == "invalid":
        for reason in result["validity"]["reasons"]:
            print(f"INVALID comparison_id={result['comparison_id']} reason={reason}")
    for row in result["results"]:
        difference = row["absolute_difference"]
        uncertainty = row["uncertainty_half_width"]
        print(
            f"RESULT spec_id={row['spec_id']} outcome={row['outcome']} "
            f"absolute_difference={difference if difference is not None else 'uncomputable'} "
            f"uncertainty_half_width={uncertainty if uncertainty is not None else 'uncomputable'}"
        )
    if result["run_record"]["budget_review"]:
        print("BUDGET_REVIEW tier=tier2")


def compare_command(args: argparse.Namespace) -> int:
    result = evaluate_comparison(load_json(args.input), load_budgets(args.budgets))
    write_json(result, args.output)
    if args.output is not None:
        print_comparison_summary(result)
    return 1 if result["validity"]["status"] == "invalid" else 0


def rate_command(args: argparse.Namespace) -> int:
    data = load_json(args.input)
    if data.get("schema_version") != "tier-rate-input/v1":
        raise InputError("unsupported rate input schema")
    denominator = data.get("denominator")
    if not isinstance(denominator, dict) or not isinstance(denominator.get("name"), str):
        raise InputError("rate denominator must carry a name and value")
    result = {
        "schema_version": "tier-rate-result/v1",
        "rate_id": data.get("rate_id"),
        "rate": rate_record(
            number(data.get("numerator"), "rate numerator"),
            denominator["name"],
            number(denominator.get("value"), "rate denominator"),
        ),
    }
    write_json(result, args.output)
    if args.output is not None:
        rate = result["rate"]
        print(
            f"RATE rate_id={result['rate_id']} status={rate['status']} "
            f"denominator={rate['denominator']['name']}:{rate['denominator']['value']:g}"
        )
    return 0


def budget_command(args: argparse.Namespace) -> int:
    data = load_json(args.input)
    if data.get("schema_version") != "tier-run-input/v1" or not isinstance(data.get("runs"), list):
        raise InputError("unsupported tier run input schema")
    policy = load_budgets(args.budgets)
    runs = [evaluate_budget(run, policy) for run in data["runs"]]
    result = {
        "schema_version": "tier-budget-result/v1",
        "material_margin_percent": policy["material_margin_percent"],
        "runs": runs,
    }
    write_json(result, args.output)
    if args.output is not None:
        for run in runs:
            print(
                f"BUDGET run_id={run['run_id']} breach={str(run['budget_breach']).lower()} "
                f"review={str(run['budget_review']).lower()}"
            )
    return 0 if all(run["cadence_permitted"] for run in runs) else 1


def output_path(value: str) -> Path:
    return Path(value)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Evaluate recorded Tier 2 research; never invokes a vendor.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name, function in (
        ("compare", compare_command),
        ("rate", rate_command),
        ("budget", budget_command),
    ):
        subparser = subparsers.add_parser(name)
        subparser.add_argument("input", type=Path)
        subparser.add_argument("--output", type=output_path)
        subparser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGETS)
        subparser.set_defaults(function=function)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.function(args)
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
