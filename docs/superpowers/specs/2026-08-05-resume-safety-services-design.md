# Resume Safety Services Design

## Goal

Add the Effect live-observation boundary for the R5A resume decision.

## Architecture

Create one process probe, one lock probe, and one composition program.
The live process probe uses Node signal-zero and fails closed.
The live lock probe uses no-follow path metadata and fails closed.
It accepts only paths that are absolute on the current Node platform.
The composition program returns the two exact states required by R5A.
One live-layer factory accepts optional low-level seams so tests can force each
Node error class. Default seams use the real Node APIs.
The composition maps probe defects to `unknown` but preserves interruption.

## Safety boundary

The services only observe.
They do not authorize or perform restore, lock, queue, or process mutation.
A later executor must revalidate state at its mutation boundary.

## Test strategy

Use red-first Node tests with injected boundary seams.
Cover missing, existing, denied, invalid, linked, and failed observations.
Cover Effect composition and preservation of unknown states.
