# Empirical Assessment

## Scope and Method

This inventory counts **distinct, evidenced failure mechanisms**, not log entries. Recurrences (for example, 13 background-and-stop events) count once; later audits that rediscover the same mechanism are folded into the original row. A compound incident is split only when the evidence identifies independent causes, either of which could fail alone.

Included: reproduced production/test-harness defects, audit findings with a concrete bad-input control, and observed environment/process failures in the named sources. Excluded: pure latency/cost complaints, successful safety interventions, explicitly deferred work, cosmetic findings, and hypotheses the source labels unconfirmed.

Primary evidence was the incident record, bug/event log, `AGENT_TRAPS.md`, and the top-level `/root/fm-wt/*/AUDIT-*.md` reports. The repeated `docs/research/vnext/AUDIT-*.md` copies under each worktree were hash-identical carry-along documents rather than new observations, so they were not counted again. The skeptical lane was used only to identify claims to verify.

## Verified Unison Mechanisms

Verified from the supplied Unison documents:

- **Abilities and handlers:** effects are explicit in function signatures and their implementation can be separated behind handlers. This improves auditability and testability, but the documentation does not claim that a handler makes an external shell, filesystem, process, or Git action transactional or correct.
- **Algebraic data types and pattern matching:** unique/structural sum types can represent workflow states directly. This can make illegal state combinations harder to express, although a programmer can still choose an incomplete or semantically wrong model.
- **STM (`TVar`, `STM.atomically`):** Unison's base library provides atomic in-process transactional memory; the supplied example says an atomic block prevents access to the transactional state until the block completes. This is relevant only if the shared coordination state is actually moved into that runtime.
- **Unison Cloud storage:** the supplied Cloud page advertises transactional storage with statically typed access. It could provide an atomic shared-state backend if adopting Unison Cloud is in scope; it is not demonstrated as a property of local Unison programs or arbitrary filesystem operations.
- **Content-addressed deployments:** Unison Cloud service deployments are immutable and receive a code-derived hash. That protects deployment identity/rollback, not the provenance or authenticity of arbitrary evidence files emitted by tools.

No Bucket A credit will be based merely on “written in Unison.” Credit requires redesigning the affected state/effect through one of the verified mechanisms above.

## Strongest Pro-Unison Case

The strongest case is **not** “Unison makes orchestration correct.” It is that a redesign could replace several ambient, stringly conventions with explicit state and controlled effects:

1. Lane phases, verdicts, refusal causes, evidence classes, and ownership could be algebraic data types rather than combinations of shell variables and strings. That would prevent misspellings and make state transitions easier to review and test. It would likely have made the mixed-verdict omission more visible, although it would not force the correct semantic result.
2. Abilities put effect requirements in function types and permit alternate handlers. A pure decision core with filesystem/process/Git/vendor abilities could be tested against deterministic handlers. This would reduce mock drift and make “which parts touch the world?” explicit.
3. Base STM can make related in-process state updates atomic. Unison Cloud's typed transactional storage can do the same for shared durable state. If the mutex, owner record, append, and compaction state are genuinely moved into such a store, the three Bucket A races disappear at the storage boundary.
4. Immutable, content-addressed Cloud deployments improve code-version identity and rollback. That could strengthen deployment provenance, but it does not authenticate a vendor log, Git status snapshot, audit file, or caller-supplied inventory row.

The local compiler-source snapshot supports an important part of the skeptic's integration warning: `Builtin2.hs` exposes `IO.process.call/start/kill/wait/exitCode`, process-global current-directory operations, and `getEnv`, while the supplied snapshot contains no signal or `setEnv` builtin. That is evidence about this compiler snapshot, not proof that no library/FFI workaround can exist. Either way, a port still needs substantial platform adapters.

The skeptic's **0/20** is fair for its deliberately narrow subset (12 checker failures plus eight documented strandings). It is not the project-wide answer because it omits the reproduced lock, trust, trap, inventory, and compaction findings explicitly required here.

## Defect Classification

Buckets are mutually exclusive. A row receives A only where prevention follows from a verified Unison mechanism and requires more than merely rewriting the same shell/git predicate in Unison.

