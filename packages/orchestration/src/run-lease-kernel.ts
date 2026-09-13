/** The existing run lease uses the shared anchored kernel ownership protocol. */
import { acquireKernelDirectoryLock } from '@foreman/core';
export function acquireKernelRunLease(runFd: number): { readonly release: () => void } | null {
 return acquireKernelDirectoryLock(runFd, '.supervise.lock', 'foreman-run-lease/flock/v1');
}
