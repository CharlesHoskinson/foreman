import { realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Effect, STM, TRef } from 'effect';
import type { HostContextV1, PelHostEffectFailureV1, PelResourcePort, ResourceSetV1 } from './pel-run-contract.js';

const denied = (): PelHostEffectFailureV1 => ({ code: 'resource-denied', message: 'Resource is outside the admitted canonical workspace or its identity changed.' });
const contains = (root: string, path: string): boolean => path === root || path.startsWith(root + sep);
/** Resolve the nearest existing ancestor so creation paths receive the same alias checks as existing files. */
async function canonical(path: string): Promise<string> {
  try { return await realpath(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonical(parent), relative(parent, path));
  }
}
export function canonicalWorkspacePath(path: string, context: HostContextV1) {
  return Effect.tryPromise({ try: async () => {
    if (path.includes('\0') || path.split(/[\\/]/u).includes('..')) throw denied();
    const root = context.workspace.canonicalRoot;
    const info = await stat(root);
    if (await realpath(root) !== root || `${info.dev}:${info.ino}` !== context.workspace.directoryIdentity) throw denied();
    const result = await canonical(isAbsolute(path) ? path : resolve(root, path));
    if (!contains(root, result)) throw denied();
    return result;
  }, catch: denied });
}
function overlaps(a: string, b: string): boolean {
  return a === b || isAbsolute(a) && isAbsolute(b) && (contains(a, b) || contains(b, a));
}
function conflicts(a: ResourceSetV1, b: ResourceSetV1): boolean {
  const ar = a.reads, aw = [...a.writes, ...(a.unknownScope ? [a.unknownScope] : [])];
  const br = b.reads, bw = [...b.writes, ...(b.unknownScope ? [b.unknownScope] : [])];
  return aw.some(x => [...br, ...bw].some(y => overlaps(x, y))) || bw.some(x => ar.some(y => overlaps(x, y)));
}
/** One run-owned resource service. STM atomically acquires whole sets; scoped finalizers release them. */
export function makePelResourceScope(): Effect.Effect<PelResourcePort> {
  return Effect.gen(function* () {
    const held = yield* TRef.make<readonly { id: object; resources: ResourceSetV1 }[]>([]).pipe(STM.commit);
    const permits = new Map<number, Effect.Semaphore>();
    const resolveResource = (name: string, context: HostContextV1) => {
      if (name === 'workspace:default') return canonicalWorkspacePath('.', context);
      if (name.startsWith('source:')) return canonicalWorkspacePath(name.slice(7), context);
      if (name.startsWith('workspace:')) {
        const suffix = name.slice(10);
        if (suffix === context.workspace.grantId || suffix === context.workspace.worktreeId) return canonicalWorkspacePath('.', context);
        return Effect.fail(denied());
      }
      if (isAbsolute(name) || name.startsWith('./')) return canonicalWorkspacePath(name, context);
      if (name.startsWith('artifact:') || name === 'host:output') return Effect.succeed(name);
      return Effect.fail(denied());
    };
    const acquire: PelResourcePort['acquire'] = (resources, context) => Effect.gen(function* () {
      const validate = Effect.gen(function* () {
        for (const name of [...resources.reads, ...resources.writes, ...(resources.unknownScope ? [resources.unknownScope] : [])]) {
          if (!isAbsolute(name)) { if (!name.startsWith('artifact:') && name !== 'host:output') return yield* Effect.fail(denied()); continue; }
          if (yield* canonicalWorkspacePath(name, context).pipe(Effect.map(c => c !== name))) return yield* Effect.fail(denied());
        }
        for (const name of resources.writes.filter(isAbsolute)) {
          const allowed = yield* Effect.forEach(context.workspace.writablePaths, p => canonicalWorkspacePath(p, context));
          if (!allowed.some(p => contains(p, name))) return yield* Effect.fail(denied());
        }
        if (resources.unknownScope && resources.unknownScope !== context.workspace.canonicalRoot) return yield* Effect.fail(denied());
      });
      yield* validate;
      const id = {};
      yield* Effect.acquireRelease(STM.gen(function* () {
        const active = yield* TRef.get(held);
        if (active.some(entry => conflicts(entry.resources, resources))) return yield* STM.retry;
        yield* TRef.set(held, [...active, { id, resources }]);
      }).pipe(STM.commit), () => TRef.update(held, entries => entries.filter(e => e.id !== id)).pipe(STM.commit));
      yield* validate;
    });
    return {
      resolve: (descriptor, request, context) => Effect.gen(function* () {
        const reads = new Set(descriptor.resources.reads);
        for (const field of ['input', 'bundle']) {
          const value = request.boundArguments[field];
          if (value?.tag === 'string' && /^(artifact:|source:|workspace:)/u.test(value.value)) reads.add(value.value);
        }
        const resolvedReads = yield* Effect.forEach([...reads], name => resolveResource(name, context));
        const writes = yield* Effect.forEach(descriptor.resources.writes, name => resolveResource(name, context));
        return { reads: [...new Set(resolvedReads)].sort(), writes: [...new Set(writes)].sort(), ...(descriptor.resources.unknown ? { unknownScope: context.workspace.canonicalRoot } : {}) };
      }),
      acquire,
      acquireConcurrency: context => Effect.gen(function* () {
        const limit = context.binding.limits.maxConcurrentEffects;
        if (!Number.isSafeInteger(limit) || limit < 1) return yield* Effect.fail(denied());
        let semaphore = permits.get(limit);
        if (!semaphore) { semaphore = yield* Effect.makeSemaphore(limit); permits.set(limit, semaphore); }
        const sem = semaphore;
        yield* Effect.acquireRelease(sem.take(1), () => sem.release(1));
      }),
      allocateContenders: (context, count) => Effect.gen(function* () {
        if (!Number.isSafeInteger(count) || count < 1 || count > context.project.workspaces.maxRaceContenders || count > context.project.workspaces.maxWorktrees) return yield* Effect.fail(denied());
        const grants = context.project.workspaces.grants.filter(g => g.immutableBase === context.workspace.immutableBase && g.repository.identitySha256 === context.workspace.repository.identitySha256).slice(0, count);
        if (grants.length !== count || new Set(grants.map(g => g.canonicalRoot)).size !== count || new Set(grants.map(g => g.directoryIdentity)).size !== count) return yield* Effect.fail(denied());
        for (const grant of grants) yield* canonicalWorkspacePath('.', { ...context, workspace: grant });
        return grants;
      }),
    } satisfies PelResourcePort;
  });
}
export const acquireEffectResources = (port: PelResourcePort, resources: ResourceSetV1, owner: HostContextV1) => port.acquire(resources, owner);
