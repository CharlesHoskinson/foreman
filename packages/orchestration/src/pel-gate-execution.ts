/** Host-registered argv execution. Candidate and environment reads confer no new authority. */
import { Effect } from 'effect';
import { ProcessExec } from './queue-services.js';
import { pelFailure, pelHash, pelBytesHash } from './pel-journal.js';
import type { PelGateBindingV1, RunFailure, PelHostEffectFailureV1 } from './pel-run-contract.js';
import type { Result } from '@foreman/pel';

export interface PelGateExecutionPorts {
    readonly resolveEnvironment: (refs: readonly string[]) => Effect.Effect<Readonly<Record<string, string>>, RunFailure | PelHostEffectFailureV1>;
    readonly observeCandidate: () => Effect.Effect<string, RunFailure | PelHostEffectFailureV1>;
}
export interface PelGateExecutionV1 {
    readonly passed: boolean;
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
    readonly gateDigest: string;
    readonly environmentDigest: string;
    readonly beforeIdentityDigest: string;
    readonly afterIdentityDigest: string;
}
export function decodePelGateExecution(value: unknown, maxBytes: number): Result<PelGateExecutionV1, PelHostEffectFailureV1> {
    const fail = (): Result<never, PelHostEffectFailureV1> => ({ ok: false, error: verificationUnavailable('The durable gate report is malformed or differs from its output bytes.') });
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'afterIdentityDigest,beforeIdentityDigest,environmentDigest,exitCode,gateDigest,passed,stderr,stderrSha256,stdout,stdoutSha256') return fail();
    const v = value as Record<string, unknown>;
    if (typeof v.exitCode !== 'number' || !Number.isSafeInteger(v.exitCode) || v.exitCode < 0 || v.passed !== (v.exitCode === 0) || typeof v.stdout !== 'string' || typeof v.stderr !== 'string' || Buffer.byteLength(v.stdout) + Buffer.byteLength(v.stderr) > maxBytes || ['gateDigest', 'environmentDigest', 'beforeIdentityDigest', 'afterIdentityDigest'].some(key => typeof v[key] !== 'string' || !/^[a-f0-9]{64}$/u.test(v[key] as string)) || v.stdoutSha256 !== pelBytesHash(Buffer.from(v.stdout)) || v.stderrSha256 !== pelBytesHash(Buffer.from(v.stderr))) return fail();
    return { ok: true, value: value as PelGateExecutionV1 };
}
/** Caller selects gate from the bound project, holds its workspace resource and supplies its immutable candidate identity. */
export function runPelRegisteredGate(gate: PelGateBindingV1, workspaceRoot: string, candidateDigest: string, ports: PelGateExecutionPorts): Effect.Effect<PelGateExecutionV1, RunFailure | PelHostEffectFailureV1, ProcessExec> {
    return Effect.gen(function* () {
        if (!gate.argv.length || gate.argv.some(argument => typeof argument !== 'string' || argument.includes('\0')) || !Number.isSafeInteger(gate.timeoutMs) || gate.timeoutMs <= 0 || !Number.isSafeInteger(gate.maxOutputBytes) || gate.maxOutputBytes <= 0 || !/^[a-f0-9]{64}$/u.test(candidateDigest))
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The registered gate has invalid execution bounds.'));
        const environment = yield* ports.resolveEnvironment(gate.environmentRefs);
        if (Object.entries(environment).some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || typeof value !== 'string' || value.includes('\0')) || pelHash(environment) !== gate.environmentSha256)
            return yield* Effect.fail(pelFailure('binding-mismatch', 'The registered gate environment changed.'));
        const beforeIdentityDigest = yield* ports.observeCandidate();
        if (beforeIdentityDigest !== candidateDigest)
            return yield* Effect.fail(candidateChanged('The candidate changed before verification.'));
        const executor = yield* ProcessExec;
        const executed = yield* Effect.either(executor.runCaptured({ command: gate.argv[0], args: gate.argv.slice(1), cwd: workspaceRoot, env: { ...environment }, timeoutMs: gate.timeoutMs, maxOutputBytes: gate.maxOutputBytes }));
        const afterIdentityDigest = yield* ports.observeCandidate();
        if (afterIdentityDigest !== candidateDigest)
            return yield* Effect.fail(candidateChanged('The candidate changed during verification.'));
        if (executed._tag === 'Left')
            return yield* Effect.fail(verificationUnavailable(`The registered gate did not complete: ${executed.left.reason}.`));
        const { exitCode, stdout, stderr } = executed.right;
        const stdoutBytes = executed.right.stdoutBytes ?? Buffer.from(stdout), stderrBytes = executed.right.stderrBytes ?? Buffer.from(stderr);
        if (!Number.isInteger(exitCode) || exitCode < 0 || stdoutBytes.byteLength + stderrBytes.byteLength > gate.maxOutputBytes)
            return yield* Effect.fail(verificationUnavailable('The registered gate returned invalid or oversized evidence.'));
        yield* Effect.try({ try: () => { const decoder = new TextDecoder('utf-8', { fatal: true }); if (decoder.decode(stdoutBytes) !== stdout || decoder.decode(stderrBytes) !== stderr) throw Error('changed text'); }, catch: () => verificationUnavailable('Gate output is not exact UTF-8 evidence.') });
        return { passed: exitCode === 0, exitCode, stdout, stderr, stdoutSha256: pelBytesHash(stdoutBytes), stderrSha256: pelBytesHash(stderrBytes), gateDigest: pelHash(gate), environmentDigest: gate.environmentSha256, beforeIdentityDigest, afterIdentityDigest };
    });
}

const candidateChanged = (message: string): PelHostEffectFailureV1 => ({ code: 'candidate-changed', message });
const verificationUnavailable = (message: string): PelHostEffectFailureV1 => ({ code: 'verification-unavailable', message });
