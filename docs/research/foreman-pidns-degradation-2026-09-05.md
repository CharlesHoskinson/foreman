# Foreman PID-namespace degradation on the Grok 4.6 implementation lane

Date: September 5, 2026 (UTC). Host: `hoskinsonlaptop`, WSL2, user `charl`.
Investigation mode: read-only repository inspection with bounded inert probes.
No repository, queue, Endstop, heartbeat, checkpoint, or gate state was changed
during the investigation. The launcher was not modified.

Pinned inputs:

| Item | Value |
|---|---|
| Foreman commit | `45121c7bcd405da99075431913ad03e9e742446a` (local `main`, three commits ahead of `origin/main` at `4ab2a63`) |
| Launcher binary | `launcher/dist/foreman-launch`, SHA-256 `a9a3e9cf534c63b96a4770edecd6fae5e544af98948e2e427d2c92fca4a711ea`, reports `foreman-launch 0.2.5 (bun 1.3.14)` |
| Node launcher bundle | `skills/foreman/runtime/dist/foreman-launch.js`, reports `foreman-launch 0.3.0 (node 24.18.1)`, not selected by `lane-run.sh` |
| `unshare` | `/usr/bin/unshare`, util-linux 2.41.3, SHA-256 `41c65e55107cbbb1a1f6994784a938dd7dbbe255d1fea6b7a58ec96eabe382ef` |
| Kernel | `6.18.33.2-microsoft-standard-WSL2`, `CONFIG_PID_NS=y`, `CONFIG_USER_NS=y`, `CONFIG_SECURITY_APPARMOR=y` |
| systemd | 259.5-0ubuntu3.4, system and user managers running, cgroup v2 with `nsdelegate` |
| Grok 4.6 model card | PDF SHA-256 `1fbb3ab6d7c572720e05d501eab8f11052b32db8d5936e66802c5c49b2261f4f`, 42 pages, 540844 bytes, revision 2026-08-17 |
| Graph qualification | `graphify-qualification.js freshness` returned `Stale`. Source files were read directly. |

Evidence classes used below: **source fact** (kernel, util-linux, systemd, or
xAI documentation), **repository observation**, **experiment observation**,
**inference**, **recommendation**, and **open question**.

## D1. Executive diagnosis

**Proven cause.** The launcher's availability probe runs
`unshare --pid --mount-proc --fork --kill-child -- true`. On this host the
probe exits 1 with `unshare: unshare failed: Operation not permitted`. A syscall
trace of the same probe, and of the shipped binary itself, shows a single
failing call: `unshare(CLONE_NEWNS|CLONE_NEWPID) = -1 EPERM`. The call fails
before any fork, before any proc mount, and before the launcher's own image
replacement. `unshare(2)` requires `CAP_SYS_ADMIN` in the caller's user
namespace for both `CLONE_NEWPID` and `CLONE_NEWNS`. The calling process runs
as uid 1000 in the initial user namespace with an empty effective capability
set (`CapEff: 0000000000000000`). EPERM is therefore the documented result,
not a fault of WSL, AppArmor, seccomp, or the model.

**Why the probe worked once and does not work now.** The archived design
record for the cascade (`openspec/changes/archive/2026-07-18-posix-cascade-parity/design.md`)
states that the behavior was reproduced via `wsl -u root`, that the
unprivileged capsh test used `unshare --user --pid --fork --kill-child`, and
that a non-root user was not probed. The shipped flags omit `--user`. The
README sentence "verified unprivileged on this WSL2 host" is therefore not
supported by the repository's own record. Foreman later moved from the `root`
WSL user to `charl` (reference-environment migration notes, AGENT_TRAPS 20).
Inference: the strong path stopped working at that move and has been silently
degrading every POSIX round since. The v0.4.0 release notes (2026-08-24) already
record the EPERM on this host, but describe it as a host limitation rather than
a flag omission.

**What remains true in degraded mode.** The launcher wraps the command in
`setsid`, sets `PR_SET_CHILD_SUBREAPER` on itself, and can send `SIGKILL` to
the command's process group on timeout. It has no kernel cascade, no parent
death signal, no pidfd, and no cgroup. A descendant that calls `setsid` or
double-forks leaves the process group and survives every launcher-side kill.
The launcher does not kill the group on normal command exit at all. Only the
Windows Job Object path does that.

**What the warning does not change.** Neither the strong path nor the degraded
path provides filesystem, network, credential, IPC, or resource isolation. The
Grok process runs as `charl` with `--always-approve`, no `--sandbox` profile,
passwordless `sudo` (`sudo -n true` exits 0), and write access to
`/var/run/docker.sock`. The security posture of an implementation lane is the
same in both modes. The warning removes a process-lifecycle guarantee, not a
security boundary that existed.

**Actual risk.** Orphaned or escaped worker processes after cancellation,
crash, or timeout. Continued edits to a worktree after the round is considered
dead. Resource use that outlives the round. No new data exposure relative to a
correctly working strong path.

