// coverage: skills/foreman/scripts/gate-eval.sh
// coverage: skills/foreman/scripts/audit-run.sh
// coverage: skills/foreman/scripts/checks-run.sh
// coverage: skills/foreman/scripts/docs-check.sh
// coverage: skills/foreman/scripts/wt-merge.sh
// See formal/coverage.tsv for the drift gate.
// Foreman audit -> verdict -> gate -> merge decision model.
// M3 round 2 models routing and freshness for every merge-authorizing artifact.
//
// `boundDiff` is ghost/oracle provenance. The pre-fix gate deliberately ignores
// it, exactly as gate-eval.sh ignores which diff an on-disk verdict describes.
module audit_gate {
  type Verdict = APPROVED | WARNING | BLOCKED | UNVERIFIED
  type Cli = ClaudeCli | CodexCli | GrokCli | AgyCli
  type Family = Anthropic | OpenAI | XAI | Google

  type VerdictFile =
    | NoVerdict
    | VerdictPresent({ verdict: Verdict, boundDiff: int })

  type ArtifactStatus = ArtifactPass | ArtifactFail

  type CheckArtifact =
    | NoArtifact
    | ArtifactPresent({ status: ArtifactStatus, boundDiff: int })

  type Phase =
    | AwaitAudit
    | AwaitGate
    | AwaitFreshness
    | ReadyToMerge
    | NeedsRework
    | Done
    | Abandoned

  type GateReason =
    | GateNotRun
    | GatePassed
    | GateBlocked
    | GateUnverified
    | GateMissingVerdict
    | GateHashMismatch
    | GateSameFamily
    | GateChecksFailed
    | GateDocsFailed
    | GateChecksHashMismatch
    | GateDocsHashMismatch
    | GateBaseStale

  type AuditFailureReason =
    | NoAuditFailure
    | CliMissing
    | CliUnauthenticated
    | VendorMismatch
    | SchemaMissing
    | NonzeroExit
    | EmptyOutput
    | NoJsonObject
    | OutOfEnum
    | WorktreeMutation

  type MergeFreshness = MERGEABLE | NOT_MERGEABLE

  // Configuration flags. MAX_AUDIT_ATTEMPTS = 0 means deliberately uncapped.
  const BIND_CONTENT_HASH: bool
  const CHECKS_BIND_CONTENT_HASH: bool
  const ALWAYS_WRITE_VERDICT: bool
  const FAMILY_LEVEL_CHECK: bool
  const MAX_REWORK_ROUNDS: int
  const MAX_AUDIT_ATTEMPTS: int
  const ALWAYS_AUDIT_ERROR: bool
  const ALLOW_POST_GATE_MUTATION: bool
  const MERGE_BASE_MAX_COMMITS: int

  var diff: int
  var verdictFile: VerdictFile
  var checksFile: CheckArtifact
  var docsFile: CheckArtifact
  var round: int
  var merged: bool
  var mergedDiff: int
  var authorizingDiff: int
  var authorizingVerdict: Verdict
  var phase: Phase
  var auditAttempts: int
  var workerCli: Cli
  var auditCli: Cli
  var workerFamily: Family
  var auditFamily: Family
  var originDistance: int
  var mergeFreshness: MergeFreshness
  var mergeOriginDistance: int
  var gateReason: GateReason
  var auditFailureReason: AuditFailureReason

  pure def cliResolvesTo(cli: Cli, family: Family): bool =
    match cli {
      | ClaudeCli => family == Anthropic
      | CodexCli => family == OpenAI
      | GrokCli => family == XAI
      | AgyCli =>
          family == Anthropic or family == OpenAI or family == Google
    }

  pure def routeAllowed(
    workerC: Cli,
    auditorC: Cli,
    workerF: Family,
    auditorF: Family
  ): bool =
    if (FAMILY_LEVEL_CHECK) {
      workerF != auditorF
    } else {
      workerC != auditorC
    }

  pure def modelMayEmit(verdict: Verdict): bool =
    verdict == APPROVED or verdict == WARNING or verdict == BLOCKED

  pure def verdictAllowsMerge(verdict: Verdict): bool =
    verdict == APPROVED or verdict == WARNING

  pure def fileVerdict(file: VerdictFile): Verdict =
    match file {
      | NoVerdict => UNVERIFIED
      | VerdictPresent(record) => record.verdict
    }

  pure def fileBoundDiff(file: VerdictFile): int =
    match file {
      | NoVerdict => -1
      | VerdictPresent(record) => record.boundDiff
    }

