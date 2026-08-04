/**
 * Pure extension / runtime-family classification for executable source paths.
 */

import type { PolicyReason } from "./architecture-schema.js";

const RUNTIME_MANIFEST_PATH = "skills/foreman/runtime/manifest.json";
const RUNTIME_DIST_PREFIX = "skills/foreman/runtime/dist/";

export { RUNTIME_MANIFEST_PATH, RUNTIME_DIST_PREFIX };

/** Lowercase last path segment extension including leading dot, or "". */
export function pathExtension(path: string): string {
  const base = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

/**
 * Classify an added path's runtime family by extension alone.
 * Returns null when the extension is not a prohibited family by itself
 * (TypeScript, JSON, Markdown, declared generated bundle candidates, etc.).
 */
export function prohibitedExtensionReason(
  path: string,
): PolicyReason | null {
  const ext = pathExtension(path);
  switch (ext) {
    case ".py":
    case ".pyw":
    case ".pyi":
      return "prohibited_python";
    case ".sh":
    case ".bash":
    case ".zsh":
    case ".ksh":
      return "prohibited_posix_shell";
    case ".ps1":
    case ".psm1":
    case ".psd1":
      return "prohibited_powershell";
    case ".cmd":
    case ".bat":
      return "prohibited_cmd";
    case ".js":
      return "prohibited_javascript";
    case ".jsx":
      return "prohibited_jsx";
    case ".mjs":
      return "prohibited_mjs";
    case ".cjs":
      return "prohibited_cjs";
    default:
      return null;
  }
}

export function isTypeScriptPath(path: string): boolean {
  const ext = pathExtension(path);
  return ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts";
}

export function isLegacyExecutablePath(path: string): boolean {
  return prohibitedExtensionReason(path) !== null;
}

/** True when path is a candidate generated runtime bundle under dist/. */
export function isRuntimeBundlePath(path: string): boolean {
  if (!path.startsWith(RUNTIME_DIST_PREFIX)) return false;
  const rest = path.slice(RUNTIME_DIST_PREFIX.length);
  if (rest.length === 0 || rest.includes("/") || rest.includes("\\")) {
    return false;
  }
  return rest.endsWith(".js") && !rest.includes("..");
}

export function isRuntimeManifestPath(path: string): boolean {
  return path === RUNTIME_MANIFEST_PATH;
}
