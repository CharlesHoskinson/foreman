# Change: resume-safety-services-typescript

## Why

R5A decides whether one typed round can resume.
It requires explicit process and lock observations.
The legacy supervisor gets those observations from shell functions and path tests.
The Node supervisor needs typed Effect services that fail closed.

## What changes

- Add an Effect service for owned-process observation.
- Add an Effect service for lane-lock observation.
- Add one Effect program that collects both observations for R5A.
- Treat unknown boundary results as `unknown`.
- Treat permission-denied process existence as `active`.
- Treat symlink and non-directory lock paths as `unknown`.

## Impact

- Add TypeScript source and tests to `@foreman/orchestration`.
- Export the new public services and observation program.
- Do not modify a shell script or perform resume mutation.
- Prepare the observation boundary for the later Node supervisor CLI.
