import { canonicalize } from "@foreman/core";
import type { AppliancePinsV1 } from "./appliance-lock.js";

export type ApplianceDoctorObservationV1 = {
  readonly uid: number;
  readonly nodeVersion: string;
  readonly toolVersions: {
    readonly npm: string;
    readonly codex: string;
    readonly grok: string;
    readonly graphify: string;
  };
  readonly directories: {
    readonly workspace: {
      readonly directory: boolean;
      readonly writable: boolean;
    };
    readonly state: {
      readonly directory: boolean;
      readonly writable: boolean;
    };
    readonly runtime: {
      readonly directory: boolean;
      readonly writable: boolean;
    };
  };
  readonly runtimeManifestValid: boolean;
  readonly skills: readonly string[];
};

export type ApplianceDoctorReasonV1 =
  | "invalid_observation"
  | "root_user"
  | "tool_mismatch"
  | "mount_mismatch"
  | "runtime_mismatch"
  | "skill_mismatch";

export type ApplianceDoctorResultV1 =
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Ready";
      readonly uid: number;
      readonly tools: {
        readonly node: string;
        readonly npm: string;
        readonly codex: string;
        readonly grok: string;
        readonly graphify: string;
      };
      readonly skills: readonly ["foreman", "graphify", "superpowers"];
    }
  | {
      readonly schemaVersion: 1;
      readonly _tag: "Refused";
      readonly reason: ApplianceDoctorReasonV1;
    };

export type ApplianceDoctorCliIo = {
  readonly writeStdout: (text: string) => void;
  readonly writeStderr: (text: string) => void;
};

export type ApplianceDoctorServices = {
  readonly loadPins: () => AppliancePinsV1;
  readonly observe: () => ApplianceDoctorObservationV1;
};

const OBSERVATION_KEYS = [
  "uid",
  "nodeVersion",
  "toolVersions",
  "directories",
  "runtimeManifestValid",
  "skills",
] as const;
const TOOL_KEYS = ["npm", "codex", "grok", "graphify"] as const;
const DIRECTORY_KEYS = ["workspace", "state", "runtime"] as const;
const DIRECTORY_STATE_KEYS = ["directory", "writable"] as const;
const REQUIRED_SKILLS = ["foreman", "graphify", "superpowers"] as const;

function refused(reason: ApplianceDoctorReasonV1): ApplianceDoctorResultV1 {
  return { schemaVersion: 1, _tag: "Refused", reason };
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function validDirectoryState(value: unknown): boolean {
  return (
    plainObject(value) &&
    exactKeys(value, DIRECTORY_STATE_KEYS) &&
    typeof value["directory"] === "boolean" &&
    typeof value["writable"] === "boolean"
  );
}

function validObservation(
  value: unknown,
): value is ApplianceDoctorObservationV1 {
  if (!plainObject(value) || !exactKeys(value, OBSERVATION_KEYS)) return false;
  const tools = value["toolVersions"];
  const directories = value["directories"];
  const skills = value["skills"];
  return (
    typeof value["uid"] === "number" &&
    Number.isSafeInteger(value["uid"]) &&
    value["uid"] >= 0 &&
    typeof value["nodeVersion"] === "string" &&
    plainObject(tools) &&
    exactKeys(tools, TOOL_KEYS) &&
    TOOL_KEYS.every((key) => typeof tools[key] === "string") &&
    plainObject(directories) &&
    exactKeys(directories, DIRECTORY_KEYS) &&
    DIRECTORY_KEYS.every((key) => validDirectoryState(directories[key])) &&
    typeof value["runtimeManifestValid"] === "boolean" &&
    Array.isArray(skills) &&
    skills.every((skill) => typeof skill === "string")
  );
}

export function evaluateApplianceDoctorV1(
  pins: AppliancePinsV1,
  observation: ApplianceDoctorObservationV1,
): ApplianceDoctorResultV1 {
  try {
    if (!validObservation(observation)) return refused("invalid_observation");
    if (observation.uid === 0) return refused("root_user");
    if (
      observation.nodeVersion !== pins.tools.node ||
      observation.toolVersions.npm !== pins.tools.npm ||
      observation.toolVersions.codex !== pins.tools.codex ||
      observation.toolVersions.grok !== pins.tools.grok ||
      observation.toolVersions.graphify !== pins.tools.graphify
    ) {
      return refused("tool_mismatch");
    }
    if (
      DIRECTORY_KEYS.some((key) => {
        const state = observation.directories[key];
        return !state.directory || !state.writable;
      })
    ) {
      return refused("mount_mismatch");
    }
    if (!observation.runtimeManifestValid) return refused("runtime_mismatch");
    if (
      observation.skills.length !== REQUIRED_SKILLS.length ||
      REQUIRED_SKILLS.some((skill, index) => observation.skills[index] !== skill)
    ) {
      return refused("skill_mismatch");
    }
    return {
      schemaVersion: 1,
      _tag: "Ready",
      uid: observation.uid,
      tools: {
        node: observation.nodeVersion,
        npm: observation.toolVersions.npm,
        codex: observation.toolVersions.codex,
        grok: observation.toolVersions.grok,
        graphify: observation.toolVersions.graphify,
      },
      skills: REQUIRED_SKILLS,
    };
  } catch {
    return refused("invalid_observation");
  }
}

export function runApplianceDoctorCli(
  argv: readonly string[],
  io: ApplianceDoctorCliIo,
  services: ApplianceDoctorServices,
): number {
  if (argv.length !== 3 || argv[2] !== "doctor") {
    try {
      io.writeStderr("usage: appliance-doctor doctor\n");
    } catch {
      // A closed exit code is still returned when the diagnostic stream fails.
    }
    return 64;
  }
  let result: ApplianceDoctorResultV1;
  try {
    result = evaluateApplianceDoctorV1(services.loadPins(), services.observe());
  } catch {
    result = refused("invalid_observation");
  }
  try {
    io.writeStdout(`${canonicalize(result)}\n`);
  } catch {
    return 1;
  }
  return result._tag === "Ready" ? 0 : 1;
}
