# Verification on 2026-09-15

## Live result

The compiled runtime qualified `gpt-6-astra` through `codex-app-server` 0.154.0/v2 with `native:codex:default`.
All six requested capabilities passed: generation, structured output, coding, tools, permission boundary, and workspace boundary.
The provider changed only the required file bytes.
The host retained its permission decision and checked the unchanged Git HEAD and index.
The worker had no host profile mount.

The user approved a final limit of 28,000 input tokens, 2,000 output tokens, two tools, and USD 1.
The observed usage was 25,176 input tokens and 192 output tokens.
Earlier 20,000-input-token attempts failed their bound and did not establish qualification.
The final report is retained at:

```text
/root/.foreman/providers/qualification-7CJbtf/runs/qualification/artifacts/sha256-779cbbe9ab319afa4c8c709b53d8e3ae6d7f498b1c08a77306c762dbb694b04f
```

This report has its original expiry and identity bindings.
It does not qualify another account, model, or transport version.
Managed refresh passed fixture tests. This live run did not establish a real expired-token refresh.

## Automated checks

The focused broker, transport, native-boundary, and native-qualification tests passed: 43 tests, zero failures.
Strict type checking, runtime verification, register-document verification, and strict OpenSpec validation passed.
The full suite before the final environment-field correction reported 3,326 passes, five failures, and 19 skips.
The final environment-field correction passed the focused tests and live qualification.

The failed suite entries belong to the release-coverage tests.
Two OpenSpec dependency tests received an absent `requires` field.
Two CLI checks returned `dependency_failure`. A failed parent subtest accounts for the fifth failure.
The same failures reproduced on unchanged upstream commit `a73562b64c900c6042d592823493f8accce58254` after required historical Git objects were available.
These failures remain open. This change does not claim a green full suite.

## Review and scope

An independent Codex source reviewer checked credential isolation, account pinning, bounded refresh, cleanup, and protocol compatibility.
Review findings about failed login notifications and refresh coverage were resolved.
The reviewer found no new blocking issue in the final changes.
This review is not cross-vendor Pel approval.

Grok native login, keyring-only Codex credentials, and the Moriarty roadmap audit remain outside this completed authentication implementation.
Installation completion belongs to the local deployment receipt, not this pre-install candidate record.
