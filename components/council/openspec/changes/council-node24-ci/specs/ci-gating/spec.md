## Purpose

Defines how the existing root hosted Linux and Windows pull-request gates
enforce the deterministic Council TypeScript quality suite under Node 24
without provider credentials or live provider calls.

## ADDED Requirements

### Requirement: Root gates run the Council Node 24 suite

The existing root workflows `gates-linux` and `gates-windows` SHALL each
include exactly one pull-request gating step named `Run Council Node 24 gate`
that runs after `actions/setup-node@v4` with Node version 24. The step SHALL
set working directory `components/council`, set environment variable `CI` to
`"true"`, and SHALL execute these commands in order:

1. `corepack pnpm install --frozen-lockfile`
2. `corepack pnpm check`
3. `corepack pnpm exec openspec validate --all --strict --no-interactive`

#### Scenario: Linux root gate includes the Council step

- **WHEN** a pull request triggers `gates-linux`
- **THEN** the job runs `Run Council Node 24 gate` from `components/council`
  under Node 24 with the install, check, and strict OpenSpec-all sequence

#### Scenario: Windows root gate includes the Council step

- **WHEN** a pull request triggers `gates-windows`
- **THEN** the job runs `Run Council Node 24 gate` from `components/council`
  under Node 24 with the install, check, and strict OpenSpec-all sequence

### Requirement: Council hosted gate fails closed

The `Run Council Node 24 gate` step SHALL fail the job on any non-zero command
exit. The step SHALL NOT set `continue-on-error`, SHALL NOT use a conditional
that skips the step on pull requests, and SHALL NOT mark the step as advisory.

#### Scenario: Council check fails on a pull request

- **WHEN** any command in the Council Node 24 gate exits non-zero
- **THEN** the root gate job fails and the pull request does not receive a
  green Council-validated gate status from that workflow

### Requirement: Hosted Council gate excludes provider live calls

The `Run Council Node 24 gate` step SHALL NOT introduce provider API keys,
tokens, credential secrets, network canaries, provider-health invocations, or
paid provider CLI calls. The step environment SHALL carry `CI=true` and SHALL
NOT configure Anthropic, OpenAI, xAI, Gemini, Claude, Codex, or Grok credentials.

#### Scenario: Workflow regression audits provider configuration

- **WHEN** the architecture regression reads both root gate workflow files
- **THEN** it confirms the Council gate step lacks provider credential and
  live-call configuration while still requiring the deterministic command
  sequence
