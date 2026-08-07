/**
 * Pure executable-source classification from Git mode + bounded blob bytes.
 * Extensionless files with executable mode or shebang are in scope.
 */

import type { PolicyReason } from "./architecture-schema.js";
import {
  isTestsBatsPath,
  isTypeScriptPath,
  pathExtension,
  prohibitedExtensionReason,
} from "./architecture-extensions.js";

/** Closed identity of one committed tree entry at a bound OID. */
export type FileIdentity = {
  /** True when the path is absent at the commit. */
  readonly present: boolean;
  /** Raw Git mode string, e.g. "100644", "100755", "120000". */
  readonly mode: string | null;
  readonly isExecutable: boolean;
  readonly isSymlink: boolean;
  /** gitlink (submodule), tree, or other non-regular-blob. */
  readonly isSpecial: boolean;
};

export function parseLsTreeLine(line: string): FileIdentity | { error: true } {
  // Format: <mode> <type> <object>\\t<file>\0  or without trailing nul when split
  const trimmed = line.replace(/\0$/, "");
  if (trimmed.length === 0) {
    return {
      present: false,
      mode: null,
      isExecutable: false,
      isSymlink: false,
      isSpecial: false,
    };
  }
  // mode SP type SP object TAB path
  const tab = trimmed.indexOf("\t");
  if (tab < 0) return { error: true };
  const meta = trimmed.slice(0, tab);
  const parts = meta.split(" ");
  if (parts.length < 3) return { error: true };
  const mode = parts[0]!;
  const type = parts[1]!;
  if (!/^[0-7]{6}$/.test(mode)) return { error: true };
  if (type !== "blob" && type !== "tree" && type !== "commit") {
    return { error: true };
  }
  if (type === "tree" || type === "commit" || mode === "160000") {
    return {
      present: true,
      mode,
      isExecutable: false,
      isSymlink: false,
      isSpecial: true,
    };
  }
  if (mode === "120000") {
    return {
      present: true,
      mode,
      isExecutable: false,
      isSymlink: true,
      isSpecial: false,
    };
  }
  if (mode === "100644" || mode === "100664") {
    return {
      present: true,
      mode,
      isExecutable: false,
      isSymlink: false,
      isSpecial: false,
    };
  }
  if (mode === "100755") {
    return {
      present: true,
      mode,
      isExecutable: true,
      isSymlink: false,
      isSpecial: false,
    };
  }
  // Any other mode on a blob is special / unsupported
  return {
    present: true,
    mode,
    isExecutable: false,
    isSymlink: false,
    isSpecial: true,
  };
}

/**
 * Read the first line shebang interpreter token(s). Returns null when the
 * blob does not start with `#!`.
 */
export function readShebangInterpreter(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 2) return null;
  if (bytes[0] !== 0x23 || bytes[1] !== 0x21) return null; // #!
  // Bound shebang scan to first 256 bytes / first newline
  const limit = Math.min(bytes.byteLength, 256);
  let end = 2;
  while (end < limit) {
    const b = bytes[end]!;
    if (b === 0x0a || b === 0x0d) break;
    end += 1;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(2, end));
  } catch {
    return "";
  }
  return text.trim();
}

/**
 * Map a shebang interpreter string to a closed policy reason, or null when
 * the shebang is an allowed Node interpreter for TypeScript product source.
 */
export function shebangReason(
  interpreter: string,
  path: string,
): PolicyReason | null {
  const raw = interpreter.trim();
  if (raw.length === 0) return "prohibited_extensionless_executable";

  // #!/usr/bin/env NAME [args]  or  #!/path/to/NAME
  let cmd = raw;
  const envMatch = raw.match(/^\/usr\/bin\/env\s+(\S+)(?:\s|$)/);
  if (envMatch) {
    cmd = envMatch[1]!;
  } else {
    // Strip absolute/relative path to basename
    const slash = Math.max(cmd.lastIndexOf("/"), cmd.lastIndexOf("\\"));
    if (slash >= 0) cmd = cmd.slice(slash + 1);
    // Drop version suffixes like python3.12
  }
  const base = cmd.toLowerCase();

  if (
    base === "python" ||
    base === "python2" ||
    base === "python3" ||
    /^python\d+(\.\d+)*$/.test(base)
  ) {
    return "prohibited_python";
  }
  if (
    base === "sh" ||
    base === "bash" ||
    base === "dash" ||
    base === "zsh" ||
    base === "ksh" ||
    base === "busybox"
  ) {
    return "prohibited_posix_shell";
  }
  if (
    base === "pwsh" ||
    base === "powershell" ||
    base === "powershell.exe" ||
    base === "pwsh.exe"
  ) {
    return "prohibited_powershell";
  }
  if (base === "cmd" || base === "cmd.exe" || base === "command.com") {
    return "prohibited_cmd";
  }
  if (base === "deno") {
    return "prohibited_deno_only";
  }
  if (base === "bun") {
    return "prohibited_bun_only";
  }
  if (
    base === "node" ||
    base === "nodejs" ||
    base === "node.exe" ||
    base === "nodejs.exe"
  ) {
    // Node shebang is allowed only on TypeScript product paths
    if (isTypeScriptPath(path)) return null;
    return "prohibited_javascript";
  }

  // Bats test-runner interpreter is allowed only for genuine Bats test
  // data under tests/ (see isTestsBatsPath) -- never path-agnostic. bats
  // is a real test-fixture interpreter, not general shell.
  if (base === "bats") {
    if (isTestsBatsPath(path)) return null;
    return "prohibited_extensionless_executable";
  }

  return "prohibited_extensionless_executable";
}

/**
 * Classify an added/modified candidate file as prohibited executable source.
 * Returns null when the file is not executable source or is allowed TS.
 */
export function classifyExecutableSource(args: {
  readonly path: string;
  readonly identity: FileIdentity;
  readonly bytes: Uint8Array | null;
}): PolicyReason | null {
  if (!args.identity.present) {
    return "internal_failed";
  }
  if (args.identity.isSymlink || args.identity.isSpecial) {
    return "prohibited_special_mode";
  }
  if (args.bytes === null) {
    return "internal_failed";
  }

  // Extension-based prohibition still applies to ordinary source paths
  const extReason = prohibitedExtensionReason(args.path);
  if (extReason !== null) {
    return extReason;
  }

  // Allowed TypeScript product source (may carry a Node shebang)
  if (isTypeScriptPath(args.path)) {
    const shebang = readShebangInterpreter(args.bytes);
    if (shebang !== null) {
      return shebangReason(shebang, args.path);
    }
    return null;
  }

  const shebang = readShebangInterpreter(args.bytes);
  const isExecSource =
    args.identity.isExecutable || shebang !== null;

  if (!isExecSource) {
    // Non-executable, no shebang, non-prohibited extension → allowed data
    return null;
  }

  // Executable source without allowed TS extension
  if (shebang !== null) {
    return shebangReason(shebang, args.path);
  }
  // Executable mode, no shebang, no TS extension
  if (pathExtension(args.path) === "") {
    return "prohibited_extensionless_executable";
  }
  // Executable mode on an unknown/other extension
  return "prohibited_extensionless_executable";
}
