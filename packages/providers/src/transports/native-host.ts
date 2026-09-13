import { isAbsolute } from "node:path";
import type { Result } from "@foreman/pel";
import type { HostPermissionPort, ProviderRequestV1 } from "../contract.js";
import type { ProviderFailure } from "../errors.js";
import type { NativeProcessPort } from "./native-process.js";
/** Host admission facts. Construct only from an enforced launcher/sandbox boundary, never provider or generated data. */
export interface NativeHostPort {
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly process?: NativeProcessPort;
  readonly workspaceGrantId?: string;
  readonly permissionGrantIds?: readonly string[];
  readonly hostPermissionPortRef?: string;
  readonly permissions?: HostPermissionPort;
  readonly toolPolicyNoneEnforced: boolean;
  readonly workspaceBoundaryEnforced: boolean;
  readonly permissionBoundaryEnforced: boolean;
  readonly sandboxProfile?: string;
}
export function validateNativeHost(
  request: ProviderRequestV1,
  host: NativeHostPort | undefined,
): Result<NativeHostPort, ProviderFailure> {
  const fail = (fieldPath: string): Result<never, ProviderFailure> => ({
    ok: false,
    error: {
      _tag: "UnsupportedCapability",
      retryClass: "never",
      message: "Native execution requires a matching host-enforced boundary",
      fieldPath,
    },
  });
  if (!host || typeof host.cwd !== "string" || !isAbsolute(host.cwd))
    return fail("host.cwd");
  const policy: unknown = request.toolPolicy;
  if (
    !policy ||
    typeof policy !== "object" ||
    Array.isArray(policy) ||
    !("mode" in policy)
  )
    return fail("toolPolicy");
  if (policy.mode === "none")
    return Object.keys(policy).length === 1 &&
      host.toolPolicyNoneEnforced === true
      ? { ok: true, value: host }
      : fail("toolPolicy.none");
  if (
    policy.mode !== "native-coding" ||
    !("workspaceGrantId" in policy) ||
    typeof policy.workspaceGrantId !== "string" ||
    !policy.workspaceGrantId ||
    !("hostPermissionPortRef" in policy) ||
    typeof policy.hostPermissionPortRef !== "string" ||
    !policy.hostPermissionPortRef ||
    !("permissionGrantIds" in policy) ||
    !Array.isArray(policy.permissionGrantIds) ||
    !policy.permissionGrantIds.length ||
    policy.permissionGrantIds.some(
      (id: unknown) => typeof id !== "string" || !id,
    ) ||
    Object.keys(policy).some(
      (key) =>
        ![
          "mode",
          "workspaceGrantId",
          "permissionGrantIds",
          "hostPermissionPortRef",
        ].includes(key),
    )
  )
    return fail("toolPolicy.grants");
  if (
    !host.workspaceGrantId ||
    !host.hostPermissionPortRef ||
    !host.permissionGrantIds?.length ||
    host.permissionGrantIds.some((id) => !id)
  )
    return fail("host.grants");
  if (
    host.workspaceBoundaryEnforced !== true ||
    host.workspaceGrantId !== policy.workspaceGrantId
  )
    return fail("toolPolicy.workspaceGrantId");
  if (
    host.permissionBoundaryEnforced !== true ||
    !host.permissions ||
    typeof host.permissions.authorize !== "function" ||
    typeof host.permissions.submit !== "function" ||
    host.hostPermissionPortRef !== policy.hostPermissionPortRef ||
    policy.permissionGrantIds.some(
      (id: string) => !host.permissionGrantIds?.includes(id),
    )
  )
    return fail("toolPolicy.permissionGrantIds");
  return { ok: true, value: host };
}
