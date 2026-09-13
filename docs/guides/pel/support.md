# Inspect and export support evidence

Use the run ID returned by `foreman run`:

```text
foreman status RUN_ID --json
foreman support export --run RUN_ID --out support.json
```

Export reads the original project registry and run history. It writes a new JSON file atomically. It refuses an existing output file. The bundle contains the installed release identity, platform, exact known provider profiles and transports, safe failure codes, event sequence references, and a reproduction command.

The bundle records `evidenceKind` from the validated run binding: `product` or `test-fixture`. Legacy or unavailable bindings produce `unknown`. Installed package identity does not change the run's evidence classification.

The exporter does not copy credentials, environment values, provider session IDs, raw prompts, reasoning, or raw error messages. It uses a fixed field projection. An unknown provider revision string is omitted. The output is useful for locating retained local evidence; it is not a portable credential or execution grant.

A successful export exits 0. An unknown or ambiguous run exits 2. An output or history read failure exits 1. Cancellation exits 4 and removes an incomplete temporary file.

Inspect the bundle before sharing it. Project and run identifiers can still reveal organizational context. Retain the original history locally when you request support. Use [recovery commands](quickstart.md) for a recorded next action; exporting support data does not resume or cancel a run.

## Installed support status

The package includes `docs/guides/pel/package-support.json`. It identifies Linux x64 and Node.js >=24 <25 as the package platform. It preserves the source references, hashes, dispositions, and open status of the original release-program, lane-runtime-TypeScript, and workflow-weight-reduction obligations.

A retained or replaced scope classification is not a completion claim. The package manifest binds the support document, runtime, exact model evidence, source captures, and examples. Provider evidence remains specific to its model, transport, version, identity, capability, and tool policy. A packaged source capture or recorded test fixture does not qualify an installed account.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Command completed successfully |
| 1 | Command failed |
| 2 | Input or admission is invalid |
| 3 | A required action remains unresolved |
| 4 | Command was cancelled |

Code 5 is not an adoption-command outcome. Read the command's diagnostic and next action before retrying. An unknown external result can require reconciliation even after local cancellation.