  pure def artifactPasses(file: CheckArtifact): bool =
    match file {
      | NoArtifact => false
      | ArtifactPresent(record) => record.status == ArtifactPass
    }

  pure def artifactBoundDiff(file: CheckArtifact): int =
    match file {
      | NoArtifact => -1
      | ArtifactPresent(record) => record.boundDiff
    }

  def contentBindingPasses(file: VerdictFile): bool =
    if (BIND_CONTENT_HASH) {
      fileBoundDiff(file) == diff
    } else {
      true
    }

  def checkArtifactBindingPasses(file: CheckArtifact): bool =
    if (CHECKS_BIND_CONTENT_HASH) {
      artifactBoundDiff(file) == diff
    } else {
      true
    }

  def attemptAvailable: bool =
    MAX_AUDIT_ATTEMPTS == 0 or auditAttempts < MAX_AUDIT_ATTEMPTS

  action init = {
    nondet wc = Set(ClaudeCli, CodexCli, GrokCli, AgyCli).oneOf()
    nondet ac = Set(ClaudeCli, CodexCli, GrokCli, AgyCli).oneOf()
    nondet wf = Set(Anthropic, OpenAI, XAI, Google).oneOf()
    nondet af = Set(Anthropic, OpenAI, XAI, Google).oneOf()
    all {
      cliResolvesTo(wc, wf),
      cliResolvesTo(ac, af),
      routeAllowed(wc, ac, wf, af),
      diff' = 0,
      verdictFile' = NoVerdict,
      // Begin after round-zero checks/docs have passed and left their stable
      // run-directory artifacts. Later attempts may refresh or preserve them.
      checksFile' =
        ArtifactPresent({ status: ArtifactPass, boundDiff: 0 }),
      docsFile' =
        ArtifactPresent({ status: ArtifactPass, boundDiff: 0 }),
      round' = 0,
      merged' = false,
      mergedDiff' = -1,
      authorizingDiff' = -1,
      authorizingVerdict' = UNVERIFIED,
      phase' = AwaitAudit,
      auditAttempts' = 0,
      workerCli' = wc,
      auditCli' = ac,
      workerFamily' = wf,
      auditFamily' = af,
      originDistance' = 0,
      mergeFreshness' = NOT_MERGEABLE,
      mergeOriginDistance' = -1,
      gateReason' = GateNotRun,
      auditFailureReason' = NoAuditFailure,
    }
  }

  // The auditing model can choose only the original three outcomes.
  action auditSuccess = {
    nondet judgment =
      Set(APPROVED, WARNING, BLOCKED).oneOf()
    all {
      phase == AwaitAudit,
      attemptAvailable,
      not(ALWAYS_AUDIT_ERROR),
      modelMayEmit(judgment),
      diff' = diff,
      verdictFile' =
        VerdictPresent({ verdict: judgment, boundDiff: diff }),
      checksFile' = checksFile,
      docsFile' = docsFile,
      round' = round,
      merged' = merged,
      mergedDiff' = mergedDiff,
      authorizingDiff' = authorizingDiff,
      authorizingVerdict' = authorizingVerdict,
      phase' = AwaitGate,
      auditAttempts' = auditAttempts + 1,
      workerCli' = workerCli,
      auditCli' = auditCli,
      workerFamily' = workerFamily,
      auditFamily' = auditFamily,
      originDistance' = originDistance,
      mergeFreshness' = mergeFreshness,
      mergeOriginDistance' = mergeOriginDistance,
      gateReason' = GateNotRun,
      auditFailureReason' = NoAuditFailure,
    }
  }

  // All concrete die paths have the same persistence semantics. The reason is
  // still nondeterministic so each real failure class remains represented.
  action auditFailure = {
    nondet failure = Set(
      CliMissing,
      CliUnauthenticated,
      VendorMismatch,
      SchemaMissing,
      NonzeroExit,
      EmptyOutput,
      NoJsonObject,
      OutOfEnum,
      WorktreeMutation
    ).oneOf()
    all {
      phase == AwaitAudit,
      attemptAvailable,
      diff' = diff,
      verdictFile' =
        if (ALWAYS_WRITE_VERDICT) {
          VerdictPresent({ verdict: UNVERIFIED, boundDiff: diff })
        } else {
          verdictFile
        },
      checksFile' = checksFile,
      docsFile' = docsFile,
      round' = round,
      merged' = merged,
      mergedDiff' = mergedDiff,
      authorizingDiff' = authorizingDiff,
      authorizingVerdict' = authorizingVerdict,
      phase' = AwaitGate,
      auditAttempts' = auditAttempts + 1,
      workerCli' = workerCli,
      auditCli' = auditCli,
      workerFamily' = workerFamily,
      auditFamily' = auditFamily,
      originDistance' = originDistance,
      mergeFreshness' = mergeFreshness,
      mergeOriginDistance' = mergeOriginDistance,
      gateReason' = GateNotRun,
      auditFailureReason' = failure,
    }
  }