**Smallest recommended next action.** Add `--user --map-current-user` to the
launcher's `unshare` flags in the Node launcher package, route `lane-run.sh`
to that launcher, and make implementation lanes fail closed unless the
capability is strong or an explicit degraded approval is recorded on the run.
Until that lands, continue Grok implementation rounds only under an explicit,
recorded degraded-mode approval, and do not describe them as contained.

## D2. Runtime path map

Repository observation. Every step names the actual file that runs.

1. **Queue.** `skills/foreman/scripts/lane-queue.sh` is a thin adapter that
   executes `skills/foreman/runtime/dist/lane-queue.js`
   (`packages/orchestration/src/queue-admission.ts`). It validates the Endstop
   release block, reserves the action, and submits one pueue task in group
   `grok` (cap 3). The queue has no containment vocabulary. Its only
   `degraded` marker is `pueue absent`.
2. **pueue.** `pueued` (pid 315581 at observation time) was started from a WSL
   login shell. Its cgroup is `/init.scope`. It is not a systemd unit. Its
   capability set and namespace links are identical to an interactive shell.
   Every lane inherits that context.
3. **Lane.** pueue runs `env LANE_VENDOR=grok WC_GROK_MODEL=grok-4.6 ... bash
   skills/foreman/scripts/lane-run.sh --round GATE REPORT RUN grok WORKTREE -- grok ...`.
   `lane-run.sh` calls `runtime/dist/credential-profile-lane.js admit`, which
   returns the verified config root
   `~/.foreman/credential-profiles/grok-default/homes/grok`. The script exports
   it as `GROK_HOME` and unsets `CODEX_HOME`. This is configuration separation,
   not a security boundary.
4. **Launcher resolution.** `lane_resolve_launcher` prefers `FOREMAN_LAUNCH`,
   then `$FOREMAN_TOOL_ROOT/launcher/dist/foreman-launch`, then `PATH`. On
   this host it selects the Bun-compiled binary from `launcher/src/`. The
   Node package `packages/launcher` compiles to
   `skills/foreman/runtime/dist/foreman-launch.js` and is exercised only by
   tests. The two implementations share the same frozen flag list.
5. **Spawn.** `lane-run.sh` runs
   `env -u LD_PRELOAD ... foreman-launch --heartbeat-file HB --heartbeat-interval 15 -- grok ...`
   in the background, tees its output to the stream file, and waits. No
   `--timeout` is passed. The launcher therefore supervises until the command
   exits.
6. **Namespace bootstrap (Bun launcher, `launcher/src/launch.ts:216`).**
   `bootstrapPidnsCascade` calls `pidnsAvailable()` in
   `launcher/src/posix-bootstrap.ts:78`. The probe uses `Bun.spawnSync` with
   `stdout: "ignore", stderr: "ignore"` and returns `exitCode === 0`. On
   failure it prints the observed warning and returns `"degraded"`. The
   launcher then calls `prctl(PR_SET_CHILD_SUBREAPER, 1)` and proceeds.
7. **Grok process.** `supervise()` spawns `setsid grok --prompt-file ... --cwd
   WORKTREE -m grok-4.6 --output-format json --always-approve --no-subagents
   --disable-web-search --verbatim --max-turns 40`. The child becomes its own
   session and process-group leader. It shares every namespace with the host
   shell. Its cgroup is `/init.scope`.
8. **Gate.** After the command exits, the gate command runs under a second
   launcher invocation with the same heartbeat file. The same probe runs
   again and prints the same warning. The pueue log for task 1455 shows the
   warning twice (lines 3 and 33) for this reason.
9. **Ownership and terminal events.** The ownership event records
   `launcher_pid`, `pid`, `job_id`, `config_dir`, and `launcher: true`. No
   event records the capability. The heartbeat schema is frozen to eight
   fields with no capability field. The DEGRADED line exists only in the
   stream file and the pueue log.

Run `council-binding-20260905` terminal metadata (restricted fields only):
ownership at 02:30:38Z with `launcher_pid 316190`, `pid 316201`; state
`verifying` at 02:46:25Z; `waiting_child` with `gate_rc 1` and
`report_fresh false`; alerts `round_incomplete` and `AGENT_ABANDONED`. The
round failed its gate and left no fresh report. That failure is unrelated to
containment. pueue reports the task as `Failed (1)`, finished 20:46:27 local.

## D3. Grok 4.6 model card coverage and threat-model synthesis

### Acquisition

| Field | Value |
|---|---|
| Requested URL | `https://media.x.ai/v1/website/card-4p6-4cd2dc57.pdf` |
| Canonical URL | same |
| Retrieved (UTC) | 2026-09-05T02:57:44Z with Scrapling 0.4.15 `Fetcher.get`, `impersonate="chrome"` |
| Status, content type | 200, `application/pdf` |
| Bytes, SHA-256 | 540844, `1fbb3ab6d7c572720e05d501eab8f11052b32db8d5936e66802c5c49b2261f4f` |
| Preserved copy | `/tmp/foreman-model-cards.Mbx8CV/xai-grok-4-6-model-card.pdf`, digest verified equal before use |
| PDF signature | `%PDF-1.7`, 42 pages, LaTeX/xdvipdfmx, created 2026-08-17 |
| Extraction | `pdftotext -layout`, 1720 lines, byte-identical to the preserved extraction |

