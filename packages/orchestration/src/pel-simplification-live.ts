/** Bounded read-only Git collection for the fixed release comparison. */
import { readFile } from 'node:fs/promises';
import {parseJsonRejectDuplicateKeys,isCoreFailure} from '@foreman/core';
import {validateStandardStartTrace,type StartupTraceMeasurementV1} from './pel-simplification-trace.js';
import { Effect } from 'effect';
import { sanitizedGitEnv } from '@foreman/policy';
import { ProcessExec, liveProcessExec } from './queue-services.js';
import { FOREDI_BASELINE_COMMIT, measureSimplification, productionClass, validateSimplificationBaseline, type MetricFile, type SimplificationResultV1 } from './pel-simplification.js';
export interface MetricCollectionFailure {
    readonly _tag: 'MetricCollectionFailure';
    readonly code: 'MetricInputInvalid' | 'MetricCollectionFailed';
    readonly message: string;
    readonly exitCode: 1 | 2;
}
const fail = (message: string, invalid = false): MetricCollectionFailure => ({ _tag: 'MetricCollectionFailure', code: invalid ? 'MetricInputInvalid' : 'MetricCollectionFailed', message, exitCode: invalid ? 2 : 1 });
const validRevision = (revision: string) => /^[a-f0-9]{40}$/u.test(revision);
function git(root: string, args: readonly string[], bound: number) {
    return Effect.gen(function* () {
        const port = yield* ProcessExec;
        const result = yield* port.runCaptured({ command: 'git', args: ['--no-pager', ...args], cwd: root, env: { ...sanitizedGitEnv(), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, maxOutputBytes: bound, timeoutMs: 30000 }).pipe(Effect.mapError(() => fail('The bounded Git collection failed.')));
        if (result.exitCode !== 0)
            return yield* Effect.fail(fail('The Git revision or source is unavailable.', true));
        return result.stdoutBytes ?? Buffer.from(result.stdout);
    }).pipe(Effect.provide(liveProcessExec));
}
export function readMetricChangedPaths(root: string, baseline: string, candidate: string) {
    return Effect.gen(function* () {
        if (!validRevision(baseline) || !validRevision(candidate))
            return yield* Effect.fail(fail('Select exact Git commit hashes.', true));
        const bytes = yield* git(root, ['diff', '--no-renames', '--name-only', '-z', baseline, candidate, '--'], 16 * 1024 * 1024);
        return yield* Effect.try({ try: () => new Set(new TextDecoder('utf-8', { fatal: true }).decode(bytes).split('\0').filter(Boolean)), catch: () => fail('Git returned an invalid path.', true) });
    });
}
export function readMetricRevision(root: string, revision: string): Effect.Effect<readonly MetricFile[], MetricCollectionFailure> {
    return Effect.gen(function* () {
        if (!validRevision(revision))
            return yield* Effect.fail(fail('Select an exact Git commit hash.', true));
        yield* git(root, ['cat-file', '-e', `${revision}^{commit}`], 1024);
        const tree = yield* git(root, ['ls-tree', '-r', '-l', '-z', revision], 16 * 1024 * 1024);
        const records = yield* Effect.try({ try: () => {
                const rows = new TextDecoder('utf-8', { fatal: true }).decode(tree).split('\0').filter(Boolean).map(row => { const at = row.indexOf('\t'); if (at < 0)
                    throw Error('path'); const meta = row.slice(0, at).trim().split(/\s+/u), path = row.slice(at + 1); if (!path || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..'))
                    throw Error('path'); return { mode: meta[0], type: meta[1], oid: meta[2], size: Number(meta[3]), path }; }).filter(row => row.type === 'blob' && (productionClass(row.path) !== 'other' || /\.(md|json)$/u.test(row.path)));
                if (rows.length > 100000 || rows.some(row => !Number.isSafeInteger(row.size) || row.size < 0 || row.size > 64 * 1024 * 1024 || !row.oid || !/^[a-f0-9]{40}$/u.test(row.oid)) || rows.reduce((n, r) => n + r.size, 0) > 512 * 1024 * 1024)
                    throw Error('bound');
                if (rows.some(row => row.mode === '120000' && productionClass(row.path) === 'production'))
                    throw Error('source link');
                return rows;
            }, catch: () => fail('The revision contains unsupported paths, source links, or exceeds its byte bound.', true) });
        return yield* Effect.forEach(records, row => Effect.gen(function* () { const bytes = yield* git(root, ['cat-file', 'blob', row.oid!], Math.max(1024, row.size + 1)); if (bytes.length !== row.size)
            return yield* Effect.fail(fail('Git source bytes differ from their declared length.')); return { path: row.path, bytes }; }), { concurrency: 4 });
    });
}
/** Known files are a partial corpus, not a proxy for instructions rendered during startup.
 * A Git tree does not record the selected account/readiness responses, runtime
 * prompt substitutions, or which help/generation paths the operator reached.
 */
export function collectKnownInstructionMembership(baselineInstructionPaths:readonly string[],files:readonly MetricFile[]) {
    const paths=new Set(files.map(file=>file.path));
    const mandatoryInstructionFiles=[...new Set([...baselineInstructionPaths.filter(path=>paths.has(path)),'docs/guides/pel/quickstart.md'])];
    const optionalInstructionFiles=[...paths].filter(path=>
        path.startsWith('docs/guides/pel/')&&path.endsWith('.md')&&path!=='docs/guides/pel/quickstart.md'||
        /^examples\/pel\/profiles\/[^/]+\.pel$/u.test(path),
    ).filter(path=>!mandatoryInstructionFiles.includes(path)).sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
    return {
        mandatoryInstructionFiles,
        optionalInstructionFiles,
        instructionCorpusComplete:false as const,
        countingNote:'Incomplete instruction measurement: only surviving fixed baseline instruction files and the complete quickstart are known mandatory bytes. No source-bound startup trace establishes all mandatory rendered help, profile output and provider prompts through the first standard workflow start. Implementation TypeScript and optional profile examples are not mandatory-text proxies. Known bytes use the pinned tokenizer; the exact required-token total and instruction-reduction ratio remain unavailable.',
    };
}
export function collectSimplification(input: {
    readonly repositoryRoot: string;
    readonly baselinePath: string;
    readonly candidateCommit: string;
    readonly startupTracePath?: string;
}): Effect.Effect<SimplificationResultV1, MetricCollectionFailure> {
    return Effect.gen(function* () {
        const baselineText = yield* Effect.tryPromise({ try: async () => { const bytes = await readFile(input.baselinePath); if (bytes.length > 1024 * 1024)
                throw Error('bound'); return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }, catch: () => fail('The fixed baseline cannot be read.', true) });
        const decodedBaseline=validateSimplificationBaseline(baselineText);
        if(!decodedBaseline.ok)return yield* Effect.fail(fail(decodedBaseline.error.message,true));
        const baselineFiles = yield* readMetricRevision(input.repositoryRoot, FOREDI_BASELINE_COMMIT), candidateFiles = yield* readMetricRevision(input.repositoryRoot, input.candidateCommit), changedPaths = yield* readMetricChangedPaths(input.repositoryRoot, FOREDI_BASELINE_COMMIT, input.candidateCommit);
        const membership=collectKnownInstructionMembership(decodedBaseline.value.instructions.map(file=>file.path),candidateFiles);
        let startupTrace:StartupTraceMeasurementV1|undefined;
        if(input.startupTracePath){const raw=yield* Effect.tryPromise({try:async()=>{const bytes=await readFile(input.startupTracePath!);if(bytes.byteLength>12*1024*1024)throw Error('bound');return parseJsonRejectDuplicateKeys(new TextDecoder('utf-8',{fatal:true}).decode(bytes));},catch:()=>fail('The bounded startup trace cannot be read.',true)});if(isCoreFailure(raw))return yield* Effect.fail(fail('The startup trace contains invalid or duplicate JSON keys.',true));const checked=validateStandardStartTrace(raw,input.candidateCommit,candidateFiles);if(!checked.ok)return yield* Effect.fail(fail(checked.error,true));startupTrace=checked.value;}
        const measured = measureSimplification({ baselineText, baselineFiles, candidateCommit: input.candidateCommit, candidateFiles, changedPaths, mandatoryInstructionFiles:membership.mandatoryInstructionFiles, optionalInstructionFiles:membership.optionalInstructionFiles,instructionCorpusComplete:startupTrace!==undefined,...(startupTrace?{startupTrace}:{}) });
        if (!measured.ok)
            return yield* Effect.fail(fail(measured.error.message, true));
        return {...measured.value,instructions:{...measured.value.instructions,countingNote:startupTrace?`Complete for the fixed standard-start trace (${startupTrace.evidenceKind}); this does not establish live-account readiness or cover other workflows. Full surviving baseline files and quickstart plus exact rendered command and transmitted provider instruction bytes are counted. Unknown control-flow and ownership counts remain null.`:membership.countingNote}};
    });
}