| Defect | Bucket | One-line justification | Unison mechanism (Bucket A only) |
|---|---|---|---|
| Quint checker matched `violation` inside `[ok] No violation found` | **B — Logic/specification** | The substring predicate was semantically wrong; typed `Text` and effect tracking do not know the vendor output grammar. | — |
| Non-termination invariant passed vacuously because its counter never advanced | **B — Logic/specification** | The proposition was true for the wrong reason; types cannot infer the intended progress premise. | — |
| Lane exited zero and said the report was ready although no report existed | **D — Process/orchestration** | The agent consumed its turn before the final write; binding success to a fresh artifact fixes the protocol, not the language. | — |
| `git status --porcelain` digest declared an empty burst after valid files were written | **B — Logic/specification** | The checker chose a path-level Git view that collapses untracked directories and ignores later content edits; `-uall` plus content hashing is language-agnostic. | — |
| “Verified 5/5” claim pointed to an on-disk pre-fix four-check artifact | **B — Logic/specification** | Freshness/provenance was absent from the success predicate; content addressing could help only if the evidence contract used it, which a port does not force. | — |
| Directed graph gate used `DiGraph` and silently discarded a parallel edge | **B — Logic/specification** | The selected library abstraction lacked multiedges; a wrapper type could help, but the orchestrator port does not change that Python dependency or the wrong choice. | — |
| Contention regex matched `config/foreman.toml` as a prefix of `.toml.example` | **B — Logic/specification** | The missing boundary was a wrong text predicate, valid in any type system. | — |
| Existence guard labelled 37 generated deliverables as forbidden regex artifacts | **B — Logic/specification** | The author tested existence when the intended property was suffix-extensibility; the program faithfully applied the wrong criterion. | — |
| Three criteria passed with a zero denominator by never instrumenting | **B — Logic/specification** | The specification omitted a nonzero/coverage premise; ordinary `Nat` typing permits zero. | — |
| Fifteen-minute rebuild bound was about 176 times the measured runtime | **B — Logic/specification** | The threshold was well-typed but uselessly loose; only calibration against evidence detects that. | — |
| `flock` syscall evidence was specified as a create returning `EEXIST` | **B — Logic/specification** | The requirement described the wrong OS primitive; stronger typing would encode the mistake rather than correct it. | — |
| Audit transport connection died mid-response and analysis held only in context was lost | **D — Process/orchestration** | Incremental persistence/checkpointing at finding boundaries addresses agent/transport failure; the implementation language cannot preserve unwritten model context. | — |
| Agent backgrounded its round and ended its turn, leaving work unowned | **D — Process/orchestration** | This recurrent, prompt-immune behavior is a mismatch in agent notification/ownership semantics, independent of the harness language. | — |
| Audit wrapper spent 21 minutes in preflight and never launched the vendor | **D — Process/orchestration** | The defect is an unobserved missing protocol transition; process-presence monitoring or direct dispatch fixes it. | — |
| Redundant watchdogs outlived their subject without ownership tags or registry entries | **D — Process/orchestration** | Attribution and lifecycle ownership were omitted from the lane protocol; types do not assign real OS processes to agents automatically. | — |
| Grok single-turn round spent its burst reading/planning and exited zero without edits | **D — Process/orchestration** | A bounded agent turn exhausted its research budget before the deliverable transition; first-write ordering and artifact assertions are protocol fixes. | — |
| Agent inferred a substitute task from a missing path and overwrote an unrelated audit | **D — Process/orchestration** | The agent violated the authority boundary instead of stopping; a missing-input guard helps, but no language prevents an authorized agent from choosing the wrong file. | — |
| Finisher resumed with its shell cwd pointing at another lane's worktree | **D — Process/orchestration** | The agent/session protocol lost lane-local execution context between turns; absolute paths and per-command cwd assertions address it. | — |
| Vendor self-update attempted terminal interaction in a headless job and was stopped by `SIGTTIN` | **C — Environment/integration** | This is vendor CLI and POSIX job-control behavior; Unison would still encounter it when launching the same CLI. | — |
| `pgrep` watchdog treated a stopped process as live | **C — Environment/integration** | The chosen OS probe reports existence, not process state; any language using it sees the same result. | — |
| Grok denied an unlisted tool verb by cancelling the whole turn | **C — Environment/integration** | `PermissionCancelled` is vendor adapter behavior; the fix is the correct allow/approval contract and log diagnosis. | — |
| CRLF-materialized shell scripts were unrunnable under WSL Bash | **C — Environment/integration** | Git checkout conversion and WSL Bash parsing caused the failure; a Unison orchestrator still shells out to those scripts/tools unless they are all eliminated. | — |
| PowerShell readiness check searched Windows PATH for a tool used inside Git Bash | **C — Environment/integration** | The checker crossed two PATH/runtime domains incorrectly; the seam persists in any host language. | — |
| `install.ps1` used `cmd /c mklink` syntax that PowerShell parsed incorrectly | **C — Environment/integration** | This is PowerShell/native-command tokenization at the Windows install seam. | — |
| BOM-less UTF-8 PowerShell scripts with em dashes failed under Windows PowerShell 5.1 | **C — Environment/integration** | Legacy host decoding, not a harness type error, corrupted otherwise valid source. | — |
| Git Bash rewrote a leading WSL path argument before `wsl.exe` received it | **C — Environment/integration** | MSYS argv path conversion is an integration seam; embedding the command after `bash -lc` or disabling conversion is the direct fix. | — |
| Outer shell expanded backticks/apostrophes in inline heredocs before WSL parsed them | **C — Environment/integration** | Nested shell quoting changed the payload; passing a real file avoids the seam in any implementation language. | — |
| PowerShell evaluated `$(...)` intended for inner WSL Bash, creating a fixture in the repo | **C — Environment/integration** | Cross-shell command-substitution rules caused the mutation; a script file or argv-safe API is the fix. | — |
| `stdbuf`'s `LD_PRELOAD` poisoned an MSYS-to-native launcher invocation | **C — Environment/integration** | The environment variable was converted across MSYS/native boundaries and broke CMD; Unison launching the same chain would need the same sanitization. | — |
| Windows pueue rejoined and reparsed argv, turning `bash -c "sleep 5"` into an instant failure | **C — Environment/integration** | Vendor daemon quoting semantics destroyed argument boundaries; only real-backend testing or adapter-specific quoting catches it. | — |
| Codex CLI's advertised device-auth path fell back to a localhost browser flow | **C — Environment/integration** | The installed vendor CLI did not provide the headless behavior the harness needed. | — |
| Wrapper timeout failed to reap the vendor process tree, blocking a lane for about 70 minutes | **C — Environment/integration** | Process-group, signal, and Windows/POSIX child-lifecycle semantics caused the leak; a different language still needs an adequate launcher/runtime API. | — |
| Concurrent/heavy host load made wall-clock Bats tests fail spuriously | **C — Environment/integration** | Shared-host scheduling stretched fixed timeouts; serialization or a virtual clock is language-independent. | — |
| Remote lane produced a Git history with no merge base against `main` | **C — Environment/integration** | Git ancestry and remote-branch freshness semantics caused the unmergeable result; a preflight `merge-base` check works in any language. | — |
| `wt-merge.sh` aborted when explicitly named report paths were Git-ignored | **C — Environment/integration** | The implementation violated `git add`'s ignored-path behavior; changing the pathspec/list fixes the Git integration. | — |
| Correctly linked skill resolved repo root through logical `pwd` and missed `env/` | **C — Environment/integration** | Symlink and physical-path semantics caused the supported install shape to fail; `pwd -P` is the direct fix. | — |
| A detached copy install omitted repo-root files and silently aged in place | **C — Environment/integration** | Installer/link-shape semantics produced an incomplete runtime package; a force/backup install or self-contained package fixes it. | — |
| Windows-side skill install left the independent WSL skill home unprovisioned | **C — Environment/integration** | The host has two distinct home/install domains; cross-environment provisioning remains necessary in any language. | — |
| Git worktree isolation omitted untracked artifacts and live external dependencies | **C — Environment/integration** | `git worktree` materializes tracked Git state, not ignored files, installed dependencies, services, or testnet state; the same limitation applies to a Unison caller. | — |
| Reaper used CPU-idleness as a hung predicate and flagged healthy interactive/network-blocked lanes | **B — Logic/specification** | The predicate did not discriminate the states it claimed to classify; deleting it, not changing languages, fixed the false positives. | — |
| File-mtime watchdog confused artifact production with liveness, mishandled stale files, and latched after false alarms | **B — Logic/specification** | The monitor observed the wrong signal and had unsound state transitions; typed timestamps would not repair the model. | — |
| Worktree cleanup archived a fixed report pair and destroyed later versioned audits/patches | **B — Logic/specification** | The enumerated artifact contract was incomplete; a glob/declarative inventory is cheaper and language-agnostic. | — |
| `run-audit.sh` accepted a nonexistent brief and returned success | **B — Logic/specification** | The launcher omitted a file precondition and meaningful operator-error status; an explicit guard fixes it in Bash or Unison. | — |
| Two auditors disagreed but the workflow had no reconciliation policy | **B — Logic/specification** | The state was representable; the missing element was a project decision about how divergence maps to action. | — |
| Rework loop bounded rounds but did not measure whether each round made net progress | **B — Logic/specification** | The stopping rule encoded budget, not convergence; types cannot choose the intended optimization criterion. | — |
| Compound gate command's trailing exit zero was mistaken for a failed suite's result | **B — Logic/specification** | The caller read the wrong status in a multi-command protocol; capturing `SUITE_RC`/failure count is the direct fix. | — |
| Mixed lock-verdict state matched neither specified refusal guard and fell into the wrong result | **B — Logic/specification** | A sum type plus exhaustive matching would encourage a better design, but the wrong semantic mapping remains legal and current Unison documentation is mixed on compile-time exhaustiveness. | — |
| Filesystem-unsupported guard tested “any unsupported” instead of aggregate coverage | **B — Logic/specification** | The Boolean aggregation implemented the wrong quantifier; both forms typecheck. | — |
| Primitive operation errors were discarded and later reported as lock contention timeouts | **B — Logic/specification** | The implementation intentionally collapsed distinct external outcomes; an ADT helps only if the adapter preserves the errno distinction. | — |
| Lock cleanup could be bypassed by `exec`, `return`, signal timing, or command-owned traps | **C — Environment/integration** | Bash process replacement, special builtins, global traps, and signals defeat the wrapper cleanup path; another language still needs verified resource/signal semantics, which the supplied Unison docs do not guarantee. | — |
| Re-sourcing the lock library erased a live outer-lock ownership record | **B — Logic/specification** | Unconditional initialization destroyed valid state; idempotent initialization or encapsulation is available without a port. | — |
| Empty-path validation ran before the required nested-lock refusal | **B — Logic/specification** | The guard order encoded the wrong precedence; types do not choose which valid error wins. | — |
| Flock error capture overwrote and closed caller-owned file descriptor 3 | **C — Environment/integration** | The bug depends on Unix shell descriptor conventions; dynamic descriptor allocation/preservation fixes it without changing languages. | — |
| First source trusted inherited private lock variables as genuine ownership | **B — Logic/specification** | The initializer confused inherited data with live ownership; a process-local sentinel/validation is the missing rule. | — |
| Caller-controlled inventory row forged `pinned-mechanism` trust and bypassed the deliberately empty register | **B — Logic/specification** | The trust policy authenticated freshness fields but not provenance; content-addressed code does not authenticate arbitrary runtime JSON or trace claims. | — |
| Probe aggregation inherited an atomic verdict from one filesystem class onto unknown classes | **B — Logic/specification** | The reducer joined coverage from failed/unknown probes to a positive result; the wrong aggregation is well-typed. | — |
| Flock trace validator accepted shared/blocking modes instead of requiring both `LOCK_EX` and `LOCK_NB` | **B — Logic/specification** | The evidence predicate omitted required flags; typed text parsing cannot infer them. | — |
| Mkdir trace validator accepted `EEXIST` from an unrelated target | **B — Logic/specification** | The evidence was not bound to the probed path; this provenance relation must be specified and checked in any language. | — |
| Direct pin validation accepted any nonempty trace path and ignored host class | **B — Logic/specification** | The validator checked presence instead of authenticity/mechanism/class content; content-addressed deployment hashes do not supply that missing evidence relation. | — |
| Git-Bash readiness path could never consume a valid future pin | **B — Logic/specification** | The producer/consumer workflow omitted the only transition promised to restore availability; a missing code path is not a type error. | — |
| Process-local probe cache was lost through command-substitution subshells | **C — Environment/integration** | Bash subshell state semantics discarded mutations; avoiding command substitution or using explicit returned state is the local fix. | — |
| Scratch lock harness printed assertion failures but exited zero | **B — Logic/specification** | It had no accumulated failure status; a counter/nonzero final exit is a trivial language-agnostic correction. | — |
| Observed `non-atomic/contention` evidence was discarded as though it were untrusted | **B — Logic/specification** | The licensing table omitted a valid negative evidence class; both rejection and acceptance are well-typed policy choices. | — |
| Unknown contention/syscall evidence was serialized under the wrong `flavour` class | **B — Logic/specification** | The default label was retained instead of the observed class; an enum prevents misspelling, not assignment of the wrong constructor. | — |
| Flock evidence checked the loser but never proved the holder acquired and proceeded | **B — Logic/specification** | The evidence contract sampled only half the causal claim; types cannot infer the omitted control observation. | — |
| `el_init` could delete a live/unclassifiable lock before owner-aware reclamation | **B — Logic/specification** | Failure/unknown selection was treated as permission to delete; fail-closed guard placement fixes the policy. | — |
| Reclamation callers discarded success/refusal evidence and status | **B — Logic/specification** | Redirection to `/dev/null` violated the evidence contract; effect typing may reveal stderr use but cannot decide that it must be preserved. | — |
| Worktree index lock was acquired only after irreversible worktree/branch creation | **B — Logic/specification** | The operation order made refusal leave a non-retryable partial state; transaction design helps only if those Git effects participate, which verified Unison STM/Cloud storage does not show. | — |
| Two reclaim callers ran before proving the selected mechanism was `mkdir` | **B — Logic/specification** | The missing mechanism guard allowed deletion under `flock` or indeterminate state; the intended precondition was simply omitted. | — |
| Committed eventlog/worktree tests lacked trusted fixtures after the trust contract changed | **B — Logic/specification** | The regression suite was not migrated with the production precondition; test fixture maintenance is language-agnostic. | — |
| Exec-bit inventory hardcoded the three current SDD paths and missed a future sibling | **B — Logic/specification** | A closed literal inventory cannot discover a not-yet-named path; the criterion must derive membership from a stable property. | — |
| Foreman script inventory filtered on `*.sh` and missed an extensionless future script | **B — Logic/specification** | The extension was not the ownership/execution property the requirement intended. | — |
| Direct-exec inventory omitted the repo root and `env/` address family | **B — Logic/specification** | The enumerated regions did not cover all existing ownership locations; a broader derived predicate was needed. | — |
| Root coverage was repaired as the literal singleton `install.sh`, missing other/future root scripts | **B — Logic/specification** | The patch moved the hole instead of deriving root membership from the declared property. | — |
| Final inventory still used a closed region list and missed the already-planned future `bin/lane.sh` address | **B — Logic/specification** | No type system can enumerate future filesystem addresses from a manually closed list; the inventory rule itself must change. | — |
| Windows carve-out test derived both expectation and observation from the same `eol` attribute | **B — Logic/specification** | Removing the rule changed both sides together, so the oracle was not independent; mutation testing exposed the circular predicate. | — |
| PNG carve-out test was vacuous because all current PNGs had NUL bytes and `text=auto` already protected them | **B — Logic/specification** | The fixture corpus could not falsify the requirement; adding a NUL-free binary probe is independent of language. | — |
| PNG test installed an `EXIT` cleanup trap that replaced Bats' own failure-reporting trap | **C — Environment/integration** | Bats and Bash share process-global trap state; the cleanup mechanism collided with framework internals. | — |
| Type/object-read hardening applied to shebang regions but bypassed the separately appended hooks region | **B — Logic/specification** | Two inventory branches enforced different invariants; the missing validation was an implementation omission. | — |
| PNG regression test mutated the live worktree/object database without reliable failure cleanup | **B — Logic/specification** | The test chose a non-disposable target and omitted rollback; temporary index/object storage was already available. | — |
| Newly broadened direct-exec inventory selected four real scripts still committed as non-executable | **B — Logic/specification** | The implementation changed the checker but failed to migrate the data it checked; no type relation ties Git mode bits to the inventory. | — |
| Windows carve-out regression covered `.ps1` but not the separate `.bat` and `.cmd` root rules | **B — Logic/specification** | The test matrix omitted two independent patterns; exhaustive data-type matching does not enumerate external Git attributes automatically. | — |
| Check-then-act `mkdir` mutex admitted double winners on the affected runtime/filesystem path | **A — Language/runtime** | Moving the lock state into an atomic transactional operation would eliminate the split check/create interleaving rather than merely test it after the fact. | Unison base `STM.atomically` if all contenders are inside one runtime, or Unison Cloud transactional storage for shared contenders. |
| Check-then-act loser could overwrite the winner's owner token and release the winner's lock | **A — Language/runtime** | A transactional compare-and-set of `{owner, held}` plus owner-checked release makes publication and release one atomic state transition. | `STM.atomically` for centralized in-process ownership, or Unison Cloud transactional storage for multi-process/shared ownership. |
| Event-log compaction read/modify/rename could race an append and lose the appended record | **A — Language/runtime** | If append and compaction operate on one transactional store, the conflicting update is serialized/retried instead of being hidden behind separate file operations. | Unison Cloud transactional storage, or one-runtime STM if the entire event log is centralized; content-addressed deployments alone do not help. |
| Host Write/Edit tooling sent `/root/...` paths to Windows and created phantom files | **C — Environment/integration** | Tool path-domain resolution crossed Windows/WSL incorrectly; a port does not change the host tool's path semantics. | — |
| `npx openspec` resolved to a broken stub rather than the working global binary | **C — Environment/integration** | Package-resolution/PATH behavior selected the wrong external executable. | — |
| Work was performed in one of two divergent Foreman checkouts and never reached the live one | **C — Environment/integration** | Windows and WSL held distinct repositories; repository identity/freshness must be checked regardless of language. | — |
| Vendor-auth readiness checker reported Grok unauthenticated while the CLI worked | **C — Environment/integration** | The checker disagreed with vendor CLI behavior; direct adapter verification is still needed from Unison. | — |
| Codex auditor bootstrap failed from a detached-HEAD host repository before reaching its real target | **C — Environment/integration** | The adapter assumed a named Git base branch in the session repository; direct target dispatch or a real branch fixes the Git seam. | — |
| Pattern-based `pkill -f` matched the command issuing the kill | **C — Environment/integration** | OS process matching included the caller's own command line; recorded-PID targeting is the environment-specific fix. | — |
| Index inventory silently converted unreadable objects and non-regular Git entries into exclusion/misclassification | **B — Logic/specification** | The scan suppressed `git show` errors and failed to distinguish blob/symlink/gitlink modes; explicit error/type handling fixes the predicate. | — |
| Vendor subprocess timeout discarded the worker's final summary | **C — Environment/integration** | The wrapper/vender process boundary did not stream or preserve closing output before timeout; continuous teeing/checkpointing fixes it. | — |
| Sweep-alert edit emitted duplicate alerts and treated “process not found” as failure | **B — Logic/specification** | The alert schema and taskkill-result interpretation were wrong and had only syntax-check verification. | — |
| Virtual-clock sleep code used integer Bash arithmetic on fractional `WATCH_TICK=0.01` and crashed | **B — Logic/specification** | The chosen numeric representation contradicted the required fractional input; parsing ticks to milliseconds is the direct fix. | — |
| Release was force-merged without completing the authoritative full-suite gate | **D — Process/orchestration** | Time pressure overrode the workflow's evidence requirement; the language cannot enforce an operator's release decision. | — |
| Hand-rolled launchers repeatedly bypassed lane heartbeats/checkpoints/watchdogs because the durable path lacked needed controls | **D — Process/orchestration** | The operationally easier route bypassed the ownership protocol; making timeout/log controls part of the standard launcher fixes adoption. | — |

