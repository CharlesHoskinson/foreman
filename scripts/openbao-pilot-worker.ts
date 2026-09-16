import { readFileSync, readdirSync } from "node:fs";

const input = readFileSync(3, "utf8");
if (process.argv.includes("--timeout")) setInterval(() => {}, 1_000);
const parsed = JSON.parse(input) as { accessToken?: unknown };
if (typeof parsed.accessToken !== "string" || !parsed.accessToken.startsWith("foreman-synthetic-access-")) process.exit(2);
const names = readdirSync(process.cwd()).sort();
process.stdout.write(JSON.stringify({ schemaVersion: 1, channel: "fd3", argv: process.argv.slice(2), environmentKeys: Object.keys(process.env).sort(), files: names, accessAccepted: true }));
