# Learn Pel from expressions to a delivery workflow

Pel describes a bounded workflow. Foreman checks that description, admits its capabilities, and records execution in durable history.

This tutorial uses `pel-paper-v2-foreman-1`. It follows the implemented [paper compatibility profile](../../reference/pel/compatibility.md), including its documented corrections. Pel does not execute arbitrary JavaScript or shell source.

## 1. Prepare the offline tools

Install the package with Node.js 24. Follow [installation](install.md) for supported platforms and archive verification.

Save each Pel block below as a separate UTF-8 file. Use these commands to inspect a file:

```text
foreman check lesson.pel
foreman plan lesson.pel
foreman plan lesson.pel --json
```

These commands do not dispatch the file's effects. The human plan shows values, effects, dependencies, capabilities, resources, and bounds. JSON preserves the complete preview contract.

The pure lessons need no provider or credentials. They demonstrate evaluator results, not a separate `eval` CLI command. `foreman run` uses project admission, even when a program contains only pure expressions. The default delivery contract can require more than an ordinary number or string.

## 2. Read expressions and values

Parentheses call a function. Brackets create a list. Whitespace separates expressions. A semicolon starts a line comment.

```pel
; This program returns 42.
(+ 20 22)
```

The final expression supplies the program's ordinary value. Programs can contain multiple expressions.

| Form | Meaning |
| --- | --- |
| `42`, `-3`, `1.5` | Finite numbers within the profile range |
| `"hello"` | String |
| `#t`, `#f` | Booleans |
| `#nil`, `()` | Nil |
| `[]`, `[1 2 3]` | Empty list and numeric list |
| `':status` | Quoted keyword value |
| `[:status "approved"]` | List containing a named pair |

Nil and an empty list are different. Conditions require Booleans. Nonempty strings are not automatically true.

Use ASCII `|>` for pipes. The printed paper triangle and extracted `^>` are rejected. Caret `^` has a separate injection meaning.

## 3. Bind names and select list entries

`def` binds a name. Definitions are immutable within their scope.

```pel
(def numbers [10 20 30])
(def result [:status "ready" :value (numbers :at 2)])
(result :at ':value)
```

The result is `20`. List positions start at **one**. Named lookup uses a quoted keyword. Duplicate data keys retain their order, and lookup returns the first match.

Callable lists also support `:from` and `:to` inclusive slices. A list of indices selects multiple entries. Invalid explicit bounds fail instead of silently changing the request.

Quotes preserve data or syntax without evaluation. There is no implicit `eval`. Model-generated text cannot become executable Pel through an ordinary value.

## 4. Call functions and create closures

A call uses positional arguments or named arguments. It cannot mix the two modes.

```pel
(def add (lambda [:x :y] (+ x y)))
(def add-ten (add :x 10))
(add-ten :y 5)
```

The result is `15`. Missing required arguments create a partial closure. Unknown arguments, duplicate arguments, and rebinding supplied arguments fail.

A parameter can have a default, such as `[:x :y 2]`. Defaults evaluate when the lambda forms. Closures capture their definition environment. A later definition does not repair an earlier unbound capture.

Arithmetic uses fixed signatures. For example, `+` accepts two numbers or one numeric list. It does not accept arbitrary positional argument counts.

## 5. Pass values through pipes

A pipe evaluates its left side once. A right-side call without a free caret receives the value as its first argument.

```pel
(def doubled (+ 2 3) |> (* 2))
10 |> (- :x ^ :y doubled)
```

The result is `0`. Explicit carets work well with named arguments. Without a caret, automatic positional insertion can conflict with named arguments.

Use a named binding before a callable-list lookup, as in lesson 3. Avoid putting the caret in the callable position of a named lookup. The implementation's insertion rule can then produce `PEL_ARGUMENT_MODE`.

## 6. Choose a branch

`if` evaluates its condition and only the selected branch.

```pel
(def count 7)
(if (gt count 5) "large" "small")
```

The result is `"large"`. `case` tests its conditions in source order:

```pel
(case 7 [(gt ^ 5) "large" #t "small"])
```

The result is also `"large"`. The case condition owns its scrutinee caret.

A literal string used as a case condition requests a model predicate. It is an effect, not a string comparison. That path needs an admitted predicate selection, registered evaluation authority, and a Boolean result. Use `eq` for deterministic equality.

## 7. Repeat bounded work and define local scope

`for` evaluates its body in a fresh child scope for each item.

```pel
(for [1 2 3] item (* item 2))
```

The result is `[2 4 6]`. A `do` block sequences expressions in one child scope:

```pel
(do
  (def subtotal (+ [1 2 3]))
  (* subtotal 2))
```

The result is `12`. The block returns its last expression. Its local definition does not escape the block.

Loops, recursion, values, source size, and reductions have finite limits. Resuming does not reset consumed counters. Use explicit stopping conditions for recursive repair. The checker must also bound every possible host effect.

The shipped `repair-and-publish.pel` demonstrates one correction round. It checks for approval, detects no product change, and returns a reason when correction stops. Increasing its bound does not grant more execution authority.

## 8. Understand the host boundary

A fully supplied host call suspends language evaluation. The execution owner validates and performs the operation. A partial host closure performs no operation.

| Operation | Host responsibility |
| --- | --- |
| `fm/task` | Execute an authorized task and capture an immutable candidate |
| `fm/verify` | Run the registered gate against that exact candidate |
| `fm/review` | Obtain independent review bound to candidate and verification evidence |
| `fm/publish` | Publish to a separately authorized exact destination |
| `fm/research` | Read a bound immutable research snapshot as advisory context |
| `fm/checkpoint` | Retain durable checkpoint evidence |
| `print` | Retain output through the host output policy |