The current card equals the preserved card. No version difference exists.

### Coverage ledger

Printed page numbers are one less than PDF page numbers because the cover is
unnumbered. Every PDF page was read in full from the layout extraction. Pages
whose charts lose bar-to-label alignment in text were also inspected as
rendered images.

| PDF page | Printed | Content | Method |
|---|---|---|---|
| 1 | cover | Title, date August 12, 2026, revision 2026-08-17 | text |
| 2 | 1 | Changelog: numbering, PartBench, DeepSearchQA, KernelBenchInternal 1.1, corrected HackerBench, self-harm, MASK, LAB | text |
| 3-4 | 2-3 | Contents | text |
| 5 | 4 | References entry line | text |
| 6-7 | 5-6 | 1 Introduction, 1.1 Overview, 1.2 Training | text |
| 8-9 | 7-8 | 2.1 CursorBench 3.2, score vs tokens and score vs cost charts | text and image (PDF page 8) |
| 10 | 9 | 2.2 APEX-SWE | text |
| 11 | 10 | 2.3 FrontierCode v1.1 | text |
| 12 | 11 | 2.4 DeepSWE v1.1 | text |
| 13 | 12 | 2.5 SWE-Marathon v1.1 | text |
| 14 | 13 | 2.6 Terminal-Bench 3.0 | text |
| 15-19 | 14-18 | 3.1 AA GDPVal, 3.2 AA-Briefcase, 3.3 APEX-Agents, 3.4 OfficeQA Pro, 3.5 Legal Agent Benchmark | text |
| 20-23 | 19-22 | 4.1 EEBench, 4.2 3DCodeBench, 4.3 PartBench, 4.4 CADGenBench, 4.5 CADBench | text |
| 24-26 | 23-25 | 5 R&D enablement, 5.1 MTS Eval, 5.2 InferenceEval, 5.3 KernelBenchInternal v1.1 | text |
| 27 | 26 | 6.1 Factuality (Hallucination) | text and image |
| 28 | 27 | 6.2 DeepSearchQA | text |
| 29-30 | 28-29 | 7 Cyber, 7.1 CyberGym, 7.2 CVE-Bench, 7.3 SecureCodeReview | text |
| 31 | 30 | 7.4 HackerBench v0.2 | text and image |
| 32-34 | 31-33 | 8 Bio and chem, 8.1 VCT through 8.7 BixBench | text |
| 35 | 34 | 9.1 Jailbreaks | text |
| 36-37 | 35-36 | 10 General output safety, 10.1, 10.2, 10.3 | text |
| 38-39 | 37-38 | 11.1 Self-harm, 12.1 MASK-Rectified, 12.2 Sycophancy | text |
| 40 | 39 | Acknowledgements | text |
| 41-42 | 40-41 | References 1-37 | text |

No page was inaccessible. The text extraction drops bar-to-label alignment on
chart pages but loses no numeric value that the rendered pages show.

### Verified claim: section 6.1

The prior ledger cites section 6.1, page 26: 1.7 percent hallucination at high
thinking effort versus 0.98 percent for Grok 4.5. The rendered page confirms
both numbers and the chart order: Opus 4.8 (max) 3.4%, Grok 4.6 (high) 1.7%,
GPT-5.5 (xhigh) 1.1%, Grok 4.5 (high) 0.98%. The benchmark is internal, scores
a single response to an information-seeking query, uses a separate grader,
and runs under the Grok Build harness. The card gives no denominator, no
interval, and no production traffic basis. Grok 4.6 is worse than Grok 4.5
on this metric. The number is not a production rate.

### Relevant evaluated claims

Source facts from the card. Comparators, effort, and limitations are as
stated by xAI. No internal evaluation gives a denominator or interval.

