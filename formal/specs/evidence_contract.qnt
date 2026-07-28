// Foreman evidence-contract model (M4).
//
// The state machine isolates five acceptance-boundary targets reported in
// docs/research/vnext/REAUDIT-codex.md. Four yield current-spec counterexamples;
// D4 instead reaches the refusal already required by the normative prose.
// Hashes, paths, attempts, and Git object ids are opaque finite ids: only
// equality matters to these predicates.
//
// `pre_fix` encodes the current evidence-contract requirements at their
// underspecified seams. `post_fix` adds:
//   * current-attempt, complete, five-field artifact binding;
//   * separate reviewed-tree and external-report roots; and
//   * an explicit absence identity for deletions.
//
// Porcelain remains deliberately incomplete in both configurations. The
// repaired contract does not try to make it authoritative.
module evidence_contract {
  type LaneType = Implement | Audit | Planning
  type Phase = BeforeDispatch | Dispatched | Finished | Refused
  type WorkKind =
    | NoWork
    | WriteAssigned
    | DeleteAssigned
    | RewriteUntracked
    | AddNestedUntracked

  type Root = ReviewedWorktree | ExternalRunDirectory
  type EvidenceResult = EvidenceNotRun | EvidenceChanged | EvidenceInconclusive
  type RoundResult = RoundPending | RoundSuccess | RoundFailure

  type Artifact = {
    exists: bool,
    nonEmpty: bool,
    modelSchemaValid: bool,
    harnessSchemaValid: bool,
    complete: bool,
    contentId: int,
    attempt: int,
    diffId: int,
    treeId: int,
    baseId: int,
    headId: int,
  }

  type State = {
    phase: Phase,
    lane: LaneType,

    // Declaration metadata is ghost state used to state what "resolved from
    // the assignment before dispatch" means.
    declaredNonEmpty: bool,
    declaredBeforeDispatch: bool,
    declaredMatchesAssignment: bool,
    artifactWasSatisfiedBeforeRound: bool,

    currentAttempt: int,
    currentDiff: int,
    currentTree: int,
    currentBase: int,
    currentHead: int,
    preArtifactContentId: int,
    artifact: Artifact,

    reviewedRoot: Root,
    reportRoot: Root,
    reviewedTreeChanged: bool,
    validatorZero: bool,
    positiveControlPassed: bool,

    work: WorkKind,
    porcelainChanged: bool,
    contentDigestChanged: bool,
    treeDigestDefined: bool,
    evidenceResult: EvidenceResult,
    roundResult: RoundResult,
  }

  const REQUIRE_CURRENT_ARTIFACT: bool
  const SPLIT_AUDIT_ROOTS: bool
  const ENCODE_DELETION_ABSENCE: bool
  const PORCELAIN_UALL: bool

  var state: State

  pure def emptyArtifact: Artifact = {
    exists: false,
    nonEmpty: false,
    modelSchemaValid: false,
    harnessSchemaValid: false,
    complete: false,
    contentId: 0,
    attempt: 0,
    diffId: 0,
    treeId: 0,
    baseId: 0,
    headId: 0,
  }

  pure def staleValidArtifact: Artifact = {
    exists: true,
    nonEmpty: true,
    modelSchemaValid: true,
    harnessSchemaValid: true,
    complete: true,
    contentId: 1,
    attempt: 0,
    diffId: 0,
    treeId: 0,
    baseId: 0,
    headId: 0,
  }

  pure def inProgressArtifact(
    attemptId: int,
    diffId: int,
    treeId: int,
    baseId: int,
    headId: int
  ): Artifact = {
    exists: true,
    nonEmpty: true,
    // The harness artifact is structurally valid, but UNVERIFIED/state are
    // deliberately outside adapters/verdict.schema.json.
    modelSchemaValid: false,
    harnessSchemaValid: true,
    complete: false,
    contentId: 2,
    attempt: attemptId,
    diffId: diffId,
    treeId: treeId,
    baseId: baseId,
    headId: headId,
  }