## Counts and Bucket-A Percentage

| Bucket | Count | Share |
|---|---:|---:|
| A — Language/runtime | 3 | 3.09% |
| B — Logic/specification | 52 | 53.61% |
| C — Environment/integration | 32 | 32.99% |
| D — Process/orchestration | 10 | 10.31% |
| **Total** | **97** | **100%** |

**Bucket-A percentage: 3/97 = 3.09%.**

That is an upper bound for “port benefit,” because all three A rows require rehoming shared state into STM or transactional storage. A transliteration that continues to coordinate through files, Git, and shell commands prevents **0/97** by language choice alone.

## What Fraction Does a Port Address?

**At most 3 of 97 real defect mechanisms, or 3.09%.** A literal Bash-to-Unison port that preserves file/Git/vendor coordination addresses **zero** of them automatically. The 3.09% figure credits a more ambitious architectural rewrite that moves the mutex/owner and event-log update state into verified transactional facilities.

The observed benefit is therefore small and concentrated, not broad. Unison would improve how the code expresses states and effects, but “easier to express/test” is not the same empirical claim as “would have prevented the defect.”

## Is Unison the Only Plausible Fix?

**No class in this inventory has Unison as the only plausible fix.**

- The `mkdir` double-winner and owner-token race can be eliminated by a kernel lock (`flock`), an exclusive token/CAS protocol with owner-checked release, SQLite/Postgres transactions, or a single supervising daemon. The trial branch at `330d52a` contains `flock` selection plus exclusive owner publication/release checks.
- The compaction race can be eliminated by serializing compaction with append under the same lock, by append-only generation/rename protocols, or by a transactional database. The trial branch's `el_compact` acquires the same `.seq.lock` as emit across snapshot and rename.
- State-modeling defects can be reduced with algebraic data types in Unison, Rust, Haskell, OCaml, Scala, or TypeScript discriminated unions, plus cross-product tests. Effect isolation likewise has several implementation options.

