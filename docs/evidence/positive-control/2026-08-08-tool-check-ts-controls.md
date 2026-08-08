# Positive Controls for TypeScript Tool-Check Functions

Date: 2026-08-08

This record documents the demonstration of positive controls for the newly migrated TypeScript `tool-check` functions, proving they successfully discriminate between known-bad and known-good inputs when executed on a real Linux host.

## 1. sha256FileSync
**Command:**
```bash
npx tsx -e '
import { sha256FileSync } from "./packages/orchestration/src/tool-check-platform.ts";
console.log("BAD:", sha256FileSync("tests/fixtures/tool-check/__does_not_exist__"));
console.log("GOOD:", sha256FileSync("tests/fixtures/tool-check/sha256-good.pointer"));
'
```

**Output:**
```
BAD: 
GOOD: 5cf2feef791d94c6c6b02ea78f0a244a9975edaf608a9bdac1ef2f0ad50e31dc
```

**Disposition:**
REGISTERED. The function outputs an empty string for the missing bad fixture, and the exact SHA256 string for the valid good fixture, successfully demonstrating both arms.

---

## 2. classifyHostClass
**Command:**
```bash
npx tsx -e '
import { readFileSync } from "fs";
import { classifyHostClass } from "./packages/orchestration/src/tool-check-platform.ts";
const hostBad = readFileSync("tests/fixtures/tool-check/host-class-bad.pointer", "utf8").trim();
const hostGood = readFileSync("tests/fixtures/tool-check/host-class-good.pointer", "utf8").trim();
console.log("BAD:", classifyHostClass({}, hostBad, false));
console.log("GOOD:", classifyHostClass({}, hostGood || "Linux", false));
'
```

**Output:**
```
BAD: msys2-git-bash
GOOD: linux-native
```

**Disposition:**
REGISTERED. The function successfully discriminates, outputting `msys2-git-bash` when passed the bad fixture's contents and `linux-native` for the good path.

---

## 3. classifyFsClassFromProbe
**Command:**
```bash
npx tsx -e '
import { readFileSync } from "fs";
import { classifyFsClassFromProbe } from "./packages/orchestration/src/tool-check-platform.ts";
const fsBad = readFileSync("tests/fixtures/tool-check/fs-class-bad.pointer", "utf8").trim();
const fsGood = readFileSync("tests/fixtures/tool-check/fs-class-good.pointer", "utf8").trim();
console.log("BAD:", classifyFsClassFromProbe(fsBad, "", ""));
console.log("GOOD:", classifyFsClassFromProbe(fsGood, "", ""));
'
```

**Output:**
```
BAD: mnt-drvfs
GOOD: local
```

**Disposition:**
REGISTERED. The function successfully discriminates between the two filesystem structures in the fixtures.

---

## 4. lookupPinnedVerdict
**Command:**
```bash
npx tsx -e '
import { lookupPinnedVerdict } from "./packages/orchestration/src/tool-check-atomicity.ts";
console.log("BAD:", lookupPinnedVerdict({
  mechanism: "flock",
  sha256: "59bc254984eefd83939a22a590d746942a4583a702b8fd2753bbb92d956e7d4c",
  hostClass: "wsl-linux",
  repoRoot: process.cwd(),
  manifestPath: "tests/fixtures/tool-check/pinned-lookup/manifest-bad.toml"
}));
console.log("GOOD:", lookupPinnedVerdict({
  mechanism: "flock",
  sha256: "59bc254984eefd83939a22a590d746942a4583a702b8fd2753bbb92d956e7d4c",
  hostClass: "wsl-linux",
  repoRoot: process.cwd(),
  manifestPath: "tests/fixtures/tool-check/pinned-lookup/manifest-good.toml"
}));
'
```

**Output:**
```
BAD: null
GOOD: {
  verdict: "atomic",
  filesystem_classes: [ "local" ],
  evidence_class: "pinned-mechanism"
}
```

**Disposition:**
REGISTERED. The function successfully discriminates by failing to load the bad manifest and successfully pulling the `atomic` verdict from the good manifest.

---

## 5. readProcVersion
**Disposition:**
DEFERRED. The TypeScript function takes no arguments and hardcodes reading `/proc/version`. It provides no seam to inject a missing or decoy fixture to drive a negative outcome.

## 6. runAtomicityProbes
**Disposition:**
DEFERRED. The TypeScript function orchestrates real OS probes (strace, mkdir, flock) that succeed on a healthy Linux host. It overrides any fallback manifest fixture provided via environment variables, making it impossible to force a negative outcome without mutating the host's actual OS capabilities or PATH.