  pure def currentCompleteArtifact(s: State): Artifact = {
    exists: true,
    nonEmpty: true,
    modelSchemaValid: true,
    harnessSchemaValid: true,
    complete: true,
    contentId: 3,
    attempt: s.currentAttempt,
    diffId: s.currentDiff,
    treeId: s.currentTree,
    baseId: s.currentBase,
    headId: s.currentHead,
  }

  pure def isGitRoot(root: Root): bool =
    root == ReviewedWorktree

  pure def isOutsideReviewedTree(root: Root): bool =
    root == ExternalRunDirectory

  pure def artifactBoundToCurrentRound(s: State): bool =
    and {
      s.artifact.complete,
      s.artifact.contentId != s.preArtifactContentId,
      s.artifact.attempt == s.currentAttempt,
      s.artifact.diffId == s.currentDiff,
      s.artifact.treeId == s.currentTree,
      s.artifact.baseId == s.currentBase,
      s.artifact.headId == s.currentHead,
    }

  pure def baseArtifactAssertion(s: State): bool =
    match s.lane {
      | Implement =>
          s.contentDigestChanged and s.validatorZero
      | Audit =>
          and {
            s.artifact.exists,
            s.artifact.modelSchemaValid,
            not(s.reviewedTreeChanged),
          }
      | Planning =>
          and {
            s.artifact.exists,
            s.artifact.nonEmpty,
            s.validatorZero,
          }
    }

  pure def laneContractPasses(s: State): bool =
    and {
      s.positiveControlPassed,
      baseArtifactAssertion(s),
      if (REQUIRE_CURRENT_ARTIFACT and
          (s.lane == Audit or s.lane == Planning)) {
        artifactBoundToCurrentRound(s)
      } else {
        true
      },
    }

  pure def declarationSound(s: State): bool =
    and {
      s.declaredNonEmpty,
      s.declaredBeforeDispatch,
      s.declaredMatchesAssignment,
    }

  pure def auditRootContractSatisfiable(s: State): bool =
    and {
      isGitRoot(s.reviewedRoot),
      isOutsideReviewedTree(s.reportRoot),
      if (SPLIT_AUDIT_ROOTS) {
        // The reviewed tree uses Git-aware tree identity; the external report
        // is hashed directly and therefore need not itself be a Git root.
        true
      } else {
        // Current prose assigns the external report location as "the evidence
        // root", while the generic digest requires that root to be a worktree.
        isGitRoot(s.reportRoot)
      },
    }

  pure def workOccurred(work: WorkKind): bool =
    work != NoWork

  pure def authoritativeDigestObserved(s: State): bool =
    if (s.work == DeleteAssigned) {
      ENCODE_DELETION_ABSENCE and s.treeDigestDefined and
        s.contentDigestChanged
    } else if (workOccurred(s.work)) {
      s.contentDigestChanged
    } else {
      not(s.contentDigestChanged)
    }

