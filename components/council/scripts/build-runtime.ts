import { build } from "esbuild";

await build({
  entryPoints: ["packages/runtime-node/src/preflight-cli.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node24"],
  outfile: "packages/runtime-node/dist/preflight-cli.js",
  logLevel: "info",
});
