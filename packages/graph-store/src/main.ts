/**
 * Compiled entry point for skills/foreman/runtime/dist/graph-store.js
 * Commands: contract | capabilities | smoke | version-ref
 */
import { runGraphStoreCli } from "./cli.js";

const code = runGraphStoreCli(process.argv);
process.exit(code);
