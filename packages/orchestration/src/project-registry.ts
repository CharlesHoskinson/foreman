import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  canonicalize,
  decodeUtf8Fatal,
  isCoreFailure,
  parseJsonRejectDuplicateKeys,
} from "@foreman/core";

const ONE_MIB = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const REGISTRY_KEYS = ["generation", "projects", "schema"] as const;
const PROJECT_KEYS = [
  "generation",
  "git_common_dir",
  "operation_id",
  "project_id",
  "state",
  "store_backend",
  "store_location",
  "worktree_paths",
] as const;

export type ProjectStoreBackendV1 = "sqlite" | "files-only";
export type ProjectRegistryStateV1 = "active" | "missing" | "conflicted";

export type ProjectRegistryRecordV1 = {
  readonly project_id: string;
  readonly operation_id: string;
  readonly generation: number;
  readonly git_common_dir: string;
  readonly worktree_paths: readonly string[];
  readonly store_backend: ProjectStoreBackendV1;
  readonly store_location: string;
  readonly state: ProjectRegistryStateV1;
};

export type ProjectRegistryV1 = {
  readonly schema: "foreman.project-registry.v1";
  readonly generation: number;
  readonly projects: readonly ProjectRegistryRecordV1[];
};

export type ProjectRegistrationInputV1 = {
  readonly project_id: string;
  readonly operation_id: string;
  readonly git_common_dir: string;
  readonly worktree_path: string;
  readonly store_backend: ProjectStoreBackendV1;
  readonly store_location: string;
};

export type ProjectRegistrationResultV1 =
  | {
      readonly _tag: "Registered";
      readonly registry: ProjectRegistryV1;
      readonly project: ProjectRegistryRecordV1;
      readonly changed: boolean;
    }
  | { readonly _tag: "Refused"; readonly reason: "invalid_input" | "binding_conflict" };

export type ProjectRegistryDecodeResultV1 =
  | { readonly _tag: "Valid"; readonly value: ProjectRegistryV1 }
  | { readonly _tag: "Invalid" };

export type ProjectRegistryFileResultV1 =
  | Extract<ProjectRegistrationResultV1, { readonly _tag: "Registered" }>
  | {
      readonly _tag: "Refused";
      readonly reason:
        | "binding_conflict"
        | "invalid_input"
        | "invalid_registry"
        | "unsafe_path"
        | "io_failure";
    };

export type ProjectRegistryFileReadResultV1 =
  | { readonly _tag: "Valid"; readonly value: ProjectRegistryV1 }
  | {
      readonly _tag: "Invalid";
      readonly reason: "invalid_registry" | "unsafe_path" | "io_failure";
    };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactOwnKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const own = Object.keys(value);
  return (
    own.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validAbsolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4096 &&
    !CONTROL.test(value) &&
    isAbsolute(value)
  );
}

function validSafeInteger(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function compareUtf8(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}

function parseProject(value: unknown): ProjectRegistryRecordV1 | null {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, PROJECT_KEYS)) {
    return null;
  }
  if (!validUuid(value["project_id"]) || !validUuid(value["operation_id"])) {
    return null;
  }
  if (!validSafeInteger(value["generation"], 1)) return null;
  if (!validAbsolutePath(value["git_common_dir"])) return null;
  if (!validAbsolutePath(value["store_location"])) return null;
  if (
    value["store_backend"] !== "sqlite" &&
    value["store_backend"] !== "files-only"
  ) {
    return null;
  }
  if (
    value["state"] !== "active" &&
    value["state"] !== "missing" &&
    value["state"] !== "conflicted"
  ) {
    return null;
  }
  const worktreePaths = value["worktree_paths"];
  if (!Array.isArray(worktreePaths) || worktreePaths.length === 0) return null;
  const paths: string[] = [];
  let previous: string | undefined;
  for (const path of worktreePaths) {
    if (!validAbsolutePath(path)) return null;
    if (previous !== undefined && compareUtf8(previous, path) >= 0) return null;
    paths.push(path);
    previous = path;
  }
  return {
    project_id: value["project_id"],
    operation_id: value["operation_id"],
    generation: value["generation"],
    git_common_dir: value["git_common_dir"],
    worktree_paths: paths,
    store_backend: value["store_backend"],
    store_location: value["store_location"],
    state: value["state"],
  };
}

function parseRegistry(value: unknown): ProjectRegistryV1 | null {
  if (!isPlainObject(value) || !hasExactOwnKeys(value, REGISTRY_KEYS)) {
    return null;
  }
  if (value["schema"] !== "foreman.project-registry.v1") return null;
  if (!validSafeInteger(value["generation"], 0)) return null;
  if (!Array.isArray(value["projects"])) return null;
  if (value["projects"].length > 10_000) return null;

  const projects: ProjectRegistryRecordV1[] = [];
  const ids = new Set<string>();
  const commonDirs = new Set<string>();
  const stores = new Set<string>();
  let previousId: string | undefined;
  for (const item of value["projects"]) {
    const project = parseProject(item);
    if (project === null || project.generation > value["generation"]) return null;
    if (
      ids.has(project.project_id) ||
      commonDirs.has(project.git_common_dir) ||
      stores.has(project.store_location)
    ) {
      return null;
    }
    if (
      previousId !== undefined &&
      compareUtf8(previousId, project.project_id) >= 0
    ) {
      return null;
    }
    ids.add(project.project_id);
    commonDirs.add(project.git_common_dir);
    stores.add(project.store_location);
    projects.push(project);
    previousId = project.project_id;
  }
  if (projects.length === 0 && value["generation"] !== 0) return null;
  if (projects.length > 0 && value["generation"] === 0) return null;
  return {
    schema: "foreman.project-registry.v1",
    generation: value["generation"],
    projects,
  };
}