  // checks-run.sh can fail before its final jq replacement (configuration,
  // required-command, temp/archive setup), preserving a prior round's file.
  action checksFailureBeforeWrite = all {
    phase == AwaitAudit,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  // A completed failing check command does reach the jq write and replaces the
  // artifact with a current-diff failure record.
  action checksFailureAfterWrite = all {
    phase == AwaitAudit,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' =
      ArtifactPresent({ status: ArtifactFail, boundDiff: diff }),
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  action checksSuccess = all {
    phase == AwaitAudit,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' =
      ArtifactPresent({ status: ArtifactPass, boundDiff: diff }),
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  // docs-check.sh normally writes pass/fail JSON before exiting, but setup and
  // output-production failures can occur before that replacement.
  action docsFailureBeforeWrite = all {
    phase == AwaitAudit,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  action docsFailureAfterWrite = all {
    phase == AwaitAudit,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' =
      ArtifactPresent({ status: ArtifactFail, boundDiff: diff }),
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  action docsSuccess = all {
    phase == AwaitAudit,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' =
      ArtifactPresent({ status: ArtifactPass, boundDiff: diff }),
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  // Rework mints a fresh content-hash id. Other gate inputs or architect
  // judgment may request it even after an APPROVED audit.
  action rework = all {
    phase == AwaitGate or phase == NeedsRework,
    fileVerdict(verdictFile) != UNVERIFIED,
    round < MAX_REWORK_ROUNDS,
    diff' = diff + 1,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round + 1,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = AwaitAudit,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateNotRun,
    auditFailureReason' = NoAuditFailure,
  }

  action gateAccept = all {
    phase == AwaitGate,
    verdictFile != NoVerdict,
    verdictAllowsMerge(fileVerdict(verdictFile)),
    contentBindingPasses(verdictFile),
    artifactPasses(checksFile),
    artifactPasses(docsFile),
    checkArtifactBindingPasses(checksFile),
    checkArtifactBindingPasses(docsFile),
    routeAllowed(workerCli, auditCli, workerFamily, auditFamily),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = fileBoundDiff(verdictFile),
    authorizingVerdict' = fileVerdict(verdictFile),
    phase' = AwaitFreshness,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GatePassed,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectBlocked = all {
    phase == AwaitGate,
    verdictFile != NoVerdict,
    fileVerdict(verdictFile) == BLOCKED,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = NeedsRework,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateBlocked,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectUnverified = all {
    phase == AwaitGate,
    verdictFile != NoVerdict,
    fileVerdict(verdictFile) == UNVERIFIED,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' =
      if (MAX_AUDIT_ATTEMPTS > 0 and auditAttempts >= MAX_AUDIT_ATTEMPTS) {
        Abandoned
      } else {
        AwaitAudit
      },
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateUnverified,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectMissing = all {
    phase == AwaitGate,
    verdictFile == NoVerdict,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' =
      if (MAX_AUDIT_ATTEMPTS > 0 and auditAttempts >= MAX_AUDIT_ATTEMPTS) {
        Abandoned
      } else {
        AwaitAudit
      },
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateMissingVerdict,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectHashMismatch = all {
    phase == AwaitGate,
    verdictFile != NoVerdict,
    verdictAllowsMerge(fileVerdict(verdictFile)),
    not(contentBindingPasses(verdictFile)),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = AwaitAudit,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateHashMismatch,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectSameFamily = all {
    phase == AwaitGate,
    not(routeAllowed(workerCli, auditCli, workerFamily, auditFamily)),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = Abandoned,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateSameFamily,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectChecks = all {
    phase == AwaitGate,
    verdictAllowsMerge(fileVerdict(verdictFile)),
    not(artifactPasses(checksFile)),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = Abandoned,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateChecksFailed,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectDocs = all {
    phase == AwaitGate,
    verdictAllowsMerge(fileVerdict(verdictFile)),
    not(artifactPasses(docsFile)),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = Abandoned,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateDocsFailed,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectChecksHashMismatch = all {
    phase == AwaitGate,
    verdictAllowsMerge(fileVerdict(verdictFile)),
    artifactPasses(checksFile),
    not(checkArtifactBindingPasses(checksFile)),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = AwaitAudit,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateChecksHashMismatch,
    auditFailureReason' = auditFailureReason,
  }

  action gateRejectDocsHashMismatch = all {
    phase == AwaitGate,
    verdictAllowsMerge(fileVerdict(verdictFile)),
    artifactPasses(docsFile),
    not(checkArtifactBindingPasses(docsFile)),
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = AwaitAudit,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = GateDocsHashMismatch,
    auditFailureReason' = auditFailureReason,
  }

  action checkMergeFreshness = all {
    phase == AwaitFreshness,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' =
      if (originDistance <= MERGE_BASE_MAX_COMMITS) {
        ReadyToMerge
      } else {
        Abandoned
      },
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' =
      if (originDistance <= MERGE_BASE_MAX_COMMITS) {
        MERGEABLE
      } else {
        NOT_MERGEABLE
      },
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' =
      if (originDistance <= MERGE_BASE_MAX_COMMITS) {
        gateReason
      } else {
        GateBaseStale
      },
    auditFailureReason' = auditFailureReason,
  }

  // A concurrent fetch can move local origin/main after checkMergeFreshness and
  // before wt-merge.sh. This makes the script boundary's TOCTOU explicit.
  action advanceOrigin = all {
    phase == AwaitFreshness or phase == ReadyToMerge,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance + 1,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  // Separate configuration used only to expose the analogous diff TOCTOU.
  action mutateDiffAfterGate = all {
    ALLOW_POST_GATE_MUTATION,
    phase == AwaitFreshness or phase == ReadyToMerge,
    diff' = diff + 1,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  action merge = all {
    phase == ReadyToMerge,
    mergeFreshness == MERGEABLE,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = true,
    mergedDiff' = diff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = Done,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = originDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  action terminal = all {
    phase == Done or phase == Abandoned,
    diff' = diff,
    verdictFile' = verdictFile,
    checksFile' = checksFile,
    docsFile' = docsFile,
    round' = round,
    merged' = merged,
    mergedDiff' = mergedDiff,
    authorizingDiff' = authorizingDiff,
    authorizingVerdict' = authorizingVerdict,
    phase' = phase,
    auditAttempts' = auditAttempts,
    workerCli' = workerCli,
    auditCli' = auditCli,
    workerFamily' = workerFamily,
    auditFamily' = auditFamily,
    originDistance' = originDistance,
    mergeFreshness' = mergeFreshness,
    mergeOriginDistance' = mergeOriginDistance,
    gateReason' = gateReason,
    auditFailureReason' = auditFailureReason,
  }

  action step = any {
    checksSuccess,
    checksFailureBeforeWrite,
    checksFailureAfterWrite,
    docsSuccess,
    docsFailureBeforeWrite,
    docsFailureAfterWrite,
    auditSuccess,
    auditFailure,
    rework,
    gateAccept,
    gateRejectBlocked,
    gateRejectUnverified,
    gateRejectMissing,
    gateRejectHashMismatch,
    gateRejectSameFamily,
    gateRejectChecks,
    gateRejectDocs,
    gateRejectChecksHashMismatch,
    gateRejectDocsHashMismatch,
    checkMergeFreshness,
    advanceOrigin,
    mutateDiffAfterGate,
    merge,
    terminal,
  }

  // Required safety properties.
  val no_unaudited_merge =
    not(merged) or mergedDiff == authorizingDiff

  val no_merge_on_blocked_or_unverified =
    not(merged) or (
      authorizingVerdict != BLOCKED and authorizingVerdict != UNVERIFIED
    )

  val cross_vendor_family_distinct =
    workerFamily != auditFamily

  val no_same_family_authorized_merge =
    not(merged) or workerFamily != auditFamily

  val checksBoundDiff = artifactBoundDiff(checksFile)

  val docsBoundDiff = artifactBoundDiff(docsFile)

  val no_unverified_checks_merge =
    not(merged) or checksBoundDiff == mergedDiff

  val no_unverified_docs_merge =
    not(merged) or docsBoundDiff == mergedDiff

  val rework_rounds_bounded =
    round <= MAX_REWORK_ROUNDS

  // The configured cap is distinct from MAX_REWORK_ROUNDS. Zero selects the
  // deliberately uncapped configuration, where bounded_by_three is violated.
  val audit_attempts_at_most_cap =
    MAX_AUDIT_ATTEMPTS == 0 or auditAttempts <= MAX_AUDIT_ATTEMPTS

  val audit_attempts_bounded_by_three =
    auditAttempts <= 3

  // Diagnostic properties/witnesses.
  val naive_cli_check_implies_family_distinct =
    workerCli == auditCli or workerFamily != auditFamily

  val no_warning_authorized_merge =
    not(merged) or authorizingVerdict != WARNING

  val no_stale_approved_merge =
    not(merged and authorizingVerdict == APPROVED) or
      mergedDiff == authorizingDiff

  val no_merge_beyond_freshness_bound =
    not(merged) or mergeOriginDistance <= MERGE_BASE_MAX_COMMITS

  val task_not_abandoned =
    phase != Abandoned

  val gate_hash_mismatch_unreachable =
    gateReason != GateHashMismatch
}

// Current behavior: failed audits leave the stable run directory untouched,
// and routing compares CLI names. MAX_AUDIT_ATTEMPTS is absent.
module pre_fix {
  import audit_gate(
    BIND_CONTENT_HASH = false,
    CHECKS_BIND_CONTENT_HASH = false,
    ALWAYS_WRITE_VERDICT = false,
    FAMILY_LEVEL_CHECK = false,
    MAX_REWORK_ROUNDS = 3,
    MAX_AUDIT_ATTEMPTS = 0,
    ALWAYS_AUDIT_ERROR = false,
    ALLOW_POST_GATE_MUTATION = false,
    MERGE_BASE_MAX_COMMITS = 2
  ).*
}

// Specified repair: content binding, harness-written UNVERIFIED, family routing,
// and a separate finite audit-attempt cap.
module post_fix {
  import audit_gate(
    BIND_CONTENT_HASH = true,
    CHECKS_BIND_CONTENT_HASH = false,
    ALWAYS_WRITE_VERDICT = true,
    FAMILY_LEVEL_CHECK = true,
    MAX_REWORK_ROUNDS = 3,
    MAX_AUDIT_ATTEMPTS = 3,
    ALWAYS_AUDIT_ERROR = false,
    ALLOW_POST_GATE_MUTATION = false,
    MERGE_BASE_MAX_COMMITS = 2
  ).*
}

// Liveness experiment: every audit errors, and no infrastructure-attempt cap.
module uncapped_errors {
  import audit_gate(
    BIND_CONTENT_HASH = true,
    CHECKS_BIND_CONTENT_HASH = false,
    ALWAYS_WRITE_VERDICT = true,
    FAMILY_LEVEL_CHECK = true,
    MAX_REWORK_ROUNDS = 3,
    MAX_AUDIT_ATTEMPTS = 0,
    ALWAYS_AUDIT_ERROR = true,
    ALLOW_POST_GATE_MUTATION = false,
    MERGE_BASE_MAX_COMMITS = 2
  ).*
}

// Same experiment with the required independent cap.
module capped_errors {
  import audit_gate(
    BIND_CONTENT_HASH = true,
    CHECKS_BIND_CONTENT_HASH = false,
    ALWAYS_WRITE_VERDICT = true,
    FAMILY_LEVEL_CHECK = true,
    MAX_REWORK_ROUNDS = 3,
    MAX_AUDIT_ATTEMPTS = 3,
    ALWAYS_AUDIT_ERROR = true,
    ALLOW_POST_GATE_MUTATION = false,
    MERGE_BASE_MAX_COMMITS = 2
  ).*
}

// Adversarial boundary check: the diff changes after gate-eval recomputes the
// hash but before wt-merge.sh commits and squash-merges worker changes.
module post_fix_toctou {
  import audit_gate(
    BIND_CONTENT_HASH = true,
    CHECKS_BIND_CONTENT_HASH = false,
    ALWAYS_WRITE_VERDICT = true,
    FAMILY_LEVEL_CHECK = true,
    MAX_REWORK_ROUNDS = 3,
    MAX_AUDIT_ATTEMPTS = 3,
    ALWAYS_AUDIT_ERROR = false,
    ALLOW_POST_GATE_MUTATION = true,
    MERGE_BASE_MAX_COMMITS = 2
  ).*
}

// Complete repair: verdict, independent-check, and docs-check artifacts are all
// bound to the diff whose merge they authorize.
module post_fix_full_binding {
  import audit_gate(
    BIND_CONTENT_HASH = true,
    CHECKS_BIND_CONTENT_HASH = true,
    ALWAYS_WRITE_VERDICT = true,
    FAMILY_LEVEL_CHECK = true,
    MAX_REWORK_ROUNDS = 3,
    MAX_AUDIT_ATTEMPTS = 3,
    ALWAYS_AUDIT_ERROR = false,
    ALLOW_POST_GATE_MUTATION = false,
    MERGE_BASE_MAX_COMMITS = 2
  ).*
}