| Area | Result | Setup and limits |
|---|---|---|
| Agentic coding | CursorBench 3.2: 70.8% xhigh, 69.9% high, Grok 4.5 66.7%. APEX-SWE 56.4% high. FrontierCode v1.1 61.3% high on the extended 150-sample set. DeepSWE v1.1 65.9% high, 67.0% xhigh. SWE-Marathon v1.1 31.9% high. Terminal-Bench 3.0 26.0% high. | Third-party harnesses (Cursor, Mercor, Cognition, Datacurve, Abundant AI, Harbor) or Grok Build. Peer numbers taken from other providers' reports. Ranks below Opus 5 on every agentic coding suite. |
| Tool use and autonomy | Long-horizon suites above. Legal Agent Benchmark 15.8% high with six tools including Bash. An earlier checkpoint opened seven inference pull requests in five hours, three deployed. | Autonomy is presented as capability. No evaluation measures over-action, scope creep, or unsafe tool calls in a coding agent. |
| Cyber capability | CyberGym 79.7% high. CVE-Bench 39.8% high. SecureCodeReview 58.7% high. WMDP-Cyber 90.1%. | Capability suites run without production safeguards. Third-party evaluators corroborated an unrestricted configuration. |
| Cyber safeguards | HackerBench v0.2: 6.9% dual-use compliance, 0.0% benign refusal at high. Grok 4.5 7.8%. GPT-5.5 25.0%, Opus 4.8 22.8%, GPT-5.6 Sol 35.7% under their own safeguards. | Internal CTF-style suite. Standard release-tracked safeguards. Results corrected in the 2026-08-17 revision. |
| Jailbreaks | Standard jailbreaks 0.04% (Grok 4.5 0.73%). StrongReject 3.9% (Grok 4.5 1.5%). Long-horizon 1.0%. | Compliance on should-refuse attacks. StrongReject regressed. Residual failures are "cases for ongoing monitoring and patching." |
| Honesty and behavior | MASK-Rectified dishonesty 1.90% (Grok 4.5 0.67%). Sycophancy 0.04% (Grok 4.5 0.01%). | Both regressed relative to Grok 4.5. Internal suites. |
| Factuality | 1.7% hallucination high (Grok 4.5 0.98%). DeepSearchQA 81.6% high (Grok 4.5 85.3%). | Internal implementation of DeepSearchQA. Both regressed. |
| Output safety | General refusal compliance 0.93%. CSAM 0.00%. Bio and chem refusal recall 100.0%. Self-harm compliance 0.84% (Grok 4.5 0.50%). | "The evaluations and results below also apply to Grok Build." |
| Instruction following | Not evaluated as a named suite. | The card mentions "instruction" once, in the CursorBench task description. |
| Prompt injection | Not evaluated. | The card contains no occurrence of "injection." |
| Monitoring | Not evaluated. | The single occurrence of "monitoring" refers to xAI patching jailbreaks. No chain-of-thought or action monitoring result exists. |

### What the card does not establish

- Nothing about operating-system isolation, sandboxes, process lifecycle, or
  the Grok CLI's permission modes. The card does not mention `--always-approve`
  or any CLI flag.
- Nothing about this launch. The warning was emitted by Foreman's launcher
  before the model ran a single turn.
- No evidence that the model attempted or achieved an escape, and no evidence
  that it did not. The run's provider transcript was not inspected.
- Benchmark performance is not containment evidence in either direction.

### Model identity

The lane requested `-m grok-4.6`. The run's prompt event records
`requested_alias: grok-4.6` and `cli_version: grok 1.0.13 (5e9a58528b76)`.
No event records a provider-observed model id. The card lists "Grok Build" as
the CLI surface where Grok 4.6 is the default model. A prior arithmetic probe
observed a `modelUsage` key `grok-4.6-build`. That observation identifies one
past response and is not proof that every request is served by the same
backend. Keep the observed id `unknown` until a trusted provider field proves it.

### Threat-model synthesis

The Foreman threat model (security-model.md) already states that soft mode
runs implementer CLIs on the host with their native sandboxes only, and that
worker prompts are not boundaries. The card adds three facts. First, Grok 4.6
is a capable long-horizon terminal agent that xAI evaluates with Bash, file
edit, and file write tools. Second, the model's dishonesty, sycophancy,
hallucination, and StrongReject numbers all regressed relative to Grok 4.5,
so worker claims deserve at least the existing "unverified" treatment. Third,
the card measures no prompt-injection or instruction-following behavior, so
Foreman cannot cite the card as evidence that the model will honor
`--no-subagents`, `--disable-web-search`, or a spec's forbidden paths. Those
flags are CLI policy inside the same process. The kernel does not enforce them.

## D4. Claim versus evidence

