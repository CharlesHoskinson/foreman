// Standalone fixture (Task 1 test isolation). prctl(PR_SET_CHILD_SUBREAPER)
// mutates the CALLING PROCESS's own kernel state for that process's whole
// remaining lifetime -- calling it directly inside `bun test`'s own runner
// process leaks that state into every OTHER test file sharing the same
// run. Confirmed empirically: with the call made in-process, tests/
// supervise.test.ts's process-group kill-and-verify-gone check went flaky
// (kill(-pid,0) transiently still succeeded -- zombie-reaping timing
// shifted once the runner itself became a subreaper), reproducibly, only
// when this file's test ran in the same `bun test` invocation. This
// fixture runs the real prctl calls in a throwaway child process instead,
// so the mutation is contained and never leaks into the shared test
// runner.
import { setChildSubreaper, getChildSubreaperFlag } from "../../src/posix";

const ok = setChildSubreaper();
console.log(JSON.stringify({ ok, flag: getChildSubreaperFlag() }));