  action init = all {
    state' = {
      phase: BeforeDispatch,
      lane: Planning,
      declaredNonEmpty: false,
      declaredBeforeDispatch: false,
      declaredMatchesAssignment: false,
      artifactWasSatisfiedBeforeRound: false,
      currentAttempt: 1,
      currentDiff: 1,
      currentTree: 1,
      currentBase: 1,
      currentHead: 1,
      preArtifactContentId: 0,
      artifact: emptyArtifact,
      reviewedRoot: ReviewedWorktree,
      reportRoot: ExternalRunDirectory,
      reviewedTreeChanged: false,
      validatorZero: false,
      positiveControlPassed: true,
      work: NoWork,
      porcelainChanged: false,
      contentDigestChanged: false,
      treeDigestDefined: true,
      evidenceResult: EvidenceNotRun,
      roundResult: RoundPending,
    }
  }

  // D1: a planning lane starts with a complete package from attempt zero.
  // The declaration is otherwise correct and timely.
  action dispatchPlanningWithStaleArtifact = all {
    state.phase == BeforeDispatch,
    state' = {
      ...state,
      phase: Dispatched,
      lane: Planning,
      declaredNonEmpty: true,
      declaredBeforeDispatch: true,
      declaredMatchesAssignment: true,
      artifactWasSatisfiedBeforeRound: true,
      preArtifactContentId: 1,
      artifact: staleValidArtifact,
      validatorZero: true,
    },
  }

  // New cross-spec seam: audit-run.sh is required to publish this artifact
  // before spawning the auditor. Schema validity and "file changed" alone
  // would credit the auditor even though no judgment completed.
  action dispatchAuditWithPrepublishedArtifact = all {
    state.phase == BeforeDispatch,
    state' = {
      ...state,
      phase: Dispatched,
      lane: Audit,
      declaredNonEmpty: true,
      declaredBeforeDispatch: true,
      declaredMatchesAssignment: true,
      artifactWasSatisfiedBeforeRound: false,
      artifact: inProgressArtifact(
        state.currentAttempt,
        state.currentDiff,
        state.currentTree,
        state.currentBase,
        state.currentHead
      ),
      validatorZero: true,
    },
  }

  // D2: this is the actual Foreman topology represented in the source specs:
  // the reviewed tree is Git-backed and the stable external run directory is
  // not. No third, external Git worktree is assumed to exist.
  action dispatchAuditToExternalRunDirectory = all {
    state.phase == BeforeDispatch,
    state' = {
      ...state,
      phase: Dispatched,
      lane: Audit,
      declaredNonEmpty: true,
      declaredBeforeDispatch: true,
      declaredMatchesAssignment: true,
      artifactWasSatisfiedBeforeRound: false,
      artifact: emptyArtifact,
      reviewedRoot: ReviewedWorktree,
      reportRoot: ExternalRunDirectory,
    },
  }

  action dispatchImplementDeletion = all {
    state.phase == BeforeDispatch,
    state' = {
      ...state,
      phase: Dispatched,
      lane: Implement,
      declaredNonEmpty: true,
      declaredBeforeDispatch: true,
      declaredMatchesAssignment: true,
      artifactWasSatisfiedBeforeRound: true,
      preArtifactContentId: 1,
      artifact: staleValidArtifact,
      validatorZero: true,
    },
  }

  // D4 attempted bad declaration. The current normative specification already
  // requires assignment derivation and refuses dispatch, so this transition
  // records a configuration error instead of admitting a dispatched round.
  action refusePlanningWithWrongSet = all {
    state.phase == BeforeDispatch,
    state' = {
      ...state,
      phase: Refused,
      lane: Planning,
      declaredNonEmpty: true,
      declaredBeforeDispatch: true,
      declaredMatchesAssignment: false,
      artifactWasSatisfiedBeforeRound: true,
      preArtifactContentId: 1,
      artifact: staleValidArtifact,
      validatorZero: true,
      roundResult: RoundFailure,
    },
  }

  action dispatchPlanningWithCorrectSet = all {
    state.phase == BeforeDispatch,
    state' = {
      ...state,
      phase: Dispatched,
      lane: Planning,
      declaredNonEmpty: true,
      declaredBeforeDispatch: true,
      declaredMatchesAssignment: true,
      artifactWasSatisfiedBeforeRound: false,
      artifact: emptyArtifact,
      validatorZero: true,
    },
  }

  // D3: the correct implementation result is absence. The current digest
  // grammar asks for working-tree mode and bytes, which do not exist.
  action deleteAssignedDeliverable = all {
    state.phase == Dispatched,
    state.lane == Implement,
    state' = {
      ...state,
      work: DeleteAssigned,
      artifact: emptyArtifact,
      porcelainChanged: true,
      contentDigestChanged: ENCODE_DELETION_ABSENCE,
      treeDigestDefined: ENCODE_DELETION_ABSENCE,
      evidenceResult:
        if (ENCODE_DELETION_ABSENCE) {
          EvidenceChanged
        } else {
          EvidenceInconclusive
        },
    },
  }

  action writeAssignedDeliverable = all {
    state.phase == Dispatched,
    state' = {
      ...state,
      work: WriteAssigned,
      artifact: currentCompleteArtifact(state),
      porcelainChanged: true,
      contentDigestChanged: true,
      treeDigestDefined: true,
      evidenceResult: EvidenceChanged,
    },
  }

  // D5a: -uall cannot see a byte rewrite when the status line is unchanged.
  action rewriteAlreadyUntrackedDeliverable = all {
    state.phase == Dispatched,
    state' = {
      ...state,
      work: RewriteUntracked,
      artifact: currentCompleteArtifact(state),
      porcelainChanged: false,
      contentDigestChanged: true,
      treeDigestDefined: true,
      evidenceResult: EvidenceChanged,
    },
  }

  // D5b: adding a file below a collapsed untracked directory is silent only
  // without -uall. The current and repaired modules both set PORCELAIN_UALL.
  action addFileInsideUntrackedDirectory = all {
    state.phase == Dispatched,
    state' = {
      ...state,
      work: AddNestedUntracked,
      artifact: currentCompleteArtifact(state),
      porcelainChanged: PORCELAIN_UALL,
      contentDigestChanged: true,
      treeDigestDefined: true,
      evidenceResult: EvidenceChanged,
    },
  }

  action finishRound = all {
    state.phase == Dispatched,
    state' = {
      ...state,
      phase: Finished,
      evidenceResult:
        if (state.contentDigestChanged) {
          EvidenceChanged
        } else {
          EvidenceInconclusive
        },
      roundResult:
        if (laneContractPasses(state)) {
          RoundSuccess
        } else {
          RoundFailure
        },
    },
  }

  action terminal = all {
    state.phase == Finished or state.phase == Refused,
    state' = state,
  }

  action step = any {
    dispatchPlanningWithStaleArtifact,
    dispatchAuditWithPrepublishedArtifact,
    dispatchAuditToExternalRunDirectory,
    dispatchImplementDeletion,
    refusePlanningWithWrongSet,
    dispatchPlanningWithCorrectSet,
    deleteAssignedDeliverable,
    writeAssignedDeliverable,
    rewriteAlreadyUntrackedDeliverable,
    addFileInsideUntrackedDirectory,
    finishRound,
    terminal,
  }

  // Defect-isolated entrypoints keep counterexamples independent and compact.
  action step_d1 = any {
    dispatchPlanningWithStaleArtifact,
    finishRound,
    terminal,
  }

  action step_d2 = dispatchAuditToExternalRunDirectory

  action step_d3 = any {
    dispatchImplementDeletion,
    deleteAssignedDeliverable,
  }

  action step_d4 = any {
    refusePlanningWithWrongSet,
    terminal,
  }

  action step_d5 = any {
    dispatchPlanningWithCorrectSet,
    rewriteAlreadyUntrackedDeliverable,
  }

  action step_d5_nested = any {
    dispatchPlanningWithCorrectSet,
    addFileInsideUntrackedDirectory,
  }

  action step_prepublish = any {
    dispatchAuditWithPrepublishedArtifact,
    finishRound,
    terminal,
  }

  // D1 should hold: a terminal success for an artifact-producing lane must
  // describe completed work from this attempt and exact evidence tuple.
  val inv_d1_success_requires_current_artifact =
    state.roundResult != RoundSuccess or
      state.lane == Implement or
      artifactBoundToCurrentRound(state)

  // D2 should hold: every dispatched audit has roots on which both its
  // reviewed-tree identity and its external artifact evidence are computable.
  val inv_d2_audit_roots_satisfiable =
    state.phase == BeforeDispatch or
      state.lane != Audit or
      auditRootContractSatisfiable(state)

  // D3 should hold: a valid deletion has a total digest identity and is
  // observed as a content change, distinct from NoWork.
  val inv_d3_deletion_digest_total =
    state.work != DeleteAssigned or
      and {
        state.treeDigestDefined,
        state.contentDigestChanged,
        authoritativeDigestObserved(state),
      }

  // D4 should hold: declaration is non-empty, pre-dispatch, and equal to the
  // artifact set derived from the lane assignment.
  val inv_d4_dispatch_declaration_sound =
    (state.phase != Dispatched and state.phase != Finished) or
      declarationSound(state)

  // D5 diagnostic, intentionally false even after repair: porcelain itself is
  // not a complete content-change detector.
  val inv_d5_porcelain_reports_every_write =
    not(workOccurred(state.work)) or state.porcelainChanged

  // D5 repaired safety predicate: an unchanged porcelain signal never hides
  // actual work from the authoritative content identity.
  val inv_d5_silent_porcelain_cannot_hide_work =
    not(workOccurred(state.work) and not(state.porcelainChanged)) or
      authoritativeDigestObserved(state)

  // Cross-cutting requirements from the current specification.
  val inv_success_requires_positive_control =
    state.roundResult != RoundSuccess or state.positiveControlPassed

  val inv_unchanged_observation_is_not_terminal_evidence =
    state.evidenceResult != EvidenceInconclusive or
      state.roundResult != RoundPending or
      state.phase != Finished

  // Positive reachability targets used to guard against vacuous safety checks.
  val witness_current_artifact_success =
    and {
      state.phase == Finished,
      state.roundResult == RoundSuccess,
      artifactBoundToCurrentRound(state),
    }

  val witness_stale_noop_success =
    and {
      state.phase == Finished,
      state.roundResult == RoundSuccess,
      state.work == NoWork,
      state.artifact.attempt != state.currentAttempt,
    }

  val witness_audit_root_conflict =
    and {
      state.phase == Dispatched,
      state.lane == Audit,
      not(auditRootContractSatisfiable(state)),
    }

  val witness_deletion_digest_undefined =
    state.work == DeleteAssigned and not(state.treeDigestDefined)

  val witness_wrong_declaration_refused =
    state.phase == Refused and not(declarationSound(state))

  val witness_silent_porcelain_work =
    workOccurred(state.work) and not(state.porcelainChanged)

  val witness_prepublish_schema_split =
    and {
      state.phase == Dispatched,
      state.lane == Audit,
      state.artifact.harnessSchemaValid,
      not(state.artifact.modelSchemaValid),
      not(state.artifact.complete),
    }
}

// Current specification seams identified by the fix-round re-audit.
module pre_fix {
  import evidence_contract(
    REQUIRE_CURRENT_ARTIFACT = false,
    SPLIT_AUDIT_ROOTS = false,
    ENCODE_DELETION_ABSENCE = false,
    PORCELAIN_UALL = true
  ).*
}

// Proposed repair. Porcelain remains corroboration only; it is not "fixed".
module post_fix {
  import evidence_contract(
    REQUIRE_CURRENT_ARTIFACT = true,
    SPLIT_AUDIT_ROOTS = true,
    ENCODE_DELETION_ABSENCE = true,
    PORCELAIN_UALL = true
  ).*
}

// Historical path-level signal without -uall, retained only to reproduce the
// collapsed-untracked-directory blind spot. This is not the current contract.
module legacy_porcelain {
  import evidence_contract(
    REQUIRE_CURRENT_ARTIFACT = false,
    SPLIT_AUDIT_ROOTS = false,
    ENCODE_DELETION_ABSENCE = false,
    PORCELAIN_UALL = false
  ).*
}
