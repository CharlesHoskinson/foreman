import assert from "node:assert/strict";
import test from "node:test";

import {
  isReleaseProgram,
  RELEASE_PROGRAMS,
  releaseProgramTable,
} from "./release-program.js";

test("the closed program set is v040 and v050", () => {
  assert.deepEqual(RELEASE_PROGRAMS, ["v040", "v050"]);
  assert.equal(isReleaseProgram("v040"), true);
  assert.equal(isReleaseProgram("v050"), true);
  assert.equal(isReleaseProgram("v041"), false);
  assert.equal(isReleaseProgram(null), false);
});

test("the per-program table reproduces v040 constants and v050 owners", () => {
  const v040 = releaseProgramTable("v040");
  assert.equal(v040.program, "v040");
  assert.equal(
    v040.registerPath,
    "openspec/changes/v040-release-program/coverage.toml",
  );
  assert.deepEqual(v040.dispositions, [
    "v040_owner",
    "v040_dependency",
    "released_reference",
    "superseded",
    "v050",
  ]);
  assert.equal(v040.bootstrapOwner, "openspec-superpowers-convergence");
  assert.equal(v040.childIdPrefix, "v040-t");
  assert.equal(v040.evaluationChild, "v040-t8-evaluation");
  assert.deepEqual(v040.trancheRange, [2, 9]);

  const v050 = releaseProgramTable("v050");
  assert.equal(v050.program, "v050");
  assert.equal(
    v050.registerPath,
    "openspec/changes/v050-release-program/coverage.toml",
  );
  assert.deepEqual(v050.dispositions, [
    "v050_owner",
    "v050_dependency",
    "released_reference",
    "superseded",
    "v060",
  ]);
  assert.equal(v050.bootstrapOwner, "v050-release-program");
  assert.equal(v050.childIdPrefix, "v050-");
  assert.equal(v050.evaluationChild, null);
  assert.deepEqual(v050.trancheRange, [2, 8]);
});
