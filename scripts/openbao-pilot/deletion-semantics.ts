import { randomBytes } from "node:crypto";
import { Effect, Redacted } from "effect";
import type { CredentialStoreService } from "../../packages/providers/src/credential-store.js";

/** Disposable synthetic experiment, not a production recovery operation. */
export function deletionSemantics(store: CredentialStoreService, registerCanary: (value: string) => void = () => {}) {
  return Effect.gen(function* () {
    const reference = "bao:claude:deletion-experiment";
    const deadline = () => Date.now() + 5000;
    const old = Redacted.make({ accessToken: `foreman-synthetic-old-${randomBytes(12).toString("hex")}` });
    registerCanary(Redacted.value(old).accessToken);
    const generation = yield* store.write(reference, old, 0, deadline());
    yield* store.remove(reference, [generation], deadline());
    const code = <A>(task: Effect.Effect<A, { readonly code: string }>) => Effect.either(task).pipe(Effect.map(result => result._tag === "Left" ? result.left.code : "unexpected-success"));
    if ((yield* code(store.read(reference, deadline()))) !== "NotFound") return yield* Effect.fail("deleted-read");
    if (!(yield* store.list("claude", deadline())).includes("deletion-experiment")) return yield* Effect.fail("deleted-list");
    const fresh = Redacted.make({ accessToken: `foreman-synthetic-new-${randomBytes(12).toString("hex")}` });
    registerCanary(Redacted.value(fresh).accessToken);
    if ((yield* code(store.write(reference, fresh, 0, deadline()))) !== "Conflict") return yield* Effect.fail("deleted-cas0");
    const recoveredGeneration = yield* store.write(reference, fresh, generation, deadline());
    const recovered = yield* store.read(reference, deadline());
    if (recoveredGeneration !== generation + 1 || recovered.version !== recoveredGeneration || JSON.stringify(Redacted.value(recovered.material)) !== JSON.stringify(Redacted.value(fresh))) return yield* Effect.fail("deleted-recovery");
    return ["deleted-read-not-found", "deleted-name-retained", "deleted-cas0-conflict", "recorded-generation-conditional-recovery-with-new-material"];
  });
}
