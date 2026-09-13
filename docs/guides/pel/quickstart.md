# Start a Pel task

Use Linux x64 with Node.js 24 and an installed Return of the ForeDi archive. See [installation](install.md) for the archive verification and install command. Add the installation's `bin` directory to your existing PATH configuration.

Run these commands from the Git repository that will contain the candidate:

```text
foreman --version --json
foreman providers list --json
```

The provider view identifies each exact model and transport. A listed profile does not establish account access or native coding capability. Resolve unavailable credentials or qualification before starting paid work. No other model is substituted.

The standard workflow uses the implementer and reviewer roles. Its default assignment is Grok 4.6 for implementation and GPT 5.6 Sol for independent review. Each selected transport must have current evidence for its required capability and tool policy. A recorded fixture does not supply that evidence.

## Configure the project once

Copy `examples/pel/project-settings.json` from the installed package into the project. Replace the example paths and references with the project's existing execution authority, repository identity, bounded workspace, state root, approved task artifact, credential profiles, and exact provider selections. Register the full verification command under `candidate-full` with its explicit environment binding.

Use an isolated candidate worktree whose HEAD is the admitted immutable base. The host preserves its branch and index while it captures changed files. Resolve nonignored changes outside the permitted write paths before admission.

```text
foreman project configure --settings project-settings.json
```

Configuration registers the project and its state root. It references existing authority; it does not grant new publication authority. Keep the selected credential values in their credential store. Put only credential references in settings and source files.

## Check and start

Copy the installed `examples/pel/implement-verify-review.pel` into the project. It contains the complete control flow:

```clojure
(fm/task :id "implement" :model "role:implementer"
  :input "artifact:approved-spec" :output "schema:candidate-v1")
|> (fm/verify :id "verify" :input ^ :gate "candidate-full")
|> (fm/review :id "review" :model "role:reviewer"
  :input ^ :policy "independent-review")
```

```text
foreman check implement-verify-review.pel
foreman plan implement-verify-review.pel
foreman run implement-verify-review.pel --json
```

After installation, credentials, qualification, and project configuration exist, one `run` command starts the standard workflow. Read the returned run ID and status. Candidate capture, host verification, and independent review produce immutable evidence references.

A successful check means that the source is valid. Product admission still checks the current project and exact transport evidence before effects. Invalid admission exits 2. A required unresolved action exits 3 and includes its next action. Neither result is a successful delivery.

## Inspect and recover

```text
foreman status RUN_ID --json
foreman resume RUN_ID --json
foreman support export --run RUN_ID --out support.json
```

Use the returned next action before resuming a pending run. Resume uses the original history and completed effect evidence. An unknown external outcome requires reconciliation; a second publication is not inferred from a lost acknowledgement.

To stop an active run, use `foreman cancel RUN_ID`. Cancellation does not create a resumable pending run.

The standard workflow ends after review. [Other examples](examples.md) show bounded repair, race, recovery, and separately authorized publication. [Research context](research.md) is advisory. The optional Obsidian vault is not required to check, start, or recover a task.
