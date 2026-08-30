// Foreman lifecycle: bootstrap -> design -> implement -> audit/QA -> ship.
// Models the readiness-verdict soundness defect observed 2026-08-08: a vendor CLI
// migrating its credential store on first run reports signed-out while genuinely
// authenticated, and bootstrap latched that transient verdict.
module foreman_lifecycle {
  type VendorId = str
  type Family   = str
  type Stage    = str   // "bootstrap" | "design" | "implement" | "audit" | "ship"

  // A vendor's true state vs what a probe observed. The gap between them is the defect.
  type Readiness = {
    discoverable: bool,
    trueAuth:     bool,   // credentials are actually valid
    migrating:    bool,   // first-run credential migration in flight
    probed:       bool,   // a probe has been taken
    observedAuth: bool,   // what the probe concluded
  }

  type Work = {
    specWritten:   bool,
    implementer:   VendorId,
    diffProduced:  bool,
    checksPassed:  bool,
    auditor:       VendorId,
    auditRecorded: bool,
    auditPassed:   bool,
  }

  const VENDORS: Set[VendorId]
  const FAMILY:  VendorId -> Family

  var stage:   Stage
  var ready:   VendorId -> Readiness
  var work:    Work
  var shipped: bool

  val NO_VENDOR: VendorId = ""

  // ---- functional layer -------------------------------------------------
  pure def probeResult(r: Readiness): bool =
    // A probe during migration observes signed-out even though trueAuth holds.
    if (r.migrating) false else r.trueAuth

  pure def isReady(r: Readiness): bool =
    r.discoverable and r.probed and r.observedAuth

  pure def allReady(rs: VendorId -> Readiness, vs: Set[VendorId]): bool =
    vs.forall(v => isReady(rs.get(v)))

  pure def crossFamily(f: VendorId -> Family, a: VendorId, b: VendorId): bool =
    a != b and f.get(a) != f.get(b)

  // ---- state machine ----------------------------------------------------
  action init: bool = all {
    stage'   = "bootstrap",
    shipped' = false,
    ready'   = VENDORS.mapBy(_ => { discoverable: true, trueAuth: true,
                                    migrating: true, probed: false, observedAuth: false }),
    work'    = { specWritten: false, implementer: NO_VENDOR, diffProduced: false,
                 checksPassed: false, auditor: NO_VENDOR, auditRecorded: false,
                 auditPassed: false },
  }

  action probeVendor(v: VendorId): bool = all {
    stage == "bootstrap",
    ready' = ready.setBy(v, r => { ...r, probed: true, observedAuth: probeResult(r) }),
    stage' = stage, work' = work, shipped' = shipped,
  }

  // Migration finishes; a later re-probe now observes the truth.
  action settleMigration(v: VendorId): bool = all {
    ready.get(v).migrating,
    ready' = ready.setBy(v, r => { ...r, migrating: false, probed: false, observedAuth: false }),
    stage' = stage, work' = work, shipped' = shipped,
  }

  action completeBootstrap: bool = all {
    stage == "bootstrap",
    allReady(ready, VENDORS),
    stage' = "design",
    ready' = ready, work' = work, shipped' = shipped,
  }

  action writeSpec: bool = all {
    stage == "design",
    work'  = { ...work, specWritten: true },
    stage' = "implement",
    ready' = ready, shipped' = shipped,
  }

  action implement(v: VendorId): bool = all {
    stage == "implement",
    isReady(ready.get(v)),
    work.specWritten,
    work'  = { ...work, implementer: v, diffProduced: true },
    stage' = "audit",
    ready' = ready, shipped' = shipped,
  }

  action runChecks: bool = all {
    stage == "audit",
    work.diffProduced,
    work'  = { ...work, checksPassed: true },
    stage' = stage, ready' = ready, shipped' = shipped,
  }

  action audit(v: VendorId): bool = all {
    stage == "audit",
    isReady(ready.get(v)),
    work.diffProduced,
    work.checksPassed,
    crossFamily(FAMILY, v, work.implementer),
    work'  = { ...work, auditor: v, auditRecorded: true, auditPassed: true },
    stage' = "ship",
    ready' = ready, shipped' = shipped,
  }

  action shipIt: bool = all {
    stage == "ship",
    work.checksPassed, work.auditRecorded, work.auditPassed,
    shipped' = true,
    stage'   = "ship", ready' = ready, work' = work,
  }

  action step: bool = {
    nondet v = VENDORS.oneOf()
    any {
      probeVendor(v), settleMigration(v), completeBootstrap,
      writeSpec, implement(v), runChecks, audit(v), shipIt,
    }
  }

  // ---- properties -------------------------------------------------------
  // SAFETY: nothing ships without checks and a recorded passing audit.
  val shipRequiresAuditedChecks: bool =
    shipped implies (work.checksPassed and work.auditRecorded and work.auditPassed)

  // SAFETY: an audit is never same-family as the implementer.
  val auditIsCrossFamily: bool =
    work.auditRecorded implies crossFamily(FAMILY, work.auditor, work.implementer)

  // SAFETY: no lane work happens before bootstrap admitted every vendor.
  val noWorkBeforeBootstrap: bool =
    (stage != "bootstrap") implies allReady(ready, VENDORS)

  // SOUNDNESS: this is the defect. A vendor that is genuinely authenticated and
  // no longer migrating must never remain latched as not-ready after being probed.
  val readinessVerdictSound: bool =
    VENDORS.forall(v =>
      val r = ready.get(v)
      (r.probed and r.trueAuth and not(r.migrating)) implies r.observedAuth)

  // witnesses
  val canShip: bool = shipped
  val sawTransientFalseVerdict: bool =
    VENDORS.exists(v => val r = ready.get(v)
                        r.probed and r.trueAuth and not(r.observedAuth))
}

module foreman_3 {
  import foreman_lifecycle(
    VENDORS = Set("claude", "grok", "codex"),
    FAMILY  = Map("claude" -> "anthropic", "grok" -> "xai", "codex" -> "openai")
  ).*
}
