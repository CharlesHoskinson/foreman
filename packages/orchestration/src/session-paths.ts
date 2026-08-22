/**
 * Pure path helpers for the session CLI.
 */

import { resolve } from "node:path";

export function sidecarPathFor(p: string): string {
  return p.replace(/\.db$/, ".ndjson");
}

export function pathsAlias(left: string, right: string): boolean {
  try {
    return resolve(left) === resolve(right);
  } catch {
    return false;
  }
}
