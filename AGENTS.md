# Foreman repository instructions

## Iron Rule: Node.js and TypeScript

All new executable code in this repository SHALL run on Node.js 24 and SHALL
be written in TypeScript.

- Do not add Python, Bash, PowerShell, CMD, JavaScript, MJS, or CJS
  implementation files.
- Put new production logic in a TypeScript package. Put its tests in
  TypeScript.
- Existing non-TypeScript entry points can change only to delete behavior or
  to become thin compatibility adapters that locate Node.js, forward exact
  arguments and environment, execute one compiled TypeScript entry point, and
  preserve its exit status and byte streams.
- A compatibility adapter must not parse domain data, implement business
  rules, own durable state, schedule work, retry work, or supervise processes.
- Use Effect when a module owns typed failures, scoped resources, cancellation,
  retries, timeouts, or concurrent work. Keep pure deterministic transforms as
  ordinary TypeScript functions.
- Compile with strict type checking. Run the compiled product with Node.js,
  not Bun, Deno, or a TypeScript-only runtime.
- Generated bundled JavaScript in the declared build output is not source.
  Do not hand-edit it or put product logic only in generated output.
- Treat the existing Bash and Python implementations as migration sources,
  not as architecture for new work.

The controlling change is `openspec/changes/node-typescript-runtime/`.