A model's claim that tests passed is not verification evidence. A candidate reference is not publication authority. Review approval does not silently merge or publish a branch.

Research reads do not reserve execution actions or modify source bundles. Missing bindings and missing capabilities still cause refusal. See [research](research.md) for coverage and freshness limits.

`print` takes one `:vals` argument. Use a list for multiple values. It also accepts `:sep` and `:nl`. Product JSON output remains machine-readable under the run's output policy.

## 9. Start one complete configured workflow

The following block is the exact standard workflow. It requires project configuration and admitted execution capabilities.

```pel
(fm/task :id "implement" :model "role:implementer"
  :input "artifact:approved-spec" :output "schema:candidate-v1")
|> (fm/verify :id "verify" :input ^ :gate "candidate-full")
|> (fm/review :id "review" :model "role:reviewer"
  :input ^ :policy "independent-review")
```

Follow [quickstart](quickstart.md) to configure existing authority, immutable input artifacts, bounded workspaces, credentials, and the full `candidate-full` gate. Example settings contain placeholders. They do not grant authority.

Keep credential values in the credential store. Source and settings use references. Use an isolated candidate worktree at the admitted base. The host captures changes without moving its branch or index.

```text
foreman providers list --json
foreman project configure --settings project-settings.json
foreman check implement-verify-review.pel
foreman plan implement-verify-review.pel
foreman run implement-verify-review.pel --json
```

The standard roles select Grok 4.6 for implementation and GPT 5.6 Sol for review by default. Role configuration can select other admitted exact cells without changing workflow source.

| Exact profile | Explicit task transport |
| --- | --- |
| `grok-4.6` | `grok-acp` |
| `claude-opus-5` | `claude-code` |
| `claude-fable-5-1` | `claude-code` |
| `gpt-6-astra` | `codex-app-server` |
| `gpt-5.6-sol` | `codex-app-server` |
| `gemini-3.8-flash` | `gemini-cli` |

These are selection spellings, not promises of live support. Gemini native coding is currently unsupported. Listed profiles do not prove credentials, account access, or qualification. No silent model fallback occurs. See [qualification](qualification.md) before live execution.

The returned delivery view reports candidate, checks, review, publication, findings, and next action. The standard workflow stops after review. A task-only example can require further milestones before delivery succeeds.

## 10. Run independent work and control retries

`do/async` releases dependency-ready work. It does not make conflicting writes safe. Shared resources, data dependencies, and admitted concurrency limits still apply.

```pel
(do/async
  (fm/research :id "read-paper" :query "language requirements" :bundle "bundle:pel-paper" :limit 5)
  (fm/research :id "read-models" :query "provider constraints" :bundle "bundle:model-evidence" :limit 5))
```

This exact shipped example needs both immutable bundle bindings. The block's value comes from its last source expression, not whichever operation finishes last.

`fm/race` accepts zero-argument task closures and an explicit winner policy. Use the shipped `race-cancel.pel` for the complete sequence. Each writing contender needs a separate admitted workspace. Its result contains `:winner-index`, `:value`, and `:losers`.

Select the winner's `:value` before verification. A persisted winner remains selected after recovery. Loser cancellation can remain unresolved when an external outcome is unknown.

`fm/retry` takes `:attempts`, an `:on` list of failure keywords, and a zero-argument `:body` closure. It retries only eligible declared failures within existing budgets. It is not a general instruction to repeat uncertain external work. Failed attempts retain consumed budget. Business correction belongs in explicit source flow, as the bounded repair example shows.

## 11. Inspect, cancel, and recover

Retain the returned run ID. Use that same ID for inspection and recovery:

```text
foreman status RUN_ID --json
foreman resume RUN_ID --json
foreman cancel RUN_ID
foreman support export --run RUN_ID --out support.json
```

These commands are separate choices, not a sequence to execute blindly. Cancel stops active work. A cancelled run does not become a resumable pending run.

Resume uses the original source, settings, history, and completed receipts. A checkpoint records a boundary. It does not authorize repetition of completed provider work. See `resume-checkpoint.pel` for its placement before the standard workflow.

An unknown external outcome needs reconciliation. Read the returned next action. A lost publication acknowledgement does not justify another push. Recovery decisions must match the original run, effect, evidence, and authority.

Editing a source file does not replace a stored continuation. Draft editing and durable run revision are different operations. The [authoring reference](../../reference/pel/authoring.md) describes interactive drafts.

## 12. Diagnose refusals

Diagnostics identify a file, line, column, and cause. Correct the reported boundary before another attempt.

| Symptom | Meaning and next step |
| --- | --- |
| `PEL_ARGUMENT_MODE` | Separate named arguments from positional arguments. Check pipe insertion. |
| `PEL_DYNAMIC_EFFECT_UNBOUNDED` | The checker cannot bound a possible callable or effect. Use finite, source-defined targets. |
| `PEL_HOST_RESULT` | A host receipt violates its declared schema. Inspect retained evidence. |
| `PEL_HOST_FAILURE` | A valid host failure reached the evaluator. Read its structured cause. |
| Resource or capability denial | The requested operation exceeds admitted scope. Source text cannot grant the missing authority. |
| Candidate changed | Verification, review, or publication no longer matches the captured candidate. Inspect the worktree and evidence. |
| Unknown external outcome | Reconcile the existing operation before considering new execution. |
| Limit failure | A finite bound is exhausted. Resume preserves the consumed amount. |

A valid check does not prove runtime admission or delivery success. Invalid admission exits 2. A required unresolved action exits 3. Inspect the typed run result for the exact status and next action.

For further practice, use the [installed examples](examples.md), [language extensions](../../reference/pel/extensions.md), and [support guide](support.md). No tutorial exercise requires implicit publication.