export function emptyProjectRegistryV1(): ProjectRegistryV1 {
  return {
    schema: "foreman.project-registry.v1",
    generation: 0,
    projects: [],
  };
}

export function renderProjectRegistryFileV1(
  registry: ProjectRegistryV1,
): Uint8Array {
  const parsed = parseRegistry(registry);
  if (parsed === null) throw new Error("invalid project registry");
  return new TextEncoder().encode(`${canonicalize(parsed)}\n`);
}

export function decodeProjectRegistryFileV1(
  bytes: Uint8Array,
): ProjectRegistryDecodeResultV1 {
  try {
    if (bytes.byteLength > ONE_MIB) return { _tag: "Invalid" };
    const text = decodeUtf8Fatal(bytes);
    if (isCoreFailure(text)) return { _tag: "Invalid" };
    if (!text.endsWith("\n") || text.endsWith("\n\n")) {
      return { _tag: "Invalid" };
    }
    const body = text.slice(0, -1);
    const decoded = parseJsonRejectDuplicateKeys(body);
    if (isCoreFailure(decoded)) return { _tag: "Invalid" };
    if (canonicalize(decoded) !== body) return { _tag: "Invalid" };
    const value = parseRegistry(decoded);
    return value === null ? { _tag: "Invalid" } : { _tag: "Valid", value };
  } catch {
    return { _tag: "Invalid" };
  }
}

function validRegistrationInput(
  input: ProjectRegistrationInputV1,
): boolean {
  return (
    validUuid(input.project_id) &&
    validUuid(input.operation_id) &&
    validAbsolutePath(input.git_common_dir) &&
    validAbsolutePath(input.worktree_path) &&
    validAbsolutePath(input.store_location) &&
    (input.store_backend === "sqlite" || input.store_backend === "files-only")
  );
}

export function registerProjectV1(
  registry: ProjectRegistryV1,
  input: ProjectRegistrationInputV1,
): ProjectRegistrationResultV1 {
  const current = parseRegistry(registry);
  if (current === null || !validRegistrationInput(input)) {
    return { _tag: "Refused", reason: "invalid_input" };
  }
  const commonMatch = current.projects.find(
    (project) => project.git_common_dir === input.git_common_dir,
  );
  const storeMatch = current.projects.find(
    (project) => project.store_location === input.store_location,
  );
  if (commonMatch !== undefined || storeMatch !== undefined) {
    if (commonMatch === undefined || commonMatch !== storeMatch) {
      return { _tag: "Refused", reason: "binding_conflict" };
    }
    const worktrees = [...commonMatch.worktree_paths];
    if (worktrees.includes(input.worktree_path)) {
      return {
        _tag: "Registered",
        registry: current,
        project: commonMatch,
        changed: false,
      };
    }
    worktrees.push(input.worktree_path);
    worktrees.sort(compareUtf8);
    const project: ProjectRegistryRecordV1 = {
      ...commonMatch,
      generation: commonMatch.generation + 1,
      worktree_paths: worktrees,
    };
    const projects = current.projects
      .map((item) =>
        item.project_id === project.project_id ? project : item,
      )
      .sort((left, right) => compareUtf8(left.project_id, right.project_id));
    return {
      _tag: "Registered",
      registry: { ...current, generation: current.generation + 1, projects },
      project,
      changed: true,
    };
  }
  if (
    current.projects.some(
      (project) =>
        project.project_id === input.project_id ||
        project.operation_id === input.operation_id,
    )
  ) {
    return { _tag: "Refused", reason: "binding_conflict" };
  }
  const project: ProjectRegistryRecordV1 = {
    project_id: input.project_id,
    operation_id: input.operation_id,
    generation: 1,
    git_common_dir: input.git_common_dir,
    worktree_paths: [input.worktree_path],
    store_backend: input.store_backend,
    store_location: input.store_location,
    state: "active",
  };
  const projects = [...current.projects, project].sort((left, right) =>
    compareUtf8(left.project_id, right.project_id),
  );
  return {
    _tag: "Registered",
    registry: { ...current, generation: current.generation + 1, projects },
    project,
    changed: true,
  };
}

export function resolveProjectV1(
  registry: ProjectRegistryV1,
  input: {
    readonly git_common_dir: string;
    readonly store_location: string;
  },
): ProjectRegistryRecordV1 | null {
  const current = parseRegistry(registry);
  if (current === null) return null;
  return (
    current.projects.find(
      (project) =>
        project.state === "active" &&
        project.git_common_dir === input.git_common_dir &&
        project.store_location === input.store_location,
    ) ?? null
  );
}

