import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  lstatSync,
  readFileSync,
} from "node:fs";
import { Effect } from "effect";
import { liveInstallFs, verifyRuntimeTree } from "@foreman/policy";
import { decodeApplianceLockV1 } from "./appliance-lock.js";
import {
  runApplianceDoctorCli,
  type ApplianceDoctorObservationV1,
} from "./appliance-doctor.js";

const RUNTIME_ROOT = "/opt/foreman/bin";
const LOCK_PATH = "/opt/foreman/appliance-lock.json";
const REQUIRED_SKILLS = ["foreman", "graphify", "superpowers"] as const;
const VERSION_PATTERN = /(?:^|\s)([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/;

function directoryState(path: string): {
  readonly directory: boolean;
  readonly writable: boolean;
} {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      return { directory: false, writable: false };
    }
    accessSync(path, constants.W_OK);
    return { directory: true, writable: true };
  } catch {
    return { directory: false, writable: false };
  }
}

function exactSkillDirectories(): readonly string[] {
  return REQUIRED_SKILLS.filter((skill) => {
    try {
      const stat = lstatSync(`/opt/foreman/skills/${skill}`);
      return stat.isDirectory() && !stat.isSymbolicLink();
    } catch {
      return false;
    }
  });
}

function commandVersion(command: string): string {
  try {
    const result = spawnSync(command, ["--version"], {
      encoding: "utf8",
      env: {
        HOME: "/state",
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/local/bin:/usr/bin:/bin",
      },
      maxBuffer: 65_536,
      timeout: 10_000,
      windowsHide: true,
    });
    if (result.error !== undefined || result.status !== 0) return "";
    const match = VERSION_PATTERN.exec(`${result.stdout}\n${result.stderr}`);
    return match?.[1] ?? "";
  } catch {
    return "";
  }
}

function observe(): ApplianceDoctorObservationV1 {
  let runtimeManifestValid = false;
  try {
    const result = Effect.runSync(
      verifyRuntimeTree(RUNTIME_ROOT).pipe(Effect.provide(liveInstallFs)),
    );
    runtimeManifestValid = result._tag === "Pass";
  } catch {
    runtimeManifestValid = false;
  }
  return {
    uid: process.getuid?.() ?? -1,
    nodeVersion: process.versions.node,
    toolVersions: {
      npm: commandVersion("/usr/local/bin/npm"),
      codex: commandVersion("/usr/local/bin/codex"),
      grok: commandVersion("/usr/local/bin/grok"),
      graphify: commandVersion("/usr/local/bin/graphify"),
    },
    directories: {
      workspace: directoryState("/workspace"),
      state: directoryState("/state"),
      runtime: directoryState("/run/foreman"),
    },
    runtimeManifestValid,
    skills: exactSkillDirectories(),
  };
}

const exitCode = runApplianceDoctorCli(
  process.argv,
  {
    writeStdout: (text) => process.stdout.write(text),
    writeStderr: (text) => process.stderr.write(text),
  },
  {
    loadPins: () => {
      const decoded = decodeApplianceLockV1(readFileSync(LOCK_PATH));
      if (decoded._tag !== "Valid") throw new Error("invalid appliance lock");
      return decoded.value;
    },
    observe,
  },
);
process.exitCode = exitCode;