| Claim (location) | Evidence | Verdict |
|---|---|---|
| "Killing the launcher for ANY reason ... makes the kernel tear down that whole namespace" (launcher/README.md, USAGE.md, orchestration-hardening.md) | Source fact: pid_namespaces(7) says the kernel SIGKILLs every process in a PID namespace when its init terminates. Experiment: the namespace is never created on this host (EPERM). | True in principle. Not active on this host. Not active on any host where Foreman runs unprivileged without a user namespace. |
| "verified unprivileged on this WSL2 host" (launcher/README.md "Availability, plainly") | Repository observation: the archived design says `wsl -u root`, the capsh drop test used `--user`, and "non-root user was NOT probed". Experiment: EPERM as uid 1000. | Contradicted by the repository's own record. |
| "Both directions were verified empirically on WSL2 (util-linux unshare 2.41.3)" (README, posix-bootstrap.ts header) | Same design record. | Verified as root only. |
| `--kill-child` closes the reverse edge (README) | Source fact: unshare(1) sends the configured signal to the forked child when unshare terminates, default SIGKILL. | True when the namespace exists. |
| Subreaper "adopts" escapees (README) | Source fact: PR_SET_CHILD_SUBREAPER(2const) reparents orphans to the subreaper and delivers SIGCHLD. It does not signal or kill them. | True. Adoption is observation, not termination. |
| Process-group kill reaps the tree in degraded mode (README, lane-run.sh) | Source fact: setsid(2) creates a new session and process group for the caller. kill(-pgid) does not reach it. Repository observation: the launcher's own child is created exactly this way. | A `setsid` or double-fork descendant escapes the group kill. The README states this correctly in its fallback ladder. |
| Launcher kills the tree on normal exit (implied by "owns a spawned command's whole process tree") | Repository observation: `launcher/src/supervise.ts` calls `closeJob` on Windows only. POSIX performs no kill after `child.exited`. | Not true on POSIX. Background descendants survive a normal round. |
| `systemd-run --scope --collect` "cleans it up (killing any remaining member processes) once the scope's main process exits" (launcher/README.md) | Source fact: systemd.scope(5) says scope units have no main process and live while at least one process exists. systemd-run(1) says `--collect` only sets `CollectMode=inactive-or-failed`, which controls unloading of the unit record. | False. `--collect` does not imply descendant termination. A scope kills members only on `systemctl stop` or `RuntimeMaxSec`. |
| A transient service would give parent-death cleanup | Source fact: systemd.service(5) `ExitType=main` stops the unit when the main process exits. systemd.kill(5) `KillMode=control-group` then SIGTERMs and, after the stop timeout, SIGKILLs every remaining cgroup member. systemd-run(1) `--wait` propagates the exit status. Experiment: `systemd-run --user --wait --pipe --collect` runs on this host and places the command under `user@1000.service/app.slice`. | Supported by documentation. Not measured for escapees on this host (see approved-test design). |
| "Local WSL host does not permit unprivileged PID namespaces" (v0.4.0 release notes) | Experiment: `unshare --user --map-current-user --pid --mount-proc --fork --kill-child` succeeds as uid 1000, inner pid 1, distinct pid namespace. | Overstated. The host permits them through a user namespace. The launcher's flag list does not request one. |
| Hosted CI denies `unshare` so the strong path is untested there (foreman-qa lessons) | Repository observation. | Consistent. With this host also degraded, the strong path is currently exercised nowhere. |
| Ownership event or heartbeat records containment | Repository observation: heartbeat keys are frozen to eight fields, the ownership payload has `launcher: true` only, and the queue has no capability vocabulary. | No consumer can see the degradation. |

## D5. Diagnostic receipt bundle

Directory: `receipts/` beside this report. All commands ran as uid 1000 from
the research directory between 02:52Z and 03:05Z on 2026-09-05. No live lane
process was signaled, traced, or inspected beyond `/proc/<pid>/status`
capability, uid, and namespace fields of `pueued`.

| File | Content |
|---|---|
| `probe-receipt.txt` | Exact probe P0, strace P1, variants P2-P9, `/proc/self/status` fields, namespace links, sysctls, LSM state, cgroup, kernel config, process tree |
| `strace-p0.txt` | Full syscall trace of the exact probe (unshare, mount, clone, execve, setns) |
| `launcher-run-receipt.txt` | Shipped binary version, digest, string check, run with inert `true`, stderr capture, heartbeat lines, pgid observation of the child |
| `strace-launcher.txt` | Syscall trace of the shipped binary: probe EPERM, `prctl(PR_SET_CHILD_SUBREAPER, 1) = 0`, `setsid()` in the child |
| `userns-cgroup-receipt.txt` | User-namespace variants U1-U6, cgroup ownership C1, transient user service shape C2 |
| `run-events-restricted.txt` | Non-heartbeat events of run `council-binding-20260905` with payloads truncated at 700 bytes |
| `hb-l1.jsonl`, `hb-l2.jsonl`, `hb-l3.jsonl`, `hb-node.jsonl` | Heartbeat files written by the inert launcher runs |
| `primary-sources/*.txt` | Local man pages used for source facts (manpages 6.17-1, util-linux 2.41.3, systemd 259) |
| `../card/acquisition.json` | Scrapling acquisition record for the model card |
| `../MANIFEST.sha256` | Digest of every file in the bundle |

Key raw lines:

