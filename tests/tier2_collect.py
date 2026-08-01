"""Manual-only Tier 2 result collector with an explicit adapter boundary."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tier2_compare import (
    DEFAULT_BUDGETS,
    InputError,
    comparison_configuration,
    load_budgets,
    load_json,
    locked_specs,
    number,
    planned_comparison,
    write_json,
)


def invoke_adapter(
    adapter: Path,
    condition: str,
    spec_id: str,
    run_number: int,
    pinned_model: dict[str, Any],
) -> dict[str, Any]:
    command = [
        str(adapter),
        "--condition", condition,
        "--spec-id", spec_id,
        "--run-number", str(run_number),
        "--pinned-model-json", json.dumps(pinned_model, separators=(",", ":")),
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise InputError(f"adapter failed to execute: {exc}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip() or "no diagnostic"
        raise InputError(
            f"adapter failed condition={condition} spec_id={spec_id} "
            f"run_number={run_number}: {detail}"
        )
    try:
        response = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise InputError(
            f"adapter returned invalid JSON condition={condition} "
            f"spec_id={spec_id} run_number={run_number}"
        ) from exc
    if not isinstance(response, dict):
        raise InputError("adapter response must be a JSON object")
    score = number(response.get("score"), "adapter score")
    if not 0 <= score <= 1:
        raise InputError("adapter score must be between zero and one")
    observed_model = response.get("observed_model")
    if not isinstance(observed_model, dict):
        raise InputError("adapter response must carry observed_model")
    cost = number(response.get("cost_usd"), "adapter cost_usd")
    if cost < 0:
        raise InputError("adapter cost_usd must be nonnegative")
    return {"score": score, "observed_model": observed_model, "cost_usd": cost}


def pinned_identity(condition_name: str, condition: dict[str, Any]) -> tuple[str, str, str]:
    pinned_model = condition.get("pinned_model")
    if not isinstance(pinned_model, dict):
        raise InputError(f"{condition_name} pinned_model is required")
    identity = (
        pinned_model.get("vendor"),
        pinned_model.get("identifier"),
        pinned_model.get("version"),
    )
    if pinned_model.get("pinned") is not True or not all(
        isinstance(value, str) and value for value in identity
    ):
        raise InputError(
            f"{condition_name} model is not pinned to vendor/identifier/version"
        )
    return identity


def collect(args: argparse.Namespace) -> dict[str, Any]:
    if not args.acknowledge_paid_vendor_calls:
        raise InputError("--acknowledge-paid-vendor-calls is required for manual collection")
    if not args.adapter.is_file():
        raise InputError(f"adapter is not a file: {args.adapter}")
    plan_input = load_json(args.plan)
    if plan_input.get("schema_version") != "tier2-collection-plan/v1":
        raise InputError("unsupported Tier 2 collection plan schema")
    specs = locked_specs(plan_input)
    expected_n, _, _, _ = comparison_configuration(plan_input)
    conditions = plan_input.get("conditions")
    if not isinstance(conditions, dict) or not all(
        isinstance(conditions.get(name), dict) for name in ("baseline", "candidate")
    ):
        raise InputError("collection plan requires baseline and candidate conditions")
    pin_identities = {
        name: pinned_identity(name, conditions[name])
        for name in ("baseline", "candidate")
    }
    if pin_identities["baseline"] != pin_identities["candidate"]:
        raise InputError("collection conditions must use the same pinned model")
    policy = load_budgets(args.budgets)
    cost_plan = planned_comparison(specs, expected_n, policy)
    print(
        "MANUAL TIER2 PLAN "
        f"calls={cost_plan['planned_vendor_calls']} "
        f"declared_expected_cost_usd={cost_plan['declared_expected_cost_usd']:g}"
    )

    started = time.monotonic()
    started_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    total_cost = 0.0
    adapter_invocations = 0
    collected_conditions: dict[str, Any] = {}
    for condition_name in ("baseline", "candidate"):
        source_condition = conditions[condition_name]
        pinned_model = source_condition.get("pinned_model")
        collected_runs = []
        for run_number in range(1, expected_n + 1):
            scores: dict[str, float] = {}
            run_model: dict[str, Any] | None = None
            for spec_id in specs:
                response = invoke_adapter(
                    args.adapter, condition_name, spec_id, run_number, pinned_model
                )
                adapter_invocations += 1
                total_cost += response["cost_usd"]
                observed = response["observed_model"]
                observed_identity = (
                    observed.get("vendor"),
                    observed.get("identifier"),
                    observed.get("version"),
                )
                if observed_identity != pin_identities[condition_name]:
                    raise InputError(
                        f"adapter observed model {observed_identity!r}, expected pinned "
                        f"model {pin_identities[condition_name]!r}; collection stopped"
                    )
                scores[spec_id] = response["score"]
                if run_model is None:
                    run_model = response["observed_model"]
                elif run_model != response["observed_model"]:
                    raise InputError(
                        f"adapter model changed within {condition_name} run {run_number}"
                    )
            collected_runs.append({
                "run_id": f"{condition_name}-{run_number}",
                "observed_model": run_model,
                "scores": scores,
            })
        collected_conditions[condition_name] = {
            "label": source_condition.get("label"),
            "pinned_model": pinned_model,
            "runs": collected_runs,
        }

    duration = time.monotonic() - started
    return {
        "schema_version": "tier2-comparison-input/v1",
        "comparison_id": plan_input.get("comparison_id"),
        "expected_n": expected_n,
        "bootstrap": plan_input["bootstrap"],
        "locked_specs": specs,
        "collection": {
            "mode": "explicit_manual_adapter",
            "adapter_invocations": adapter_invocations,
            "expected_n": expected_n,
            "plan": cost_plan,
        },
        "measurement": {
            "run_id": plan_input.get("comparison_id"),
            "tier": "tier2",
            "started_at": started_at,
            "duration_s": duration,
            "cost_usd": round(total_cost, 8),
            "invocation": {"source": "manual", "explicit_override": False},
        },
        "conditions": collected_conditions,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Explicit manual Tier 2 collector; may invoke the supplied paid adapter.",
    )
    parser.add_argument("plan", type=Path)
    parser.add_argument("--adapter", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--budgets", type=Path, default=DEFAULT_BUDGETS)
    parser.add_argument("--acknowledge-paid-vendor-calls", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = collect(args)
        write_json(result, args.output)
    except InputError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(
        "COLLECTED fixture-only-compatible "
        f"calls={result['collection']['adapter_invocations']} output={args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
