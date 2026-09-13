/** Fixed, full-file release measurements. These counts do not establish runtime safety. */
import { createHash } from 'node:crypto';
import { parseJsonRejectDuplicateKeys, isCoreFailure } from '@foreman/core';
import { getEncoding } from 'js-tiktoken';
import {unknownStartupOperations,type StartupTraceMeasurementV1,type StartupOperationalMetricsV1} from './pel-simplification-trace.js';
export const FOREDI_BASELINE_COMMIT = '441c3fb9f6acb2656760d03cc79e7c706fb8b7dd';
const MANIFEST_DIGEST = 'b5e82b8d6096436681495998e59b94bc78a3b9a8dc22f6d4b18ff69c1177e738';
export const BASELINE_PRODUCTION = [
    'skills/foreman/scripts/vendor-multiround.sh', 'skills/foreman/scripts/lib/worker-cmd.sh',
    ...['grok', 'codex', 'claude', 'agy'].map(v => `skills/foreman/scripts/adapters/${v}.sh`),
    ...['lane-run', 'worker-run', 'audit-run', 'resume', 'watch', 'lane-supervise'].map(v => `skills/foreman/scripts/${v}.sh`),
    ...['round-reducer', 'resume-queue-execution', 'supervisor'].map(v => `packages/orchestration/src/${v}.ts`),
] as const;
export interface MetricFile {
    readonly path: string;
    readonly bytes: Uint8Array;
}
interface BaselineFile {
    readonly path: string;
    readonly sha256: string;
    readonly utf8Bytes: number;
    readonly nonblankLines?: number;
}
export interface SimplificationBaselineV1 {
    readonly schemaVersion: 1;
    readonly baselineCommit: string;
    readonly production: readonly BaselineFile[];
    readonly instructions: readonly BaselineFile[];
    readonly instructionCorpusSha256: string;
    readonly totals: {
        readonly productionNonblankLines: number;
        readonly requiredInstructionTokens: number;
    };
    readonly tokenizer: {
        readonly package: string;
        readonly version: string;
        readonly encoding: string;
        readonly integrity: string;
    };
    readonly targets: {
        readonly glueReduction: number;
        readonly instructionReduction: number;
    };
}
export interface MetricFailure {
    readonly code: 'InvalidSimplificationInput';
    readonly message: string;
}
type Result<T> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: MetricFailure;
};
const bad = (message: string): Result<never> => ({ ok: false, error: { code: 'InvalidSimplificationInput', message } });
const hash = (input: Uint8Array | string) => createHash('sha256').update(input).digest('hex');
const compare = (a: string, b: string) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
export const nonblankLines = (source: string) => source.split(/\r?\n/u).filter(line => line.trim().length > 0).length;
export function validateSimplificationBaseline(source: string): Result<SimplificationBaselineV1> {
    try {
        const value = parseJsonRejectDuplicateKeys(source);
        if (isCoreFailure(value))
            return bad('The fixed baseline must contain unique JSON keys.');
        if (hash(JSON.stringify(value)) !== MANIFEST_DIGEST)
            return bad('The fixed baseline, cohort, rule, tokenizer, or target changed.');
        return { ok: true, value: value as SimplificationBaselineV1 };
    }
    catch {
        return bad('The fixed baseline is malformed.');
    }
}
export type ProductionClass = 'production' | 'test' | 'generated' | 'archive' | 'other';
export function productionClass(path: string): ProductionClass {
    if (path.startsWith('docs/research/pel-release/sources/'))
        return 'archive';
    if ((/^packages\/[^/]+\/dist(?:-test)?\//u.test(path) ||
        /^skills\/foreman\/runtime\/dist\//u.test(path) ||
        /^components\/council\/(?:packages\/[^/]+\/dist|runtime\/dist)\//u.test(path)) &&
        /(?:\.(?:js|mjs|cjs|map)|\.d\.ts)$/u.test(path))
        return 'generated';
    if (/(^|\/)(test|tests|fixtures)(\/|$)|\.test\.tsx?$/u.test(path))
        return 'test';
    return /\.(ts|tsx|pel|sh|py|ps1)$/u.test(path) ? 'production' : 'other';
}
export function selectCandidateProduction(paths: readonly string[], changed: ReadonlySet<string>): string[] {
    return [...new Set(paths)].filter(path => productionClass(path) === 'production' && (BASELINE_PRODUCTION.includes(path as typeof BASELINE_PRODUCTION[number]) || /^packages\/(pel|providers)\//u.test(path) || changed.has(path))).sort(compare);
}
export interface MeasuredFile {
    readonly path: string;
    readonly sha256: string;
    readonly utf8Bytes: number;
    readonly nonblankLines: number;
}
export interface SimplificationInput {
    readonly baselineText: string;
    readonly baselineFiles: readonly MetricFile[];
    readonly candidateCommit: string;
    readonly candidateFiles: readonly MetricFile[];
    readonly changedPaths: ReadonlySet<string>;
    readonly mandatoryInstructionFiles: readonly string[];
    readonly optionalInstructionFiles: readonly string[];
    /** False when the actual mandatory startup trace is not fully bound. */
    readonly instructionCorpusComplete?: boolean;
    readonly startupTrace?: StartupTraceMeasurementV1;
}
export interface SimplificationResultV1 {
    readonly schemaVersion: 1;
    readonly baselineCommit: string;
    readonly candidateCommit: string;
    readonly baseline: SimplificationBaselineV1['totals'];
    readonly candidate: {
        readonly productionNonblankLines: number;
        readonly requiredInstructionTokens: number | null;
    };
    readonly production: {
        readonly files: readonly MeasuredFile[];
        readonly deletedBaselinePaths: readonly string[];
        readonly repository: {
            readonly baseline: number;
            readonly candidate: number;
            readonly growth: number;
        };
        readonly packages: Readonly<Record<string, {
            readonly baseline: number;
            readonly candidate: number;
            readonly growth: number;
        }>>;
        readonly exclusions: Readonly<Record<string, {
            readonly files: number;
            readonly bytes: number;
            readonly nonblankLines: number;
        }>>;
    };
    readonly instructions: {
        readonly complete: boolean;
        readonly knownRequiredTokens: number;
        readonly requiredFiles: readonly MeasuredFile[];
        readonly optionalFiles: readonly MeasuredFile[];
        readonly optionalTokens: number;
        readonly mandatoryCorpusSha256: string;
        readonly countingNote: string;
    };
    readonly ratios: {
        readonly glueReduction: number;
        readonly instructionReduction: number | null;
    };
    readonly acceptance: {
        readonly glue: boolean;
        readonly instructions: boolean;
    };
    readonly startupTrace: Omit<StartupTraceMeasurementV1,'renderedInstructions'|'operational'> | null;
    readonly operational: StartupOperationalMetricsV1;
    readonly exitCode: 0 | 1;
}
export function measureSimplification(input: SimplificationInput): Result<SimplificationResultV1> {
    const decoded = validateSimplificationBaseline(input.baselineText);
    if (!decoded.ok)
        return decoded;
    try {
        const baseline = decoded.value;
        if (!/^[a-f0-9]{40}$/u.test(input.candidateCommit))
            return bad('The candidate must be an exact Git commit.');
        const index = (files: readonly MetricFile[]) => {
            const map = new Map<string, MetricFile>();
            for (const file of files) {
                if (!file.path || file.path.startsWith('/') || file.path.split('/').some(p => !p || p === '.' || p === '..') || map.has(file.path))
                    throw Error('Unsafe or duplicate file path.');
                map.set(file.path, file);
            }
            return map;
        };
        const old = index(input.baselineFiles), current = index(input.candidateFiles);
        const row = (file: MetricFile): MeasuredFile => ({ path: file.path, sha256: hash(file.bytes), utf8Bytes: file.bytes.length, nonblankLines: nonblankLines(text(file.bytes)) });
        for (const original of [...baseline.production, ...baseline.instructions]) {
            const file = old.get(original.path);
            if (!file || hash(file.bytes) !== original.sha256 || file.bytes.length !== original.utf8Bytes || (original.nonblankLines !== undefined && row(file).nonblankLines !== original.nonblankLines))
                return bad(`Original source differs from the frozen baseline: ${original.path}`);
        }
        const joinCorpus = (paths: readonly string[], map: ReadonlyMap<string, MetricFile>) => paths.map(path => {
            const file = map.get(path);
            if (!file)
                throw Error(`Missing instruction source: ${path}`);
            return text(file.bytes);
        }).join('\n');
        const encoding = getEncoding('cl100k_base');
        const countTokens = (source: string) => encoding.encode(source, [], []).length;
        const originalInstructions = joinCorpus(baseline.instructions.map(f => f.path), old);
        if (hash(originalInstructions) !== baseline.instructionCorpusSha256 || countTokens(originalInstructions) !== baseline.totals.requiredInstructionTokens)
            return bad('The original tokenizer or instruction bytes differ.');
        const production = selectCandidateProduction([...current.keys()], input.changedPaths).map(path => row(current.get(path)!));
        const requiredPaths = [...new Set([...baseline.instructions.map(f => f.path).filter(p => current.has(p)), 'docs/guides/pel/quickstart.md', ...input.mandatoryInstructionFiles])];
        const optionalPaths = [...new Set(input.optionalInstructionFiles)].filter(p => !requiredPaths.includes(p)).sort(compare);
        const instructionIndex=new Map(current);for(const file of input.startupTrace?.renderedInstructions??[]){if(instructionIndex.has(file.path)||!file.path.startsWith('startup-trace/')||!file.path.endsWith('.txt'))return bad('Startup instruction source collides with a candidate source.');instructionIndex.set(file.path,file);requiredPaths.push(file.path);}
        const required = joinCorpus(requiredPaths, instructionIndex), optional = joinCorpus(optionalPaths, current);
        const requiredTokens = countTokens(required), productionLines = production.reduce((sum, f) => sum + f.nonblankLines, 0);
        const totals = (files: readonly MetricFile[], prefix = '') => files.filter(f => f.path.startsWith(prefix) && productionClass(f.path) === 'production').reduce((n, f) => n + row(f).nonblankLines, 0);
        const repository = { baseline: totals(input.baselineFiles), candidate: totals(input.candidateFiles), growth: totals(input.candidateFiles) - totals(input.baselineFiles) };
        const packages: Record<string, {
            baseline: number;
            candidate: number;
            growth: number;
        }> = {};
        for (const key of [...new Set([...old.keys(), ...current.keys()].filter(p => p.startsWith('packages/')).map(p => p.split('/')[1]!))].sort(compare)) {
            const prefix = `packages/${key}/`, a = totals(input.baselineFiles, prefix), b = totals(input.candidateFiles, prefix);
            packages[key] = { baseline: a, candidate: b, growth: b - a };
        }
        const exclusions: Record<string, {
            files: number;
            bytes: number;
            nonblankLines: number;
        }> = {};
        for (const f of input.candidateFiles) {
            const kind = productionClass(f.path);
            if (!['test', 'generated', 'archive'].includes(kind))
                continue;
            const prior = exclusions[kind] ?? { files: 0, bytes: 0, nonblankLines: 0 };
            let lines = 0;
            try {
                lines = nonblankLines(text(f.bytes));
            }
            catch { /* Binary archives have byte counts only. */ }
            exclusions[kind] = { files: prior.files + 1, bytes: prior.bytes + f.bytes.length, nonblankLines: prior.nonblankLines + lines };
        }
        const complete = input.instructionCorpusComplete !== false;
        const ratios = { glueReduction: 1 - productionLines / baseline.totals.productionNonblankLines, instructionReduction: complete ? 1 - requiredTokens / baseline.totals.requiredInstructionTokens : null };
        const acceptance = { glue: ratios.glueReduction >= baseline.targets.glueReduction, instructions: ratios.instructionReduction !== null && ratios.instructionReduction >= baseline.targets.instructionReduction };
        return { ok: true, value: { schemaVersion: 1, baselineCommit: baseline.baselineCommit, candidateCommit: input.candidateCommit, baseline: baseline.totals, candidate: { productionNonblankLines: productionLines, requiredInstructionTokens: complete ? requiredTokens : null }, production: { files: production, deletedBaselinePaths: baseline.production.map(f => f.path).filter(p => !current.has(p)), repository, packages, exclusions }, instructions: { complete, knownRequiredTokens: requiredTokens, requiredFiles: requiredPaths.map(p => row(instructionIndex.get(p)!)), optionalFiles: optionalPaths.map(p => row(current.get(p)!)), optionalTokens: countTokens(optional), mandatoryCorpusSha256: hash(required), countingNote: complete ? 'Complete required instruction sources joined by one LF; UTF-8 bytes preserved; js-tiktoken 1.0.21/cl100k_base without special tokens.' : 'The known required files are counted, but no complete mandatory startup trace is bound. Instruction totals and reduction remain unknown. Complete TypeScript implementation files are not a rendered instruction corpus.' }, ratios, acceptance, startupTrace:input.startupTrace?{evidenceKind:input.startupTrace.evidenceKind,sha256:input.startupTrace.sha256,sourceDigest:input.startupTrace.sourceDigest,boundary:input.startupTrace.boundary}:null, operational:input.startupTrace?.operational??unknownStartupOperations, exitCode: acceptance.glue && acceptance.instructions ? 0 : 1 } };
    }
    catch (error) {
        return bad(error instanceof Error ? error.message : 'The measurement inputs are invalid.');
    }
}
