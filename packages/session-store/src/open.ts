import { raise } from "./failures.js";
import { openFilesOnlyStore } from "./files-only.js";
import type { SessionStore } from "./port.js";
import { SqliteSessionStore } from "./sqlite-store.js";

export type SessionStoreOpenAccess = {
  readonly readOnly: boolean;
  readonly allowMigration: boolean;
};

export type SessionStoreSelection = {
  readonly location: string;
  readonly locationKind: "file" | "directory";
};

export type OpenSessionStoreOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly readOnly?: boolean;
  readonly prepareSqlite?: (
    path: string,
    access: SessionStoreOpenAccess,
  ) => void;
  /** Lazy SQLite path used only when FOREMAN_SESSION_DB is missing or blank. */
  readonly defaultSqlitePath?: () => string;
  /** Invoked once after the location is valid and before prepare/open. */
  readonly onSelected?: (selection: SessionStoreSelection) => void;
};

export type OpenSqliteStoreOptions = {
  readonly path: string;
  readonly readOnly?: boolean;
  readonly prepareSqlite?: (
    path: string,
    access: SessionStoreOpenAccess,
  ) => void;
  readonly onSelected?: (selection: SessionStoreSelection) => void;
};

const CANONICAL_BACKENDS = ["sqlite", "files_only"] as const;
type CanonicalBackend = (typeof CANONICAL_BACKENDS)[number];

function normalizeBackend(raw: string | undefined): CanonicalBackend {
  const normalized = (raw ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "sqlite") return "sqlite";
  if (
    normalized === "files_only" ||
    normalized === "files" ||
    normalized === "file"
  ) {
    return "files_only";
  }
  raise(
    "backend_misconfiguration",
    `unknown FOREMAN_SESSION_BACKEND ${JSON.stringify(raw)}; accepted canonical names are ${CANONICAL_BACKENDS.join(" and ")}`,
  );
}

function nonemptyPath(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") return undefined;
  return value;
}

/**
 * Forced SQLite open. Reads no environment and never consults
 * FOREMAN_SESSION_BACKEND. Selection → preparation → open ordering matches
 * the SQLite branch of openSessionStore.
 */
export function openSqliteSessionStore(
  opts: OpenSqliteStoreOptions,
): SessionStore {
  return openSqliteAtPath(opts);
}

function openSqliteAtPath(opts: OpenSqliteStoreOptions): SessionStore {
  const readOnly = opts.readOnly === true;
  const selection: SessionStoreSelection = {
    location: opts.path,
    locationKind: "file",
  };
  opts.onSelected?.(selection);
  const access: SessionStoreOpenAccess = {
    readOnly,
    allowMigration: !readOnly,
  };
  opts.prepareSqlite?.(opts.path, access);
  return SqliteSessionStore.open(opts.path, { readOnly });
}

/**
 * Single SessionStore backend-selection point.
 *
 * Reads FOREMAN_SESSION_BACKEND (default sqlite), then the path/dir variable
 * required by that backend. SQLite bootstrap injection stays optional via
 * prepareSqlite; files-only never invokes it. defaultSqlitePath is evaluated
 * only on the SQLite branch when FOREMAN_SESSION_DB is missing or blank.
 */
export function openSessionStore(
  opts: OpenSessionStoreOptions = {},
): SessionStore {
  const env = opts.env ?? process.env;
  const readOnly = opts.readOnly === true;
  const backend = normalizeBackend(env.FOREMAN_SESSION_BACKEND);

  if (backend === "sqlite") {
    const path =
      nonemptyPath(env.FOREMAN_SESSION_DB) ??
      nonemptyPath(opts.defaultSqlitePath?.());
    if (path === undefined) {
      raise(
        "backend_misconfiguration",
        "FOREMAN_SESSION_DB is required when FOREMAN_SESSION_BACKEND is sqlite",
      );
    }
    return openSqliteAtPath({
      path,
      readOnly,
      ...(opts.prepareSqlite !== undefined
        ? { prepareSqlite: opts.prepareSqlite }
        : {}),
      ...(opts.onSelected !== undefined ? { onSelected: opts.onSelected } : {}),
    });
  }

  const dir = nonemptyPath(env.FOREMAN_SESSION_DIR);
  if (dir === undefined) {
    raise(
      "backend_misconfiguration",
      "FOREMAN_SESSION_DIR is required when FOREMAN_SESSION_BACKEND is files_only",
    );
  }
  opts.onSelected?.({
    location: dir,
    locationKind: "directory",
  });
  return openFilesOnlyStore({ dir, readOnly });
}
