# Install Return of the ForeDi

Use Linux x64 and Node.js >=24 <25. Installation requires no source checkout, package manager, Python, or shell wrapper. Obtain the release archive and its published SHA-256. Verify the archive against that value before extraction. Extract it into an empty directory with your archive tool.

Run the compiled installer from the extracted package:

```text
node /absolute/unpacked/runtime/dist/install.js --prefix /absolute/installation
```

Without `--prefix`, the installer uses `$HOME/.local/share/foreman`. It validates the manifest, all payload hashes, file modes, required examples, and runtime manifest before it selects the package. Links and undeclared files are refused. A failed prerequisite or invalid package exits 2. A symlink ancestor in the installation prefix is invalid input and exits 2. An installation I/O failure exits 1. Cancellation exits 4.

The installer applies each declared file mode after file creation, including with restrictive caller umasks.

The installer retains each build under `versions/BUILD_ID`. It atomically selects `current` and creates `bin/foreman` as a link to the selected compiled entry. Add the installation's `bin` directory to your existing PATH configuration. The installer does not edit shell startup files.

```text
/absolute/installation/bin/foreman --version --json
/absolute/installation/bin/foreman providers list --json
```

Version JSON contains `releaseName`, nullable `version`, and `buildId`. An unversioned build is identified as Return of the ForeDi. The package version is not inferred from the repository's npm version. Keep the archive SHA-256 and build ID with your deployment record.

See [quickstart](quickstart.md) to configure existing project authority and start the standard task. The [examples](examples.md) and model profiles are installed beside the runtime. Account access and exact transport qualification remain prerequisites for provider work.

## Select a retained build

```text
foreman install rollback --to BUILD_ID
```

Rollback validates every target payload file and inspects all state roots in the original Foreman project registry. It refuses a target that cannot decode an active journal, checkpoint, or Pel continuation. Unreadable active state also prevents the switch and exits 3. An absent or invalid build exits 2. Rollback preserves run histories and execution identities. It does not rewrite checkpoints or redispatch work.

A failed run without a later revision is terminal. It does not prevent runtime selection. To revise that run, first select its compatible retained build. The revision uses its original authority, history, and remaining allowance. A failed result followed by a revision is active and participates in rollback compatibility checks.

Plain resume and cancel keep the original execution binding. They can use a compatible retained runtime without changing the current selection. New runs and source revisions require the selected runtime. They complete their admission transaction before execution starts.

## Produce an archive

From a clean repository at the intended full candidate commit, run:

```text
npm run package:pel -- --candidate FULL_GIT_COMMIT --out artifacts/foredi
```

Build the compiled runtime first. Commit relevant production, documentation, and example sources before packaging. The producer refuses tracked changes and untracked relevant sources. Research assets and trusted migration bindings come from tracked candidate sources. Ignored generated copies cannot change the package. Its sole successful JSON record contains `buildId`, `archivePath`, and `archiveSha256`. It emits that record only after the archive is closed.

The archive name is `BUILD_ID.tar.gz`. The manifest hashes its canonical payload to derive the build ID; it does not hash itself. File order, modes, ownership metadata, and timestamps are deterministic. The installed support matrix retains the original unresolved adoption obligations. Packaging does not declare those obligations complete.
