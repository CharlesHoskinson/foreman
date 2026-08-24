import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseAppliancePinsV1,
  renderApplianceLockV1,
  validateApplianceLockProjectionV1,
} from "../packages/orchestration/src/appliance-lock.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "env/reference-manifest.toml");
const lockPath = join(root, "containers/appliance/lock.json");

function usage(): void {
  process.stderr.write("usage: appliance-lock.ts --check|--write\n");
  process.exitCode = 2;
}

const action = process.argv[2];
if (process.argv.length !== 3 || (action !== "--check" && action !== "--write")) {
  usage();
} else {
  const manifestText = readFileSync(manifestPath, "utf8");
  const pins = parseAppliancePinsV1(manifestText);
  if (pins._tag !== "Valid") {
    process.stderr.write("appliance-lock: invalid reference manifest pins\n");
    process.exitCode = 1;
  } else if (action === "--write") {
    writeFileSync(lockPath, renderApplianceLockV1(pins.value), {
      encoding: "utf8",
      mode: 0o644,
    });
    process.stdout.write("appliance-lock: wrote canonical projection\n");
  } else {
    const result = validateApplianceLockProjectionV1({
      manifestText,
      lockBytes: readFileSync(lockPath),
    });
    if (result._tag !== "Valid") {
      process.stderr.write("appliance-lock: projection drift\n");
      process.exitCode = 1;
    } else {
      process.stdout.write("appliance-lock: ok\n");
    }
  }
}
