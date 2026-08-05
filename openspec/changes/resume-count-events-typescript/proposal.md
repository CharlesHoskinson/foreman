# Proposal: attempt-bound durable resume counts

## Why

The typed resume decision accepts a caller-supplied `resumeCount`, but the live
TypeScript runtime does not yet own that durable value. The legacy supervisor
counts untyped lane-wide `resume` events and can race when two supervisors act
at the same time. A restart can also lose the distinction between a proposed
resume and a completed restore.

## What changes

Add one atomic resume-attempt reservation to `@foreman/event-log`. The
reservation reads and validates the current journal, binds the next count to
one exact `AttemptIdentity`, appends one canonical `resume_attempt` event, and
returns the stored event. The existing event-journal lock serializes concurrent
reservations.

The operation fails closed for malformed counts, gaps, legacy unbound resume
events, a non-current attempt, an invalid limit, or an exhausted limit.

## Scope

This R5C slice changes only Node.js 24 TypeScript and Effect code in
`@foreman/event-log`, its tests, exports, and the active v0.3.0 records.

This slice does not restore a worktree, inspect a process or lock, enqueue a
command, launch a supervisor, or modify a shell entry point.