```text
$ unshare --pid --mount-proc --fork --kill-child -- true
unshare: unshare failed: Operation not permitted
rc=1
strace: 335611 unshare(CLONE_NEWNS|CLONE_NEWPID) = -1 EPERM (Operation not permitted)

$ unshare --pid --fork -- true                       rc=1  (EPERM)
$ unshare --mount -- true                            rc=1  (EPERM)
$ unshare --user -- true                             rc=0
$ unshare --user --map-root-user --pid --mount-proc --fork --kill-child -- true   rc=0
$ unshare --user --map-current-user --pid --mount-proc --fork --kill-child -- sh -c '...'
uid=1000(charl) ... CapEff: 0000000000000000  pid inside=1  proc entries: 4

/proc/self/status: Uid 1000, CapEff 0, CapBnd 000001ffffffffff, NoNewPrivs 0, Seccomp 0
/proc/sys/user/max_user_namespaces = 128349
/sys/module/apparmor/parameters/enabled = N
cgroup: 0::/init.scope   cgroup2 ... nsdelegate
pueued pid 315581: CapEff 0, NoNewPrivs 0, Seccomp 0, cgroup /init.scope, same ns links

$ launcher/dist/foreman-launch --heartbeat-file hb -- true
foreman-launch: unshare unavailable/failed (availability probe) -- DEGRADED: falling back to setsid+pgid, no kernel pidns cascade guarantee
strace: 337982 unshare(CLONE_NEWNS|CLONE_NEWPID) = -1 EPERM
        337974 prctl(PR_SET_CHILD_SUBREAPER, 1) = 0
        337983 execve("/usr/bin/setsid", ["setsid", "true"], ...) = 0
        337983 setsid() = 337983

$ node skills/foreman/runtime/dist/foreman-launch.js --heartbeat-file hb -- true
foreman-launch: DEGRADED capability=posix_process_group_degraded reason=unshare_probe_failed unshare: unshare failed: Operation not permitted

$ sudo -n true ; echo rc=$?        rc=0
$ test -w /var/run/docker.sock     writable (outside and inside a user namespace)
$ systemd-run --user --wait --pipe --collect --quiet -p KillMode=control-group -- sh -c 'cat /proc/self/cgroup'
0::/user.slice/user-1000.slice/user@1000.service/app.slice/run-p338706-i339580.service
```

Same-context reproduction. `pueued` and its lanes hold the same uid,
capability sets, namespace links, and cgroup as the probing shell. The EPERM
is a deterministic capability check, so the shell result applies to the lane
context. A literal same-context reproduction would enqueue
`unshare --pid --fork -- true` in a non-lane pueue group. That changes queue
state and therefore needs operator approval. It is listed in D7.

## D6. Remedy comparison

| Remedy | Mechanism | Permissions needed | Guarantees gained | Costs and unsupported cases |
|---|---|---|---|---|
| **A. User namespace plus PID namespace** (`unshare --user --map-current-user --pid --mount-proc --fork --kill-child`) | The caller gains `CAP_SYS_ADMIN` inside a new user namespace, which is enough for `CLONE_NEWPID`, `CLONE_NEWNS`, and a private `/proc` mount. After `execve` the child runs as uid 1000 with no capabilities. | None beyond an unprivileged user. Requires `CONFIG_USER_NS`, `max_user_namespaces` above zero, and no AppArmor restriction on unprivileged user namespaces. All three hold here. | Kernel cascade on init death and on wrapper death. Private `/proc`. Setuid binaries lose privilege inside, so `sudo` fails for the worker (observed). | Larger kernel attack surface (user namespaces are a recurring CVE class). Root-owned paths appear owned by `nobody`. Supplementary groups appear unmapped, although kernel gid checks still grant access, and `docker.sock` stays writable. Ubuntu hosts with `apparmor_restrict_unprivileged_userns=1` will return EPERM. Not available on Windows. Not a filesystem or network boundary. |
| **B. Transient systemd user service** (`systemd-run --user --wait --pipe --collect -p KillMode=control-group [-p RuntimeMaxSec=...] -- foreman-launch ...`) | cgroup v2 membership is inherited by every descendant. `ExitType=main` stops the unit when the launcher exits. `KillMode=control-group` SIGTERMs then SIGKILLs every remaining member. | A running `systemd --user` instance with cgroup delegation (present: `cpu memory pids`). A DBus session. | Cleanup of setsid escapees and double-forks after normal exit, crash, timeout, and SIGKILL of the launcher. Exit status propagated by `--wait`. | `cgroup.procs` under `user@1000.service` is owned by the user, so a hostile process can move itself out. This is lifecycle hygiene, not a boundary. Requires systemd in WSL (`/etc/wsl.conf` `systemd=true`, present). Not available on Windows or on non-systemd hosts. Interaction with pueue's own kill path is unmeasured. |
| **C. Fail-closed capability gate** | The launcher or lane admission refuses to spawn an implementation command when the capability is not strong, unless the queue request carries an explicit degraded approval. | None. | Removes the silent downgrade. Makes the degradation a Setup finding. | Implementation lanes stop on this host until A or B lands. Advisory and read-only lanes need a separate rule. |
| **D. Scope with `--collect`** (current README suggestion) | None for termination. | n/a | None. | Rejected. `--collect` controls unit unloading only. |
| **E. Blanket privilege** (setuid launcher, `CAP_SYS_ADMIN` file capability, root lane) | Grants the initial-namespace capability. | Root. | Original strong path. | Rejected. Expands the worker's power far beyond containment. Contradicts the security model. |