Thus even the best pro-port cases are cases where Unison is **one architectural option**. The presence of much cheaper implemented fixes materially weakens “we need a port” as the inference from those races.

## Cheaper Intervention

A cheaper intervention captures nearly all observed benefit:

1. **Make success artifact-bound:** per-attempt IDs, freshness, declared deliverable sets, content hashes, validators, and nonzero failure aggregation. Never accept a vendor exit code or self-report alone.
2. **Require independent negative controls:** mutation-test every checker; exercise zero denominators, stale artifacts, wrong paths, missing inputs, and real backends rather than only shims.
3. **Keep a directly owned supervisor:** launch vendors directly, persist each finding incrementally, tag/register every process, define completion by artifacts, and supervise process trees outside the agent turn.
4. **Keep the shipped/local concurrency fixes:** trusted `flock`, owner-checked publication/release, one lock spanning append and compaction, and a serialized host test gate.
5. **Harden platform adapters:** real files instead of nested shell heredocs, argv-safe launchers, pinned/preflighted vendor CLIs, explicit Windows/WSL path domains, and real-daemon integration checks.
6. **Optionally extract only the decision core:** a small typed state/evidence module (Unison or another typed language) behind the existing Bash/platform adapters would obtain most readability/testability benefits without porting roughly 8,800 lines of OS-facing orchestration.