type RegistryRead =
  | {
      readonly _tag: "Read";
      readonly registry: ProjectRegistryV1;
      readonly identity: Stats | null;
    }
  | {
      readonly _tag: "Refused";
      readonly reason: "invalid_registry" | "unsafe_path" | "io_failure";
    };

function isEnoent(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function sameIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readRegistryFile(path: string): RegistryRead {
  let pathStat: Stats;
  try {
    pathStat = lstatSync(path);
  } catch (error) {
    if (isEnoent(error)) {
      return {
        _tag: "Read",
        registry: emptyProjectRegistryV1(),
        identity: null,
      };
    }
    return { _tag: "Refused", reason: "io_failure" };
  }
  if (
    pathStat.isSymbolicLink() ||
    !pathStat.isFile() ||
    pathStat.nlink !== 1
  ) {
    return { _tag: "Refused", reason: "unsafe_path" };
  }
  if (pathStat.size > ONE_MIB) {
    return { _tag: "Refused", reason: "invalid_registry" };
  }

  let fd: number | undefined;
  try {
    const noFollow = constants.O_NOFOLLOW ?? 0;
    fd = openSync(path, constants.O_RDONLY | noFollow);
    const opened = fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.size > ONE_MIB ||
      !sameIdentity(pathStat, opened)
    ) {
      return { _tag: "Refused", reason: "unsafe_path" };
    }
    const buffer = Buffer.alloc(ONE_MIB + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const count = readSync(fd, buffer, offset, buffer.byteLength - offset, null);
      if (count === 0) break;
      offset += count;
    }
    const afterOpen = fstatSync(fd);
    const afterPath = lstatSync(path);
    if (
      offset > ONE_MIB ||
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      afterPath.nlink !== 1 ||
      !sameIdentity(opened, afterOpen) ||
      !sameIdentity(opened, afterPath) ||
      afterOpen.size !== offset
    ) {
      return { _tag: "Refused", reason: "unsafe_path" };
    }
    const decoded = decodeProjectRegistryFileV1(
      Uint8Array.from(buffer.subarray(0, offset)),
    );
    return decoded._tag === "Valid"
      ? { _tag: "Read", registry: decoded.value, identity: afterPath }
      : { _tag: "Refused", reason: "invalid_registry" };
  } catch (error) {
    return {
      _tag: "Refused",
      reason: isEnoent(error) ? "unsafe_path" : "io_failure",
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function loadProjectRegistryFileV1(
  registryPath: string,
): ProjectRegistryFileReadResultV1 {
  if (!validAbsolutePath(registryPath)) {
    return { _tag: "Invalid", reason: "unsafe_path" };
  }
  const read = readRegistryFile(registryPath);
  return read._tag === "Read"
    ? { _tag: "Valid", value: read.registry }
    : { _tag: "Invalid", reason: read.reason };
}

function targetUnchanged(path: string, before: Stats | null): boolean {
  try {
    const after = lstatSync(path);
    return (
      before !== null &&
      !after.isSymbolicLink() &&
      after.isFile() &&
      after.nlink === 1 &&
      sameIdentity(before, after)
    );
  } catch (error) {
    return before === null && isEnoent(error);
  }
}

function publishRegistryFile(
  path: string,
  bytes: Uint8Array,
  before: Stats | null,
): "ok" | "unsafe_path" | "io_failure" {
  const parent = dirname(path);
  let parentStat: Stats;
  try {
    parentStat = lstatSync(parent);
  } catch {
    return "io_failure";
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    return "unsafe_path";
  }
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );
  let fd: number | undefined;
  let published = false;
  try {
    fd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      offset += writeSync(fd, bytes, offset, bytes.byteLength - offset);
    }
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (!targetUnchanged(path, before)) return "unsafe_path";
    renameSync(temporary, path);
    published = true;
    const parentFd = openSync(parent, constants.O_RDONLY);
    try {
      fsyncSync(parentFd);
    } finally {
      closeSync(parentFd);
    }
    return "ok";
  } catch {
    return "io_failure";
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!published) {
      try {
        unlinkSync(temporary);
      } catch {
        // The temporary file can be absent when creation failed.
      }
    }
  }
}

export function registerProjectFileV1(
  registryPath: string,
  input: ProjectRegistrationInputV1,
): ProjectRegistryFileResultV1 {
  if (!validAbsolutePath(registryPath)) {
    return { _tag: "Refused", reason: "invalid_input" };
  }
  const read = readRegistryFile(registryPath);
  if (read._tag === "Refused") return read;
  const registered = registerProjectV1(read.registry, input);
  if (registered._tag === "Refused") return registered;
  if (!registered.changed) return registered;
  const published = publishRegistryFile(
    registryPath,
    renderProjectRegistryFileV1(registered.registry),
    read.identity,
  );
  return published === "ok"
    ? registered
    : { _tag: "Refused", reason: published };
}