Recommendation: A as the primary guarantee, C as policy, B as optional
belt for hosts where A is blocked. Never D or E.

## D7. Patch-ready design and test plan

Design only. No file below was changed in this session.

### Files

| Path | Change |
|---|---|
| `packages/launcher/src/platform.ts` | Replace the frozen `UNSHARE_PIDNS_FLAGS` with an ordered probe ladder: `["--user", "--map-current-user", "--pid", "--mount-proc", "--fork", "--kill-child"]` first, then the legacy privileged list for hosts that already hold `CAP_SYS_ADMIN`. Export both lists. |
| `packages/launcher/src/capability.ts` | Add kind `posix_pidns_userns_strong`. Add reasons `unshare_eperm`, `userns_blocked`, `refused_by_policy`. Add `detail` fields `exitStatus`, `stderr` (bounded to 200 bytes), and `flags` to `Degraded`. |
| `packages/launcher/src/services.ts` | `liveUnshareProbe` runs each ladder entry with `timeout 10`, captures exit status and stderr, and returns the first success with its flag list. |
| `packages/launcher/src/cli.ts` | Add `--require-containment strong|any` (default `any` for compatibility) and `--capability-file PATH`. |
| `packages/launcher/src/main.ts` | When `--require-containment strong` and the capability is not strong, write the diagnostic, write the capability JSON if requested, and exit 125 without spawning. Always write the capability JSON when the path is given. |
| `packages/launcher/src/heartbeat.ts` | Unchanged. The eight-field schema stays frozen. Capability travels in the separate file. |
| `skills/foreman/scripts/lane-run.sh` | Adapter-level only: pass `--require-containment` from `FOREMAN_CONTAINMENT_REQUIRE` and `--capability-file "$RUN_DIR/attempts/<lane>.capability.json"`. Read that file in `lane_emit_ownership` and add `containment: {kind, reason}` to the ownership payload. Emit `alert {kind: "degraded", reason: "containment_<reason>"}` once per round when the kind is not strong. Prefer `skills/foreman/runtime/dist/foreman-launch.js` (executed with `node`) in `lane_resolve_launcher` ahead of `launcher/dist/foreman-launch`, so the fix lands in the Node package and the Bun binary becomes a fallback. |
| `packages/orchestration/src/queue-admission.ts` | Accept `--containment-approval REASON` on `add`. Record it in the reservation. Without it, set `FOREMAN_CONTAINMENT_REQUIRE=strong` for groups `grok` and `codex`. |
| `skills/foreman/scripts/watch.sh` | Show `containment` from the ownership event in the state line. |
| `skills/foreman/scripts/merge-gate.sh` and `gate-eval.sh` | Record the producing lane's containment kind in the verdict line. Do not fail on it in the first release. |
| `env/tool-check.sh` and `env/reference-manifest.toml` | Add a `containment` row: run the probe ladder with `timeout 10` and report `strong (userns)`, `strong (privileged)`, or `DEGRADED (<reason>)`. Setup READY stays generic. The row makes the difference visible. |
| `launcher/README.md`, `docs/USAGE.md`, `skills/foreman/references/orchestration-hardening.md`, `skills/foreman/references/security-model.md` | Correct the claims listed in D4. |

### Typed capability states

```text
Strong        kind=posix_pidns_userns_strong | posix_pidns_strong   flags=[...]
AlreadyInner  kind as above, hostPid
Degraded      kind=posix_process_group_degraded reason=unshare_missing | unshare_eperm | userns_blocked | unshare_probe_failed | execve_unavailable | execve_failed
Refused       kind=posix_process_group_degraded reason=refused_by_policy required=strong
Degraded      kind=windows_job_object_unavailable (unchanged)
```

### Admission rules

1. Group `grok` or `codex`, action `implement`: require `Strong` unless the
   queue request carries `--containment-approval REASON`. Record the reason
   in the reservation and in the ownership event.
2. Group `gate`, action `verify`: require `Strong` or an approval. The gate
   runs the target's own test suite, which can spawn daemons.
3. Advisory or read-only commands (`--permission-mode plan`,
   `--sandbox read-only`, Council canaries): allow `Degraded`. Record it.
4. `Refused` starts no vendor process and consumes no Endstop attempt.

### Lifecycle cases to test

| Case | Expected with `Strong` | Expected with `Degraded` |
|---|---|---|
| Normal exit with a `setsid sleep 300 &` descendant | Zero survivors after the launcher exits | Survivor. Test documents the gap. |
| `--timeout` with the same descendant | Zero survivors | Survivor outside the group |
| SIGTERM to `lane-run.sh` | Zero survivors | Group members die on TERM if they honor it. Escapee survives. |
| SIGKILL to the launcher pid | Zero survivors (init death) | Whole command tree survives |
| SIGKILL to `lane-run.sh` | Launcher keeps supervising. Tree ends with the command. | Same |
| `pueue kill` of the task | Zero survivors | Unmeasured. pueue's signal target is not documented here. |
| Double fork | Zero survivors | Survivor |

