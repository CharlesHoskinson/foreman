# WITHDRAWN 2026-08-01 — wsl-seam-doctrine

Archived, not deleted. Three of its five substantive items are still live work
and are listed below so the withdrawal does not quietly drop them.

## Why

The package proposed codifying five scattered Windows/WSL seam rules as one
doctrine set. Two of the five are dead, in different ways, and the design rests
on a false census — which together make the package as written unshippable.

- **Its Docker item is direction-reversed.** Task 3 instructs the implementer to
  document Docker Desktop's WSL2 backend as the supported hard-mode container
  host and to write a warning against native `docker-ce`. The repository does
  the opposite: `env/reference-manifest.toml` states native `docker-ce` is
  preferred, and `env/bootstrap-wsl.sh` installs it via `get.docker.com` and
  enables the service. The task asks for a warning against what the project's
  own provisioner installs. The contradiction predates the package — the
  manifest note is dated 2026-07-18, the design 2026-07-19.
- **Its exec-bit item was delivered, better, elsewhere.** Task 4 asked for
  `tests/exec-bit.bats` covering directly-executed scripts.
  `crlf-extensionless-hardening` shipped `tests/line-endings.bats`, which derives
  the inventory from a whole-repo shebang property over index blobs and forbids
  inclusion lists of regions. That is strictly stronger, and it catches the
  executable markdown files the narrower version would have missed.
- **Its design premise is false.** `design.md:41-43` asserts 445 tracked files
  at mode `100644` with none at `100755`. Measured on `main`:
  `git ls-files -s | awk '{print $1}' | sort | uniq -c` returns 787 at `100644`
  and **121 at `100755`**, 908 tracked. A doctrine built on a census that wrong
  cannot be reasoned from.

## What replaced it

Nothing replaces the package as a unit. The exec-bit requirement is satisfied by
`tests/line-endings.bats`. The Docker doctrine is satisfied by the manifest and
provisioner already saying the opposite of what the task asked.

## What must NOT be lost

Three items are live, unfixed, and cheap. They are the reason this is an archive
rather than a deletion.

1. **Vendor-agnostic browser-callback auth doctrine.**
   `skills/foreman/references/lanes.md` still states the rule codex-specifically
   — `--device-auth` falling back to a `localhost:1455` browser callback — and
   treats grok separately as browser-free. No vendor-agnostic statement exists,
   and no note anywhere records that `::1` is not forwarded.
2. **Daemon-lifecycle doctrine for `pueued`.** No `systemd=true`,
   `restart-on-demand` or `idle-shutdown` guidance exists under
   `skills/foreman/references/` or in `lane-queue.sh`.
3. **The `*NT*` platform-detection drift.**
   `skills/foreman/scripts/lane-run.sh` matches only `MINGW*|MSYS*|CYGWIN*`
   in `lane_platform()`, while `lib/launch.sh` and `worker-run.sh` both carry
   `*NT*`. One of the three is wrong on some host.

One further residue worth fixing independently of any of this:
`skills/foreman/scripts/worker-run.sh` still tells the user that the hard-mode
container profile "requires Docker Desktop/WSL2" — naming the host the project
rejected.