These interventions directly target all four observed buckets and avoid betting the process/signal/Git/vendor integration layer on a comparatively small runtime surface.

## Uncertainty and Mixed Evidence

- **Eight versus nine strandings:** the named incident file says “Eight strandings” and contains S-1 through S-8. I found no ninth diagnosis there. I did not invent one. If a distinct ninth exists and is non-A, the headline becomes 3/98 = 3.06%.
- **What counts as “hit”:** this inventory includes deterministic audit/mutation reproductions on active branches, even when a gate prevented shipment. It excludes latent lows and unconfirmed hypotheses. If “hit” is narrowed only to the skeptic's 12 checker events plus the eight incident entries, the result is 0/20; that narrower denominator contradicts the requested inclusion of the audit findings.
- **Bucket A is conditional:** base STM covers contenders only when their state is centralized in one Unison runtime. Multi-process/distributed coordination needs a shared transactional service such as Unison Cloud, which is an infrastructure redesign, not a free language property.
- **Possible double-count sensitivity:** the owner-token overwrite is downstream of the `mkdir` double-winner but was a separately reproduced security/ownership defect in the merge audit. Collapsing those into one root cause gives A=2 and total=96, or 2.08%; the conclusion is unchanged.
- **Pattern exhaustiveness evidence is mixed:** the current official tutorial says all cases are required and a missing fallback will not typecheck, while the language-reference page says unmatched patterns are a runtime error “in this version.” More importantly, the observed mixed-verdict defect could still be encoded as an exhaustive catch-all returning the wrong refusal, so I did not credit it to A.
- **“Already shipped” is mixed in the supplied trees:** `/root/fm-wt/trial` at `330d52a` implements `flock`, exclusive owner publication, and shared-lock compaction after the recorded blocked merge audit. `/root/foreman` `main` at `35fd4d8` still contains the older inline `mkdir` eventlog locking and no shared `lock.sh`. The cheaper fixes are demonstrably implemented in the trial branch, but these artifacts do not establish that they have landed on `main`.