### Tests

- `packages/launcher/src/platform.test.ts`: pure ladder ordering and argv shape.
- `packages/launcher/src/capability.test.ts`: every reason maps to a closed kind.
- `packages/launcher/src/supervise.test.ts`: host-gated strong cases, skipped
  with a recorded reason where the ladder fails.
- `packages/launcher/src/cli.test.ts`: `--require-containment strong` exits
  125 with no spawn when the injected probe fails.
- `tests/lane-run.bats`: ownership payload carries `containment`, refusal
  emits no `prompt` event, approval string is recorded.
- Destructive descendant-survival suite (approval required, see below).

### Experiments that need operator approval

| Experiment | Ownership and bounds | Cleanup | Expected | Approval |
|---|---|---|---|---|
| Same-context probe through pueue | `pueue add -g misc -- timeout 10 unshare --pid --fork -- true` | Task removed with `pueue remove` | Exit 1, EPERM | Changes queue state. |
| Descendant survival, strong ladder | A disposable `sh -c 'setsid sleep 120 &'` under the launcher with the new flags, pid recorded before spawn, `timeout 180` on the outer command | `pgrep -f` the recorded marker, `kill` only pids the test created | Zero survivors | Sends SIGKILL to test-owned processes. |
| Descendant survival, degraded | Same command under the current binary | Same | One survivor, then killed by the test | Same |
| Transient service cleanup | `systemd-run --user --wait --pipe --collect -p KillMode=control-group -p TimeoutStopSec=5 -- sh -c 'setsid sleep 120 & exit 0'` | `systemctl --user stop` of the unit if it lingers | Zero survivors after 5 seconds | Creates a transient unit. |
| cgroup escape check | Inside the transient service, write own pid to `../cgroup.procs` | Same | Success, which proves B is not a boundary | Same |

### Rollback

Set `FOREMAN_CONTAINMENT_REQUIRE=any` and remove the `--containment-approval`
requirement in the queue. The Bun binary remains the fallback resolver target
until the Node launcher's parity is measured, so reverting the resolver order
restores today's behavior exactly.

## D8. Handoff

Findings:

- The warning is a real, deterministic capability failure: `unshare(2)` needs
  `CAP_SYS_ADMIN` and the lane has none. The launcher's flag list omits the
  user namespace that would supply it. The same command with
  `--user --map-current-user` succeeds on this host.
- The strong path was verified as root in July 2026 and has been degraded
  since Foreman moved to an unprivileged user. Every POSIX round since then
  ran with process-group cleanup only. No event records this.
- Degraded and strong modes give the same security posture: none beyond the
  CLI. The worker runs as `charl` with passwordless `sudo`, docker socket
  access, host network, and every namespace shared.
- The README's `systemd-run --scope --collect` remedy does not kill anything.
- The Grok 4.6 card contains no evaluation of OS isolation, prompt injection,
  or instruction following, and several behavior metrics regressed from Grok
  4.5. The 1.7% versus 0.98% hallucination claim is confirmed on printed page
  26 and is an internal single-response metric, not a production rate.

Evidence paths: this directory, `receipts/`, `card/`, `MANIFEST.sha256`.

Commands to reproduce the core finding:

```bash
strace -f -e trace=unshare -o /tmp/p.txt unshare --pid --mount-proc --fork --kill-child -- true
grep unshare /tmp/p.txt
unshare --user --map-current-user --pid --mount-proc --fork --kill-child -- sh -c 'echo pid=$$'
```

Blockers: none for the fix. Actions that need operator approval: the five
experiments in D7, the queue-state probe, and any change to the launcher
resolver order.

Recommendation on the Grok implementation mode: **require explicit
degraded-mode approval now, fail closed by default once the flag fix lands.**
The degradation does not create new data exposure, so an immediate stop is not
required. It does remove every cleanup guarantee the documentation promises,
so an unapproved silent continuation is not defensible either.

## Implementation status (same day)

The D7 design landed on 2026-09-05 in three rounds, each implemented by the
Codex lane and verified by the architect:

- `packages/launcher`: user-namespace probe ladder, capability record,
  `--probe-only`, `--capability-file`, `--require-containment`, exec-arg
  carry-over across the self re-exec. On this host the Node launcher now
  reports `capability=posix_pidns_userns_strong` and runs the child as pid 1
  of a distinct PID namespace.
- `packages/orchestration`: `lane-queue.sh add --containment-approval REASON`
  and the `containment` tool-inventory row.
- `lane-run.sh` and `watch.sh`: per-round probe, `containment` in the
  `ownership` event, degraded alert, refusal for implementation lanes, and
  the capability-aware kill target.

Not done: the destructive descendant-survival tests, the transient-service
cleanup test, the cgroup escape check, and the same-context pueue probe. They
still need operator approval. The Bun binary is unchanged and remains the
fallback under `FOREMAN_LAUNCH_IMPL=bun`.
